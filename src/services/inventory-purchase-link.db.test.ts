import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { caught, makeInvoice, makeSupplier, withRollback } from "@/test/db";
import { replaceLines } from "./invoice.service";
import { isolateProducts, makeActor, makeBranch, makeInvoicePurchase, makeStockProduct } from "@/test/inventory";
import { recomputeCount, startCount } from "./inventory.service";
import {
  PurchaseLinkRefused, loadPurchaseLinks, loadStockItemOptions, savePurchaseLink,
} from "./inventory-purchase-link.service";
import { toCanonical } from "@/lib/inventory/units";
import type { Tx } from "./types";

/**
 * بندُ الفاتورة ← صنفُ الجرد، من داخل الجرد — على المخطّط الحقيقيّ.
 *
 * «1 كيلو اوغندا» في الفاتورة و«بنّ» في الوصفة: بلا ربطٍ لا يدخل البندُ
 * الجرد، وبربطٍ بلا عبوةٍ يبقى «غير معروف». والربطُ مع العبوة يُدخله،
 * ويبقى لصنف المورّد فلا يُسأل عنه في الأسبوع التالي.
 */

const WEEK = { start: "2026-09-13", end: "2026-09-19" };
const NEXT = { start: "2026-09-20", end: "2026-09-26" };

async function setup(tx: Tx) {
  const actorId = await makeActor(tx);
  const branch = await makeBranch(tx);
  const coffee = await makeStockProduct(tx, "بنّ", "G", "COFFEE");
  const milk = await makeStockProduct(tx, "حليب", "L", "DAIRY");
  await isolateProducts(tx, [coffee, milk]);
  /* خمسةُ أكياس، والصنفُ بلا ربطٍ ولا عبوة — كما يصل من الاستخراج */
  const lineId = await makeInvoicePurchase(tx, coffee, "2026-09-14", 440_00, null);
  const [{ sp }] = (await tx.execute<{ sp: string }>(sql`
    update invoice_lines set qty = 5 where id = ${lineId} returning supplier_product_id as sp
  `)).rows;
  await tx.execute(sql`update supplier_products set product_id = null where id = ${sp}`);
  return { actorId, branch, coffee, milk, sp };
}

