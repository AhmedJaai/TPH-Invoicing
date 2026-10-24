import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { bankAccounts, bankImports, bankTransactions, monthCloses, monthSeals, reconciliationPeriods } from "@/db/schema";
import { createId } from "@/lib/id";
import { readSealedFigures } from "@/lib/month-seal";
import { caught, day, makeInvoice, makeSupplier, pgErrorOf, withRollback } from "@/test/db";
import { allocate, createPayment } from "./payment.service";
import { loadSupplierBalancesAsOf } from "./supplier-balance.service";
import {
  checkSealedMonths, computeMonthFigures, loadSealDrift, runSealCheck, sealMonth, unsealedClosedMonths,
} from "./month-seal.service";
import { checkAiBalance, loadLowAiBalance } from "./daily-checks.service";
import type { Tx } from "./types";

/*
  ختمُ أرقام الشهر عند إقفاله وفحصُ الصباح، على المخطّط الحقيقيّ (تحتاج هجرة `month_seals`).
  الأشهرُ ٢٠٩٩ كي لا تلتقي بإقفالٍ في بيانات التجهيز.
*/

const ago = (ms: number) => new Date(Date.now() - ms);
const close = (tx: Tx, month: string, closedAt: Date = ago(60_000)) =>
  tx.insert(monthCloses).values({ month, status: "CLOSED", closedAt });

async function owedOf(tx: Tx, month: string, supplierId: string): Promise<number | undefined> {
  return (await loadSupplierBalancesAsOf(month, tx)).find((b) => b.supplierId === supplierId)?.owedMinor;
}

describe("«عليك» في آخر شهرٍ مضى", () => {
  it("ما قبله وما فيه وحده: دفعةُ الشهر التالي وفاتورتُه وتخصيصُهما لا يدخلان", () =>
    withRollback(async (tx) => {
      const supplierId = await makeSupplier(tx);
      const march = await makeInvoice(tx, supplierId, 1_150_00, "2099-03-10");
      const p1 = await createPayment(tx, { supplierId, paidAt: day("2099-03-20"), amountMinor: 500_00, method: "BANK_TRANSFER" });
      await allocate(tx, p1, [{ invoiceId: march, amountMinor: 500_00 }]);
      /* أبريل: فاتورةٌ جديدة، ودفعةٌ تسدّد باقي مارس */
      await makeInvoice(tx, supplierId, 300_00, "2099-04-05");
      const p2 = await createPayment(tx, { supplierId, paidAt: day("2099-04-08"), amountMinor: 650_00, method: "BANK_TRANSFER" });
      await allocate(tx, p2, [{ invoiceId: march, amountMinor: 650_00 }]);

      expect(await owedOf(tx, "2099-03", supplierId)).toBe(650_00);
      expect(await owedOf(tx, "2099-04", supplierId)).toBe(300_00);
      /* ولا شيء قبل أوّل فاتورةٍ ودفعة */
      expect(await owedOf(tx, "2099-02", supplierId)).toBeUndefined();
    }));

  it("شهرُ الدفعة بتوقيت الرياض، و«تُنسب إلى» يغلب يومَ الدفع", () =>
    withRollback(async (tx) => {
      const supplierId = await makeSupplier(tx);
      await makeInvoice(tx, supplierId, 1_000_00, "2099-03-10");
      /* ٢٢:٠٠ UTC آخرَ مارس = الواحدة فجراً أوّلَ أبريل في الرياض */
      await createPayment(tx, { supplierId, paidAt: new Date("2099-03-31T22:00:00Z"), amountMinor: 400_00, method: "BANK_TRANSFER" });
      await createPayment(tx, { supplierId, paidAt: day("2099-04-02"), amountMinor: 100_00, method: "BANK_TRANSFER", appliesToMonth: "2099-03" });
      /* المفتوحُ ١٬٠٠٠ ورصيدُنا عنده ١٠٠ (المنسوبةُ إلى مارس وحدها) */
      expect(await owedOf(tx, "2099-03", supplierId)).toBe(900_00);
      expect(await owedOf(tx, "2099-04", supplierId)).toBe(500_00);
    }));
});

