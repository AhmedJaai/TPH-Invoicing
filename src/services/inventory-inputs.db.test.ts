import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { caught, withRollback } from "@/test/db";
import {
  importLatteSales, isolateProducts, latteSalesFile, makeActor, makeBranch, makeInvoicePurchase,
  makeMenuProduct, makeStockProduct,
} from "@/test/inventory";
import { saveRecipeVersion } from "./recipe.service";
import {
  CountLockedError, ScopeItemNotInCountError, finaliseCount, listCounts, loadScope, recomputeCount,
  saveActualCounts, saveCountScope, setOpenings, startCount,
} from "./inventory.service";
import { PossibleDuplicateReceiptError, createReceipt, resolveReceipt, voidReceipt } from "./inventory-receipt.service";
import { canonicalToQuantity, toCanonical } from "@/lib/inventory/units";
import { combineSummaries } from "@/lib/inventory/variance-summary";
import type { Tx } from "./types";

/**
 * ما يُدخله الإنسان حين لا تعرفه الوثائق — على المخطّط الحقيقيّ.
 *
 * الافتتاحيُّ اليدويّ ومصدرُه، والكمّيّةُ المستلَمة وعلاقتُها بالفاتورة،
 * ونطاقُ الجرد حالاً محفوظة، والنقصُ والزيادةُ لا يتقاصّان. وكلُّه يمرّ
 * بالخدمات التي تمرّ بها الشاشة، في معاملةٍ تُلغى.
 */

const WEEK = { start: "2026-09-13", end: "2026-09-19" };
const NEXT = { start: "2026-09-20", end: "2026-09-26" };
const PREV = { start: "2026-09-06", end: "2026-09-12" };

const g = (grams: number) => toCanonical(Math.round(grams * 1000), "G");
const kgOf = (canonical: number | null) => (canonical === null ? null : canonicalToQuantity(canonical, "G") / 1000);

/**
 * بنٌّ يُصرَف بالجرام، ولاتيه بعشرين جراماً، وفرع.
 * و`lattes` مبيعاتُ الأسبوع — ٦٠٠ لاتيه = ‏١٢ كجم.
 */
async function cafe(tx: Tx, lattes = 600) {
  const actorId = await makeActor(tx);
  const branch = await makeBranch(tx);
  const coffee = await makeStockProduct(tx, "بنّ", "G", "COFFEE");
  const milk = await makeStockProduct(tx, "حليب", "L", "DAIRY");
  const cups = await makeStockProduct(tx, "أكواب", "PIECE");
  const latte = await makeMenuProduct(tx, "لاتيه");
  await isolateProducts(tx, [coffee, milk, cups, latte]);

  await saveRecipeVersion({
    menuProductId: latte, effectiveFrom: "2026-09-01", activate: true, actorId,
    ingredients: [{ productId: coffee, quantityMilli: 20_000, unit: "G" }],
  }, tx);
  if (lattes > 0) await importLatteSales(tx, latteSalesFile(lattes, "2026-09-15"), actorId, latte, branch.nameAr);

  return { actorId, branch, coffee, milk, cups, latte };
}

async function line(tx: Tx, countId: string, productId: string) {
  const report = await recomputeCount(countId, tx);
  return report.lines.find((l) => l.productId === productId)!;
}

/* ───────────────────── الرصيدُ الافتتاحيّ ───────────────────── */

