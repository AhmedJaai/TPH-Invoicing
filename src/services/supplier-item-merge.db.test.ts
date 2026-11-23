import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { caught, day, makeInvoice, makeSupplier, withRollback } from "@/test/db";
import { invoiceLines, products, supplierItemAliases, supplierProducts, users } from "@/db/schema";
import { normalizeItem } from "@/lib/items";
import { replaceLines } from "./invoice.service";
import { ItemMergeRefused, mergeSupplierItems, unmergeSupplierItem } from "./supplier-item-merge.service";
import type { Tx } from "./types";

process.env.COMPANY_VAT_NUMBER ??= "310007971600003";

async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `merge-${Date.now()}-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}
const line = (description: string) => ({ description, quantity: "1", unitPrice: "100", lineTotal: "100" });

describe("صيغة صنف المورّد تدمج بأصلها (056)", () => {
  it("«كولومي عنب» هو «كولومبي عنب»: تنقل بنوده، ويكتب بالأصل ما يأتي بعده", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const a = await makeInvoice(tx, s, 115_00, "2026-09-01");
      const b = await makeInvoice(tx, s, 115_00, "2026-09-05");
      await replaceLines(tx, { invoiceId: a, supplierId: s, invoiceDate: day("2026-09-01"), subtotalMinor: null, lines: [line("كولومبي عنب")] });
      await replaceLines(tx, { invoiceId: b, supplierId: s, invoiceDate: day("2026-09-05"), subtotalMinor: null, lines: [line("كولومي عنب")] });

      const out = await mergeSupplierItems(tx, { supplierId: s, from: normalizeItem("كولومي عنب"), into: normalizeItem("كولومبي عنب") }, await someone(tx));
      expect(out.linesMoved).toBe(1);
      const sps = await tx.select({ n: supplierProducts.normalizedDescription }).from(supplierProducts).where(eq(supplierProducts.supplierId, s));
      expect(sps.map((x) => x.n)).toEqual([normalizeItem("كولومبي عنب")]);

      /* فاتورةٌ لاحقة بالصيغة نفسها تُكتب بالأصل — والوصفُ المطبوع كما هو */
      const c = await makeInvoice(tx, s, 115_00, "2026-09-09");
      await replaceLines(tx, { invoiceId: c, supplierId: s, invoiceDate: day("2026-09-09"), subtotalMinor: null, lines: [line("كولومي عنب")] });
      const [l] = await tx.select({ d: invoiceLines.description, n: invoiceLines.normalizedDescription }).from(invoiceLines)
        .where(and(eq(invoiceLines.invoiceId, c)));
      expect(l).toEqual({ d: "كولومي عنب", n: normalizeItem("كولومبي عنب") });
    }));

  it("صنفان مربوطان بصنفي جرد مختلفين لا يدمجان", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 115_00, "2026-09-01");
      await replaceLines(tx, { invoiceId: inv, supplierId: s, invoiceDate: day("2026-09-01"), subtotalMinor: null, lines: [line("حليب"), line("حليب لوز")] });
      const [p1] = await tx.insert(products).values({ nameAr: `حليب-${Math.random()}`, category: "DAIRY", baseUnit: "L" }).returning({ id: products.id });
      const [p2] = await tx.insert(products).values({ nameAr: `لوز-${Math.random()}`, category: "DAIRY", baseUnit: "L" }).returning({ id: products.id });
      await tx.update(supplierProducts).set({ productId: p1.id }).where(and(eq(supplierProducts.supplierId, s), eq(supplierProducts.normalizedDescription, normalizeItem("حليب"))));
      await tx.update(supplierProducts).set({ productId: p2.id }).where(and(eq(supplierProducts.supplierId, s), eq(supplierProducts.normalizedDescription, normalizeItem("حليب لوز"))));
      const e = await caught(tx.transaction((t) => mergeSupplierItems(t, { supplierId: s, from: normalizeItem("حليب لوز"), into: normalizeItem("حليب") }, "x")));
      expect(e).toBeInstanceOf(ItemMergeRefused);
    }));

  it("الدمجُ الخاطئ يُفصل: تعود بنودُ الصيغة صنفاً بلا ربط، ويبقى الأصلُ بربطه، ويُكتب بها ما يأتي بعده", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 115_00, "2026-09-01");
      await replaceLines(tx, { invoiceId: inv, supplierId: s, invoiceDate: day("2026-09-01"), subtotalMinor: null, lines: [line("Cheesecake Date Brulee L"), line("Crunchy Chocolate Cake L")] });
      const [p] = await tx.insert(products).values({ nameAr: `مدريد-${Math.random()}`, category: "OTHER", baseUnit: "PIECE" }).returning({ id: products.id });
      const cheese = normalizeItem("Cheesecake Date Brulee L"), crunchy = normalizeItem("Crunchy Chocolate Cake L");
      await tx.update(supplierProducts).set({ productId: p.id }).where(and(eq(supplierProducts.supplierId, s), eq(supplierProducts.normalizedDescription, cheese)));
      const who = await someone(tx);
      await mergeSupplierItems(tx, { supplierId: s, from: crunchy, into: cheese }, who);

      const out = await unmergeSupplierItem(tx, { supplierId: s, alias: crunchy }, who);
      expect(out).toEqual({ linesMoved: 1, displayName: "Crunchy Chocolate Cake L" });
      const sps = await tx.select({ n: supplierProducts.normalizedDescription, p: supplierProducts.productId }).from(supplierProducts).where(eq(supplierProducts.supplierId, s));
      expect(sps.sort((a, b) => a.n.localeCompare(b.n))).toEqual([{ n: cheese, p: p.id }, { n: crunchy, p: null }].sort((a, b) => a.n.localeCompare(b.n)));
      expect(await tx.select().from(supplierItemAliases).where(eq(supplierItemAliases.supplierId, s))).toEqual([]);

      const later = await makeInvoice(tx, s, 115_00, "2026-09-09");
      await replaceLines(tx, { invoiceId: later, supplierId: s, invoiceDate: day("2026-09-09"), subtotalMinor: null, lines: [line("Crunchy Chocolate Cake L")] });
      const [l] = await tx.select({ n: invoiceLines.normalizedDescription }).from(invoiceLines).where(eq(invoiceLines.invoiceId, later));
      expect(l.n).toBe(crunchy);

      const again = await caught(tx.transaction((t) => unmergeSupplierItem(t, { supplierId: s, alias: crunchy }, who)));
      expect(again).toBeInstanceOf(ItemMergeRefused);
    }));
});