describe("ربطُ بنود الفواتير من الجرد", () => {
  it("غيرُ المربوط يظهر بحاله، والربطُ مع العبوة يُدخل ٥ × ١ كجم = ٥٠٠٠ جرام", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee, sp } = await setup(tx);
      const { countId } = await startCount({ periodStart: WEEK.start, periodEnd: WEEK.end, branchId: branch.id, actorId }, tx);
      const options = await loadStockItemOptions(tx);

      const before = await loadPurchaseLinks(WEEK.start, WEEK.end, options, tx);
      const row = before.find((r) => r.supplierProductId === sp)!;
      expect(row.status).toBe("UNLINKED_PRODUCT");
      expect(row.qtyText).toBe("5");

      await savePurchaseLink({ supplierProductId: sp, productId: coffee, packSize: "1", contentQuantity: "1", contentUnit: "KG" }, actorId, tx);

      const after = (await loadPurchaseLinks(WEEK.start, WEEK.end, options, tx)).find((r) => r.supplierProductId === sp)!;
      expect(after.status).toBe("LINKED");
      expect(after.pack).toEqual({ packSize: "1", contentQuantity: "1", contentUnit: "KG" });

      const report = await recomputeCount(countId, tx);
      const line = report.lines.find((l) => l.productId === coffee)!;
      expect(line.purchasesMilli).toBe(toCanonical(5_000_000, "G"));

      const [audit] = (await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from audit_logs where action = 'PRODUCT_LINKED' and entity_id = ${sp}
      `)).rows;
      expect(audit.n).toBe(1);
    }));

  it("والربطُ يبقى: فاتورةُ الأسبوع التالي من الصنف نفسه تدخل بلا سؤال", () =>
    withRollback(async (tx) => {
      const { actorId, coffee, sp } = await setup(tx);
      await savePurchaseLink({ supplierProductId: sp, productId: coffee, packSize: "1", contentQuantity: "1", contentUnit: "KG" }, actorId, tx);
      await tx.execute(sql`
        insert into invoice_lines (id, invoice_id, description, normalized_description, qty, unit_price_minor, line_total_minor,
                                   invoice_date, supplier_id, supplier_product_id)
        select 'il-next-' || ${sp}, invoice_id, description, normalized_description, 2, unit_price_minor, line_total_minor,
               ${new Date("2026-09-22T09:00:00+03:00")}, supplier_id, supplier_product_id
          from invoice_lines where supplier_product_id = ${sp} limit 1
      `);
      await tx.execute(sql`
        update invoices set invoice_date = ${new Date("2026-09-22T09:00:00+03:00")}, received_on = null
         where id = (select invoice_id from invoice_lines where id = ${`il-next-${sp}`})
      `);
      const next = await loadPurchaseLinks(NEXT.start, NEXT.end, await loadStockItemOptions(tx), tx);
      expect(next.find((r) => r.supplierProductId === sp)?.status).toBe("LINKED");
    }));

  it("اللترُ لا يُحوَّل إلى جرام — يُرفَض ولا يُكتَب شيء", () =>
    withRollback(async (tx) => {
      const { actorId, coffee, sp } = await setup(tx);
      const e = await caught(savePurchaseLink(
        { supplierProductId: sp, productId: coffee, packSize: "12", contentQuantity: "1", contentUnit: "L" }, actorId, tx,
      ));
      expect(e).toBeInstanceOf(PurchaseLinkRefused);
      const [row] = (await tx.execute<{ product_id: string | null; content_unit: string | null }>(sql`
        select product_id, content_unit::text from supplier_products where id = ${sp}
      `)).rows;
      expect(row).toEqual({ product_id: null, content_unit: null });
    }));

  it("والصفرُ ليس عبوة", () =>
    withRollback(async (tx) => {
      const { actorId, coffee, sp } = await setup(tx);
      const e = await caught(savePurchaseLink(
        { supplierProductId: sp, productId: coffee, packSize: "0", contentQuantity: "1", contentUnit: "KG" }, actorId, tx,
      ));
      expect(e).toBeInstanceOf(PurchaseLinkRefused);
    }));

  it("كما في الإنتاج: فاتورةٌ تُحفَظ فيُبنى صنفُ مورّدها، ويُربَط مرّةً فتدخل التاليةُ مربوطةً وحدها", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const coffee = await makeStockProduct(tx, "بنّ أوغندا", "G", "COFFEE");
      await isolateProducts(tx, [coffee]);
      const supplierId = await makeSupplier(tx);
      const item = { description: "1 كيلو اوغندا اميولو مقطرة اكياس بيضاء", quantity: "5", unitPrice: "88", lineTotal: "440" };

      /* بنودٌ كانت تُكتَب بلا صنف مورّد — فلا يراها لوحُ الربط أصلاً */
      const first = await makeInvoice(tx, supplierId, 506_00, "2026-09-14");
      await replaceLines(tx, { invoiceId: first, supplierId, invoiceDate: new Date("2026-09-14T09:00:00+03:00"), subtotalMinor: 440_00, lines: [item] });
      const options = await loadStockItemOptions(tx);
      const row = (await loadPurchaseLinks(WEEK.start, WEEK.end, options, tx)).find((r) => r.displayName.includes("اوغندا"))!;
      expect(row.status).toBe("UNLINKED_PRODUCT");
      expect(row.suggestedProductId).toBe(coffee);
      expect(row.guessedPack).toEqual({ packSize: "1", contentQuantity: "1", contentUnit: "KG" });

      await savePurchaseLink({ supplierProductId: row.supplierProductId, productId: coffee, packSize: "1", contentQuantity: "1", contentUnit: "KG" }, actorId, tx);

      const second = await makeInvoice(tx, supplierId, 506_00, "2026-09-21");
      await replaceLines(tx, { invoiceId: second, supplierId, invoiceDate: new Date("2026-09-21T09:00:00+03:00"), subtotalMinor: 440_00, lines: [item] });
      const next = (await loadPurchaseLinks(NEXT.start, NEXT.end, options, tx)).find((r) => r.supplierProductId === row.supplierProductId)!;
      expect(next.status).toBe("LINKED");
      expect(next.countedText).not.toBeNull();
    }));
});