describe("الرصيدُ الافتتاحيّ اليدويّ", () => {
  it("‏٥٫٢ كجم تُدخَل بالكيلو فيتسلّمها المحرّك ‏٥٢٠٠ جرام — ومصدرُها «يدويّ»", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee } = await cafe(tx);
      const { countId } = await startCount({ periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx);

      await setOpenings(countId, [{ productId: coffee, enteredMilli: 5200, unit: "KG" }], actorId, tx);

      const l = await line(tx, countId, coffee);
      expect(l.openingMilli).toBe(g(5200));
      expect(l.openingSource).toBe("MANUAL");

      const [audit] = (await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from audit_logs where action = 'INVENTORY_OPENING_SET' and entity_id = ${countId}
      `)).rows;
      expect(audit.n).toBe(1);
    }));

  it("وبلا جردٍ سابق ولا إدخال — غيرُ معروف، لا صفر", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee } = await cafe(tx);
      const { countId } = await startCount({ periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx);
      const l = await line(tx, countId, coffee);
      expect(l.openingMilli).toBeNull();
      expect(l.openingSource).toBe("UNKNOWN");
      expect(l.theoreticalClosingMilli).toBeNull();
    }));

  it("وفعليُّ الجرد المقفَل السابق افتتاحيُّ ما بعده — «من جرد الأسبوع السابق»", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee } = await cafe(tx, 0);
      const prev = await startCount({ periodStart: PREV.start, periodEnd: PREV.end, branchId: branch.id, actorId }, tx);
      await saveActualCounts(prev.countId, [{ productId: coffee, actualMilli: g(5200) }], actorId, tx);
      await finaliseCount(prev.countId, actorId, tx);

      const { countId } = await startCount({ periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx);
      const l = await line(tx, countId, coffee);
      expect(l.openingMilli).toBe(g(5200));
      expect(l.openingSource).toBe("PREVIOUS_COUNT");
      expect(l.openingRef).toBe(prev.countId);
    }));

  it("واليدويّ يغلب السابقَ صراحةً — ويبقى تاريخُه، والإفراغُ يُعيد السابقَ لا الصفر", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee } = await cafe(tx, 0);
      const prev = await startCount({ periodStart: PREV.start, periodEnd: PREV.end, branchId: branch.id, actorId }, tx);
      await saveActualCounts(prev.countId, [{ productId: coffee, actualMilli: g(5200) }], actorId, tx);
      await finaliseCount(prev.countId, actorId, tx);

      const { countId } = await startCount({ periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx);
      await setOpenings(countId, [{ productId: coffee, enteredMilli: 6000, unit: "KG" }], actorId, tx);
      await setOpenings(countId, [{ productId: coffee, enteredMilli: 6100, unit: "KG" }], actorId, tx);

      let l = await line(tx, countId, coffee);
      expect(kgOf(l.openingMilli)).toBe(6.1);
      expect(l.openingSource).toBe("MANUAL");

      /* التعديلُ أغلق السابقَ ولم يمحُه */
      const [rows] = (await tx.execute<{ total: number; active: number }>(sql`
        select count(*)::int as total, count(*) filter (where superseded_at is null)::int as active
          from inventory_count_openings where count_id = ${countId}
      `)).rows;
      expect(rows.total).toBe(2);
      expect(rows.active).toBe(1);

      await setOpenings(countId, [{ productId: coffee, enteredMilli: null, unit: "KG" }], actorId, tx);
      l = await line(tx, countId, coffee);
      expect(kgOf(l.openingMilli)).toBe(5.2);
      expect(l.openingSource).toBe("PREVIOUS_COUNT");
    }));

  it("ووحدةٌ من عائلةٍ أخرى تُردّ — اللترُ لا يصير جراماً", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee } = await cafe(tx, 0);
      const { countId } = await startCount({ periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx);
      expect(await caught(setOpenings(countId, [{ productId: coffee, enteredMilli: 5000, unit: "L" }], actorId, tx)))
        .toBeInstanceOf(Error);
    }));

  it("والفرعُ لا يرث افتتاحيَّ فرعٍ آخر", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee } = await cafe(tx, 0);
      const other = await makeBranch(tx);
      const prev = await startCount({ periodStart: PREV.start, periodEnd: PREV.end, branchId: branch.id, actorId }, tx);
      await saveActualCounts(prev.countId, [{ productId: coffee, actualMilli: g(5200) }], actorId, tx);
      await finaliseCount(prev.countId, actorId, tx);

      const { countId } = await startCount({ periodStart: WEEK.start, periodEnd: WEEK.end, branchId: other.id, actorId }, tx);
      const l = await line(tx, countId, coffee);
      expect(l.openingMilli).toBeNull();
      expect(l.openingSource).toBe("UNKNOWN");
    }));
});

/* ───────────────────── الكمّيّةُ المستلَمة ───────────────────── */

describe("الكمّيّةُ المستلَمة يدوياً", () => {
  it("‏٥ + ٢٠ مستلَمة − ١٢ استهلاك = ١٣ متوقَّعاً، والفعليّ ١٠٫٥ ← فرقٌ −٢٫٥ — في المعادلة نفسِها", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee } = await cafe(tx);
      const { countId } = await startCount({ periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx);

      await setOpenings(countId, [{ productId: coffee, enteredMilli: 5000, unit: "KG" }], actorId, tx);
      await createReceipt({
        productId: coffee, branchId: branch.id, receivedOn: "2026-09-16", enteredMilli: 20_000, unit: "KG",
      }, actorId, tx);
      await saveActualCounts(countId, [{ productId: coffee, actualMilli: g(10_500) }], actorId, tx);

      const l = await line(tx, countId, coffee);
      expect(kgOf(l.purchasesMilli)).toBe(20);
      expect(kgOf(l.manualReceiptsMilli)).toBe(20);
      expect(kgOf(l.theoreticalConsumptionMilli)).toBe(12);
      expect(kgOf(l.theoreticalClosingMilli)).toBe(13);
      expect(kgOf(l.varianceMilli)).toBe(-2.5);
    }));

  it("وبلا مشترياتٍ ولا استلام — صفرٌ حقيقيّ لا مجهول", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee } = await cafe(tx);
      const { countId } = await startCount({ periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx);
      const l = await line(tx, countId, coffee);
      expect(l.purchasesMilli).toBe(0);
      expect(l.flags).not.toContain("PURCHASES_UNKNOWN");
    }));

  it("وبندُ فاتورةٍ بعشرين كيلو يُحسَب مرّةً واحدة", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee } = await cafe(tx);
      await makeInvoicePurchase(tx, coffee, "2026-09-14", 1760_00, { packSize: "1", contentUnit: "KG", contentQuantity: "20", qty: "1" });
      const { countId } = await startCount({ periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx);
      expect(kgOf((await line(tx, countId, coffee)).purchasesMilli)).toBe(20);
    }));

  it("وبندٌ لا تُعرَف كمّيّتُه — المشترياتُ مجهولة لا صفر، ثمّ يحلّها استلامٌ مرتبطٌ به", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee } = await cafe(tx);
      const lineId = await makeInvoicePurchase(tx, coffee, "2026-09-14", 1760_00, null);
      const { countId } = await startCount({ periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx);

      let l = await line(tx, countId, coffee);
      expect(l.purchasesMilli).toBeNull();
      expect(l.flags).toContain("PURCHASES_UNKNOWN");

      /* يعرف صاحبُ المقهى ما وصل: عشرون كيلو — وهي شحنةُ ذلك البند */
      await createReceipt({
        productId: coffee, branchId: branch.id, receivedOn: "2026-09-14", enteredMilli: 20_000, unit: "KG",
        resolution: { kind: "LINK", invoiceLineId: lineId },
      }, actorId, tx);

      l = await line(tx, countId, coffee);
      expect(kgOf(l.purchasesMilli)).toBe(20);
      /* وتُؤخَذ كلفةُ البند المدفوعة — ٨٨ ريالاً للكيلو */
      expect(l.unitCostMilliMinor).toBe(88_00 * 1000 / 1000);
    }));

  it("والاستلامُ الذي يشبه بنداً قائماً يُردّ قبل أن يُكتَب — ولا يُحسَب أربعين", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee } = await cafe(tx);
      const lineId = await makeInvoicePurchase(tx, coffee, "2026-09-14", 1760_00, { packSize: "1", contentUnit: "KG", contentQuantity: "20", qty: "1" });
      const { countId } = await startCount({ periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx);

      const input = { productId: coffee, branchId: branch.id, receivedOn: "2026-09-15", enteredMilli: 20_000, unit: "KG" as const };
      const e = await caught(createReceipt(input, actorId, tx));
      expect(e).toBeInstanceOf(PossibleDuplicateReceiptError);
      expect((e as PossibleDuplicateReceiptError).candidates[0].invoiceLineId).toBe(lineId);

      /* لم يُكتَب شيء */
      const [n] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from inventory_receipts where product_id = ${coffee}`)).rows;
      expect(n.n).toBe(0);

      /* هو نفسُه ← يُربَط، فتُحسَب الشحنةُ مرّةً واحدة */
      await createReceipt({ ...input, resolution: { kind: "LINK", invoiceLineId: lineId } }, actorId, tx);
      expect(kgOf((await line(tx, countId, coffee)).purchasesMilli)).toBe(20);
    }));

  it("وشحنتان حقيقيّتان متساويتان — يُؤكَّد انفصالُهما فتُحسَبان معاً", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee } = await cafe(tx);
      await makeInvoicePurchase(tx, coffee, "2026-09-14", 1760_00, { packSize: "1", contentUnit: "KG", contentQuantity: "20", qty: "1" });
      const { countId } = await startCount({ periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx);

      await createReceipt({
        productId: coffee, branchId: branch.id, receivedOn: "2026-09-17", enteredMilli: 20_000, unit: "KG",
        resolution: { kind: "SEPARATE" },
      }, actorId, tx);
      expect(kgOf((await line(tx, countId, coffee)).purchasesMilli)).toBe(40);
    }));

  it("والفاتورةُ التي تصل بعد الاستلام تُكشَف عند الحساب — المشترياتُ مجهولة حتى تُحسَم", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee } = await cafe(tx);
      const { countId } = await startCount({ periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx);

      const receiptId = await createReceipt({
        productId: coffee, branchId: branch.id, receivedOn: "2026-09-16", enteredMilli: 20_000, unit: "KG",
      }, actorId, tx);
      /* ثمّ وصلت الفاتورة */
      const lineId = await makeInvoicePurchase(tx, coffee, "2026-09-17", 1760_00, { packSize: "1", contentUnit: "KG", contentQuantity: "20", qty: "1" });

      const report = await recomputeCount(countId, tx);
      const l = report.lines.find((x) => x.productId === coffee)!;
      expect(l.purchasesMilli).toBeNull();
      expect(l.flags).toContain("RECEIPT_POSSIBLE_DUPLICATE");
      expect(report.coverage.gaps.some((gp) => gp.reason === "RECEIPT_POSSIBLE_DUPLICATE")).toBe(true);

      await resolveReceipt(receiptId, { kind: "LINK", invoiceLineId: lineId }, actorId, tx);
      expect(kgOf((await line(tx, countId, coffee)).purchasesMilli)).toBe(20);
    }));

  it("واستلامُ ١٨ لبندِ فاتورةٍ بتاريخ ٢٠ — يدخل أسبوعَ ١٨ ولا يُعاد في أسبوع ٢٠", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee } = await cafe(tx, 0);
      const lineId = await makeInvoicePurchase(tx, coffee, "2026-09-20", 1760_00, { packSize: "1", contentUnit: "KG", contentQuantity: "20", qty: "1" });
      await createReceipt({
        productId: coffee, branchId: branch.id, receivedOn: "2026-09-18", enteredMilli: 20_000, unit: "KG",
        resolution: { kind: "LINK", invoiceLineId: lineId },
      }, actorId, tx);

      const week = await startCount({ periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx);
      const next = await startCount({ periodStart: NEXT.start, periodEnd: NEXT.end, branchId: branch.id, actorId }, tx);
      expect(kgOf((await line(tx, week.countId, coffee)).purchasesMilli)).toBe(20);
      expect(kgOf((await line(tx, next.countId, coffee)).purchasesMilli)).toBe(0);
    }));

  it("والإلغاءُ يُخرجه من الحساب ولا يمحوه", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee } = await cafe(tx);
      const { countId } = await startCount({ periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx);
      const id = await createReceipt({
        productId: coffee, branchId: branch.id, receivedOn: "2026-09-16", enteredMilli: 20_000, unit: "KG",
      }, actorId, tx);
      await voidReceipt(id, "أُدخلت بالخطأ", actorId, tx);

      expect((await line(tx, countId, coffee)).purchasesMilli).toBe(0);
      const [row] = (await tx.execute<{ void_reason: string }>(sql`select void_reason from inventory_receipts where id = ${id}`)).rows;
      expect(row.void_reason).toBe("أُدخلت بالخطأ");
    }));
});