describe("ختمُ الشهر وفحصُ الصباح", () => {
  it("يختم «عليك» ورصيدَ الحساب ووارده بتوقيت الرياض، ولا فرقَ ساعةَ الختم", () =>
    withRollback(async (tx) => {
      const supplierId = await makeSupplier(tx);
      await makeInvoice(tx, supplierId, 1_150_00, "2099-03-10");
      const [acct] = await tx.insert(bankAccounts).values({ bankName: "بنك الاختبار", label: "الحساب الجاري", accountNumber: `t-${createId()}` }).returning({ id: bankAccounts.id });
      const [imp] = await tx.insert(bankImports).values({ fileName: `seal-${createId()}.xlsx`, bankAccountId: acct.id }).returning({ id: bankImports.id });
      const tx1 = { bankImportId: imp.id, bankAccountId: acct.id, description: "تسوية", direction: "CREDIT" as const };
      await tx.insert(bankTransactions).values([
        { ...tx1, valueDate: day("2099-03-15"), amountMinor: 2_000_00, identityKey: `t-seal-${createId()}` },
        /* أوّلُ أبريل في الرياض — ليس من مارس */
        { ...tx1, valueDate: new Date("2099-03-31T22:00:00Z"), amountMinor: 7_00, identityKey: `t-seal-${createId()}` },
      ]);
      await tx.insert(reconciliationPeriods).values({
        bankAccountId: acct.id, periodStart: "2099-03-01", periodEnd: "2099-03-31", openingBalanceMinor: 0, closingBalanceMinor: 2_000_00,
      });
      await close(tx, "2099-03");

      const id = await sealMonth("2099-03", { actorId: null, origin: "CLOSE" }, tx);
      const [row] = await tx.select().from(monthSeals).where(eq(monthSeals.id, id));
      const sealed = readSealedFigures(row.figures);
      expect(sealed?.owed.suppliers.find((s) => s.id === supplierId)?.owedMinor).toBe(1_150_00);
      expect(sealed?.bank.find((b) => b.accountId === acct.id)).toMatchObject({ label: "الحساب الجاري", closingMinor: 2_000_00, creditsMinor: 2_000_00, debitsMinor: 0 });
      expect(sealed?.notSealed.length).toBeGreaterThan(0);

      const check = await checkSealedMonths(tx);
      expect(check.findings.filter((f) => f.month === "2099-03")).toEqual([]);
      expect(check.unsealed).not.toContain("2099-03");
    }));

  it("فاتورةٌ متأخّرة في شهرٍ قبله تحرّك «عليك» في آخره: يُقال الفرقُ بختمه — ويسقط بإعادة الإقفال", () =>
    withRollback(async (tx) => {
      const supplierId = await makeSupplier(tx);
      await makeInvoice(tx, supplierId, 1_150_00, "2099-03-10");
      await close(tx, "2099-03", ago(120_000));
      const sealId = await sealMonth("2099-03", { actorId: null, origin: "CLOSE", at: ago(60_000) }, tx);

      /* فبرايرُ مفتوح: تُقيَّد فيه فاتورةٌ وصلت متأخّرة */
      await makeInvoice(tx, supplierId, 230_00, "2099-02-20");
      const summary = await runSealCheck(null, tx);
      const mine = summary.findings.filter((f) => f.month === "2099-03");
      expect(mine).toContainEqual(expect.objectContaining({ sealId, sealedMinor: 1_150_00, nowMinor: 1_380_00 }));
      expect(mine.some((f) => f.figure.includes("عليك للمورّدين"))).toBe(true);

      const drift = await loadSealDrift(tx);
      expect(drift?.findings.some((f) => f.month === "2099-03")).toBe(true);

      /* أُعيد الفتحُ ثمّ الإقفال: ختمٌ جديد، والفرقُ القديم لا يُقال — قبل فحص الغد */
      await tx.update(monthCloses).set({ status: "OPEN", closedAt: null }).where(eq(monthCloses.month, "2099-03"));
      expect((await loadSealDrift(tx))?.findings.some((f) => f.month === "2099-03") ?? false).toBe(false);
      await tx.update(monthCloses).set({ status: "CLOSED", closedAt: new Date() }).where(eq(monthCloses.month, "2099-03"));
      expect(await unsealedClosedMonths(tx)).toContain("2099-03");
      await sealMonth("2099-03", { actorId: null, origin: "CLOSE", at: new Date(Date.now() + 1_000) }, tx);
      expect((await loadSealDrift(tx))?.findings.some((f) => f.month === "2099-03") ?? false).toBe(false);
      /* والختمان باقيان كلاهما — لا يُعدَّل ولا يُحذف */
      expect(await tx.select({ id: monthSeals.id }).from(monthSeals).where(eq(monthSeals.month, "2099-03"))).toHaveLength(2);
    }));

  it("شهرٌ أُقفل قبل الختم يُختم عند أوّل فحص (BACKFILL) مرّةً واحدة", () =>
    withRollback(async (tx) => {
      await tx.insert(monthCloses).values({ month: "2099-05", status: "CLOSED" });
      expect(await unsealedClosedMonths(tx)).toContain("2099-05");
      const first = await runSealCheck(null, tx);
      expect(first.sealedNow).toContain("2099-05");
      /* حسابُ الختم والمقارنةُ به في اللحظة نفسها لا يختلفان — الحسابُ حتميّ */
      expect(first.findings.filter((f) => f.month === "2099-05")).toEqual([]);
      const second = await runSealCheck(null, tx);
      expect(second.sealedNow).not.toContain("2099-05");
      const rows = await tx.select({ origin: monthSeals.origin }).from(monthSeals).where(eq(monthSeals.month, "2099-05"));
      expect(rows).toEqual([{ origin: "BACKFILL" }]);
    }));

  it("القاعدةُ ترفض تعديلَ الختم وحذفَه", () =>
    withRollback(async (tx) => {
      const figures = await computeMonthFigures("2099-06", tx);
      const [row] = await tx.insert(monthSeals).values({ month: "2099-06", origin: "CLOSE", figures }).returning({ id: monthSeals.id });
      for (const stmt of [
        sql`update month_seals set figures = '{}'::jsonb where id = ${row.id}`,
        sql`delete from month_seals where id = ${row.id}`,
      ]) {
        const err = pgErrorOf(await caught(tx.transaction(async (sp) => { await sp.execute(stmt); })));
        expect(err?.code).toBe("P0001");
        expect(err?.message).toMatch(/لا تُعدَّل ولا تُحذف/);
      }
      /* وأصلٌ غير معروف يُردّ */
      const bad = pgErrorOf(await caught(tx.transaction(async (sp) => {
        await sp.execute(sql`insert into month_seals (id, month, origin, figures) values (${createId()}, '2099-06', 'GUESS', '{}'::jsonb)`);
      })));
      expect(bad?.code).toBe("23514");
    }));
});

describe("رصيدُ القراءة الذكيّة في فحص الصباح", () => {
  it("يُحفظ ما قاله المزوّد، ويُنذر إن قلّ — والفحصُ القديم لا يُنذر", () =>
    withRollback(async (tx) => {
      await checkAiBalance(async () => ({ known: true, currency: "USD", cents: 3_20, available: true }), tx);
      const low = await loadLowAiBalance(new Date(), tx);
      expect(low).toMatchObject({ cents: 3_20, currency: "USD", available: true });
      expect(await loadLowAiBalance(new Date(Date.now() + 3 * 24 * 3_600_000), tx)).toBeNull();
    }));

  it("والمجهولُ يُحفظ مجهولاً ولا يُنذر كأنّه صفر", () =>
    withRollback(async (tx) => {
      const b = await checkAiBalance(async () => ({ known: false, reason: "ردّ المزوّد 401" }), tx);
      expect(b.known).toBe(false);
      expect(await loadLowAiBalance(new Date(), tx)).toBeNull();
    }));
});
