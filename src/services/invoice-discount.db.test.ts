import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { caught, day, makeDocument, makeInvoice, makeSupplier, pgErrorOf, withRollback } from "@/test/db";
import { invoices, users } from "@/db/schema";
import { createInvoice } from "./invoice.service";
import { correctInvoice, InvoiceCorrectionRefused } from "./invoice-correction.service";
import type { Tx } from "./types";

process.env.COMPANY_VAT_NUMBER ??= "310007971600003";

async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `disc-${Date.now()}-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}

async function discountOf(tx: Tx, id: string) {
  const [r] = await tx.select({ d: invoices.discountMinor, t: invoices.totalMinor }).from(invoices).where(eq(invoices.id, id));
  return r;
}

/* ١٠٠٠ + ١٥٠ ضريبة − ٥٠ خصمٌ نقديّ = ١١٠٠ مستحقّ */
const paper = { subtotalMinor: 1_000_00, vatMinor: 150_00, totalMinor: 1_100_00 };

describe("الخصمُ بعد الضريبة (054)", () => {
  it("يُقيَّد الخصمُ المقروء إن سدّ الفرق، والمستحقُّ هو الإجماليّ بعده", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const doc = await makeDocument(tx, s, "2026-09-10");
      const id = await createInvoice(tx, {
        documentId: doc, supplierId: s, invoiceNumber: "D-1", invoiceDate: day("2026-09-10"), periodMonth: "2026-09",
        ...paper, discountReadMinor: 50_00, taxStatus: "VALID", inputVatStatus: "ELIGIBLE", isFixedAsset: false,
      });
      expect(await discountOf(tx, id!)).toEqual({ d: 50_00, t: 1_100_00 });
    }));

  it("القاعدةُ ترفض الفرقَ بلا خصمٍ يسدّه — بالقيد الذي يسمّيه", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 1_150_00, "2026-09-10");
      const e = await caught(tx.transaction((t) => t.execute(sql`
        update invoices set total_minor = 110000, subtotal_minor = 100000, vat_minor = 15000 where id = ${inv}
      `)));
      expect(pgErrorOf(e)?.message).toMatch(/invoices_parts_sum_to_total/);
      /* والخصمُ نفسُه يجعله مقبولاً */
      await tx.execute(sql`
        update invoices set total_minor = 110000, subtotal_minor = 100000, vat_minor = 15000, discount_minor = 5000 where id = ${inv}
      `);
    }));

  it("يُصحَّح بكتابة الخصم، ويُمحى حين يستقيم الحسابُ بدونه", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 1_150_00, "2026-09-10");
      const who = await someone(tx);
      await correctInvoice(tx, { invoiceId: inv, ...paper, discountMinor: 50_00 }, who);
      expect(await discountOf(tx, inv)).toEqual({ d: 50_00, t: 1_100_00 });

      /* قُرئ الإجماليُّ خطأً: ١١٥٠ بلا خصم — الخصمُ المحفوظ لا يسدّ شيئاً فيُمحى */
      await correctInvoice(tx, { invoiceId: inv, totalMinor: 1_150_00 }, who);
      expect(await discountOf(tx, inv)).toEqual({ d: null, t: 1_150_00 });
    }));

  it("خصمٌ مكتوبٌ لا يسدّ الفرق يُردّ بجملة لا بخطأ قاعدة", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 1_150_00, "2026-09-10");
      await expect(correctInvoice(tx, { invoiceId: inv, ...paper, discountMinor: 20_00 }, await someone(tx)))
        .rejects.toBeInstanceOf(InvoiceCorrectionRefused);
    }));

  it("رسومُ التوصيل بعد الضريبة تُقيَّد بالقاعدة نفسها (055)", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const doc = await makeDocument(tx, s, "2026-09-10");
      const id = await createInvoice(tx, {
        documentId: doc, supplierId: s, invoiceNumber: "R-4136", invoiceDate: day("2026-09-10"), periodMonth: "2026-09",
        subtotalMinor: 925_00, vatMinor: 138_75, totalMinor: 1_088_75, chargesReadMinor: 25_00,
        taxStatus: "VALID", inputVatStatus: "ELIGIBLE", isFixedAsset: false,
      });
      const [r] = await tx.select({ c: invoices.chargesMinor, d: invoices.discountMinor }).from(invoices).where(eq(invoices.id, id!));
      expect(r).toEqual({ c: 25_00, d: null });
    }));
});