/* ───────────────────── الجردُ المقفَل ───────────────────── */

describe("المقفَلُ لا يعني غيرَ ما عناه يومَ أُقفل", () => {
  it("لا استلامَ في أسبوعه ولا افتتاحيَّ فيه — والقاعدةُ ترفض لا الواجهة وحدها", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee } = await cafe(tx);
      const { countId } = await startCount({ periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx);
      await saveActualCounts(countId, [{ productId: coffee, actualMilli: g(1000) }], actorId, tx);
      await finaliseCount(countId, actorId, tx);

      expect(await caught(createReceipt({
        productId: coffee, branchId: branch.id, receivedOn: "2026-09-16", enteredMilli: 20_000, unit: "KG",
        resolution: { kind: "SEPARATE" },
      }, actorId, tx))).toBeInstanceOf(Error);
      expect(await caught(setOpenings(countId, [{ productId: coffee, enteredMilli: 5000, unit: "KG" }], actorId, tx)))
        .toBeInstanceOf(CountLockedError);

      /* وفي القاعدة نفسِها، لو تجاوز أحدٌ الخدمة */
      const bypass = await caught(tx.execute(sql`
        insert into inventory_count_openings (id, count_id, product_id, entered_milli, entered_unit, canonical_milli)
        values ('x-open', ${countId}, ${coffee}, 1000, 'KG', 1000000)
      `));
      expect(String((bypass as Error).message) + String((bypass as { cause?: Error }).cause?.message ?? "")).toContain("مقفَل");
    }));
});

/* ───────────────────── نطاقُ الجرد ───────────────────── */

describe("نطاقُ الجرد حالٌ محفوظة", () => {
  it("الجديدُ يرث نطاقَ سابقه ويُقال إنّه موروث", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee, milk, cups } = await cafe(tx, 0);
      const prev = await startCount({ periodStart: PREV.start, periodEnd: PREV.end, branchId: branch.id, actorId }, tx);
      await saveCountScope(prev.countId, { included: [coffee], excluded: [milk, cups] }, actorId, tx);

      const { countId } = await startCount({ periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx);
      const scope = await loadScope(countId, tx);
      expect(scope.inherited).toBe(true);
      expect(scope.explicit).toBe(false);
      expect([...scope.excluded].sort()).toEqual([milk, cups].sort());
    }));

  it("واختيارُ الكلّ صراحةً يبقى الكلَّ بعد التحديث — لا يُورَّث ثانيةً", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee, milk, cups } = await cafe(tx, 0);
      const prev = await startCount({ periodStart: PREV.start, periodEnd: PREV.end, branchId: branch.id, actorId }, tx);
      await saveCountScope(prev.countId, { included: [coffee], excluded: [milk, cups] }, actorId, tx);

      const { countId } = await startCount({ periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx);
      await saveCountScope(countId, { included: [milk, cups], excluded: [] }, actorId, tx);

      /* «التحديث»: إعادةُ حسابٍ ثمّ قراءةٌ من جديد */
      const report = await recomputeCount(countId, tx);
      const scope = await loadScope(countId, tx);
      expect(scope.explicit).toBe(true);
      expect(scope.excluded.size).toBe(0);
      expect(report.lines.filter((l) => l.productId !== milk && l.productId !== cups && l.productId !== coffee)).toEqual([]);
      expect(report.lines.every((l) => l.inScope)).toBe(true);
    }));

  it("واختيارُ بعضها صراحةً يبقى كما هو بعد التحديث", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee, milk, cups } = await cafe(tx, 0);
      const { countId } = await startCount({ periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx);
      await saveCountScope(countId, { included: [coffee], excluded: [milk, cups] }, actorId, tx);
      await recomputeCount(countId, tx);
      const report = await recomputeCount(countId, tx);
      expect(report.lines.filter((l) => !l.inScope).map((l) => l.productId).sort()).toEqual([milk, cups].sort());
    }));

  it("والحفظُ عمليّةٌ واحدة — معرّفٌ غريبٌ واحد يُلغي الكلّ ولا يبقى نصفُ نطاق", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee, milk } = await cafe(tx, 0);
      const { countId } = await startCount({ periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx);
      await recomputeCount(countId, tx);

      const e = await caught(tx.transaction(async (inner) => {
        await saveCountScope(countId, { included: [coffee], excluded: [milk, "no-such-product"] }, actorId, inner);
      }));
      expect(e).toBeInstanceOf(ScopeItemNotInCountError);

      const [c] = (await tx.execute<{ scope_source: string }>(sql`select scope_source from inventory_counts where id = ${countId}`)).rows;
      expect(c.scope_source).toBe("INHERITED");
      const excluded = await tx.execute(sql`select 1 from inventory_count_lines where count_id = ${countId} and in_scope = false`);
      expect(excluded.rows).toHaveLength(0);
    }));
});

/* ───────────────────── النقصُ والزيادة ───────────────────── */

describe("النقصُ والزيادةُ لا يتقاصّان في الاتّجاه", () => {
  it("أسبوعٌ نقص وأسبوعٌ زاد بالمقدار نفسه — الصافي صفر، والنقصُ والحجمُ ليسا صفراً", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee, latte } = await cafe(tx, 0);

      /* كلفةٌ معروفة من فاتورةٍ سابقة: ١٠٠ ريال للكيلو */
      await makeInvoicePurchase(tx, coffee, "2026-08-20", 100_00, { packSize: "1", contentUnit: "KG", contentQuantity: "1", qty: "1" });
      /* خمسون لاتيه في كلّ أسبوع = كيلو بنّ */
      await importLatteSales(tx, latteSalesFile(50, "2026-09-08", "P"), actorId, latte, branch.nameAr);
      await importLatteSales(tx, latteSalesFile(50, "2026-09-15", "W"), actorId, latte, branch.nameAr);

      /* الأوّل: ١٠ − ١ = ٩ متوقَّعاً، ووُجد ٨ ← نقصُ كيلو (١٠٠ ريال) */
      const w1 = await startCount({ periodStart: PREV.start, periodEnd: PREV.end, branchId: branch.id, actorId }, tx);
      await setOpenings(w1.countId, [{ productId: coffee, enteredMilli: 10_000, unit: "KG" }], actorId, tx);
      await saveActualCounts(w1.countId, [{ productId: coffee, actualMilli: g(8000) }], actorId, tx);
      await finaliseCount(w1.countId, actorId, tx);

      /* الثاني: ٨ − ١ = ٧ متوقَّعاً، ووُجد ٨ ← زيادةُ كيلو (١٠٠ ريال) */
      const w2 = await startCount({ periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx);
      await saveActualCounts(w2.countId, [{ productId: coffee, actualMilli: g(8000) }], actorId, tx);
      await finaliseCount(w2.countId, actorId, tx);

      const counts = (await listCounts(10, tx)).filter((c) => c.id === w1.countId || c.id === w2.countId);
      expect(counts).toHaveLength(2);
      const both = combineSummaries(counts.map((c) => c.summary));
      expect(both.netCostMinor).toBe(0);
      expect(both.shortageCostMinor).toBe(100_00);
      expect(both.overageCostMinor).toBe(100_00);
      expect(both.absoluteCostMinor).toBe(200_00);
      /* ونسبةُ النقص على كلفة الاستهلاك: ١٠٠ من ٢٠٠ = ٥٠٪ */
      expect(both.shortageRateBp).toBe(5000);
    }));
});
