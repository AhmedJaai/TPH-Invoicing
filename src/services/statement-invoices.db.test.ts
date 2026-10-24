import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { day, makeDocument, makeSupplier, withRollback } from "@/test/db";
import { documents, invoices, issues, statementLines, statements, users } from "@/db/schema";
import { createInvoice } from "./invoice.service";
import { recordStatementOnlyInvoices, statementRefNumber } from "./statement-invoices.service";
import { loadRecordedInvoices } from "./document-backlog.service";
import type { Tx } from "./types";

process.env.COMPANY_VAT_NUMBER ??= "310007971600003";

async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `st-${Date.now()}-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}

async function statementWith(tx: Tx, supplierId: string, lines: { date: string; ref: string | null; debit: number; credit?: number; status?: "UNMATCHED" | "IGNORED" }[]) {
  const doc = await makeDocument(tx, supplierId, "2026-09-30");
  const [st] = await tx.insert(statements).values({
    documentId: doc, supplierId, periodStart: day("2026-09-01"), periodEnd: day("2026-09-30"),
    openingBalanceMinor: null, closingBalanceMinor: null,
  }).returning({ id: statements.id });
  for (const l of lines) {
    await tx.insert(statementLines).values({
      statementId: st.id, date: day(l.date), ref: l.ref, description: null,
      debitMinor: l.debit, creditMinor: l.credit ?? 0, matchStatus: l.status ?? "UNMATCHED",
    });
  }
  return st.id;
}

describe("قيد الناقصة من كشف المورّد (غاناش)", () => {
  it("يقيّد كلّ سطر مدين لم يطابق — بلا صاف ولا ضريبة، ويطابق السطر بها", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const st = await statementWith(tx, s, [
        { date: "2026-09-02", ref: "CIV-1 (Abhur - 1", debit: 533_60 },
        { date: "2026-09-04", ref: "CIV-2", debit: 455_40 },
        { date: "2026-09-03", ref: null, debit: 0, credit: 989_00, status: "IGNORED" },
      ]);
      const out = await recordStatementOnlyInvoices(tx, st, await someone(tx));
      expect(out.created.map((c) => c.number)).toEqual(["CIV-1", "CIV-2"]);
      const rows = await tx.select({ n: invoices.invoiceNumber, sub: invoices.subtotalMinor, tax: invoices.inputVatStatus, origin: documents.origin, file: documents.driveFileId })
        .from(invoices).innerJoin(documents, eq(documents.id, invoices.documentId)).where(eq(invoices.supplierId, s));
      expect(rows.every((r) => r.sub === null && r.tax === "NOT_ELIGIBLE" && r.origin === "STATEMENT_LINE" && r.file === null)).toBe(true);
      const lines = await tx.select({ m: statementLines.matchStatus }).from(statementLines).where(eq(statementLines.statementId, st));
      expect(lines.filter((l) => l.m === "MATCHED")).toHaveLength(2);

      /* ومرّةً ثانية لا يُقيَّد شيء */
      expect((await recordStatementOnlyInvoices(tx, st, await someone(tx))).created).toHaveLength(0);
    }));

  it("ملفّها حين يصل يتبنّى القيد نفسه — لا فاتورتان، ولا يحسب «مكرّرة»", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const st = await statementWith(tx, s, [{ date: "2026-09-02", ref: "CIV-9", debit: 115_00 }]);
      await recordStatementOnlyInvoices(tx, st, await someone(tx));
      const [before] = await tx.select({ id: invoices.id, doc: invoices.documentId }).from(invoices).where(eq(invoices.supplierId, s));
      expect((await loadRecordedInvoices(tx)).some((r) => r.supplierId === s)).toBe(false);

      const realDoc = await makeDocument(tx, s, "2026-09-02");
      const id = await createInvoice(tx, {
        documentId: realDoc, supplierId: s, invoiceNumber: "civ 9", invoiceDate: day("2026-09-02"), periodMonth: "2026-09",
        subtotalMinor: 100_00, vatMinor: 15_00, totalMinor: 115_00, sellerVat: "310111111100003", buyerVat: "310007971600003",
        taxStatus: "VALID", inputVatStatus: "ELIGIBLE", isFixedAsset: false,
      });
      expect(id).toBe(before.id);
      const all = await tx.select({ doc: invoices.documentId, tax: invoices.inputVatStatus }).from(invoices).where(eq(invoices.supplierId, s));
      expect(all).toEqual([{ doc: realDoc, tax: "ELIGIBLE" }]);
      expect(await tx.select({ id: documents.id }).from(documents).where(eq(documents.id, before.doc))).toHaveLength(0);
    }));

  it("سطر رقمه داخل فاتورة جامعة عندنا لا يقيّد ثانية (هنقري مان)", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const doc = await makeDocument(tx, s, "2026-05-01");
      await createInvoice(tx, {
        documentId: doc, supplierId: s, invoiceNumber: "INVA-02527-02717-02751-02781", invoiceDate: day("2026-05-01"), periodMonth: "2026-05",
        subtotalMinor: null, vatMinor: null, totalMinor: 240_00, taxStatus: "UNKNOWN", inputVatStatus: "UNKNOWN", isFixedAsset: false,
      });
      const st = await statementWith(tx, s, [
        { date: "2026-05-25", ref: "INVA/2026/02717 (Abhur - 001578", debit: 80_00 },
        { date: "2026-06-04", ref: "INVA/2026/02849", debit: 80_00 },
      ]);
      const out = await recordStatementOnlyInvoices(tx, st, await someone(tx));
      expect(out.created.map((c) => c.number)).toEqual(["INVA/2026/02849"]);
      const lines = await tx.select({ ref: statementLines.ref, m: statementLines.matchStatus }).from(statementLines).where(eq(statementLines.statementId, st));
      expect(lines.every((l) => l.m === "MATCHED")).toBe(true);
    }));

  it("رقم السطر بلا وصف الفرع", () => {
    expect(statementRefNumber("INVA/2026/02717 (Abhur - 001578")).toBe("INVA/2026/02717");
  });

  /*
    بيكوف ٢٦ أغسطس (الإنتاج، ٢٤ أكتوبر): القراءةُ الثالثة للكشف أخذت مرجعَ سطر الفاتورة من
    سطر السداد المجاور «000285لـ#»، فقيّد «قيّد الناقصة» فاتورةً ثانيةً بـ١٥٠ وهي 00346.
  */
  describe("المرجع المقروء خطأً (بيكوف)", () => {
    async function numbered(tx: Tx, s: string, number: string, iso: string, total: number) {
      const doc = await makeDocument(tx, s, iso);
      const id = await createInvoice(tx, {
        documentId: doc, supplierId: s, invoiceNumber: number, invoiceDate: day(iso), periodMonth: iso.slice(0, 7),
        subtotalMinor: null, vatMinor: null, totalMinor: total, taxStatus: "UNKNOWN", inputVatStatus: "UNKNOWN", isFixedAsset: false,
      });
      if (!id) throw new Error("لم تنشأ الفاتورة");
      return id;
    }
    async function bekov(tx: Tx, extra150 = false) {
      const s = await makeSupplier(tx);
      const i346 = await numbered(tx, s, "00346", "2026-08-26", 150_00);
      const i350 = await numbered(tx, s, "00350", "2026-09-01", 200_00);
      const i347 = extra150 ? await numbered(tx, s, "00347", "2026-08-26", 150_00) : null;
      /* القراءة الثانية: طابق سطرُها 00346 برقمه */
      const second = await statementWith(tx, s, [
        { date: "2026-08-26", ref: "000279#", debit: 0, credit: 750_00, status: "IGNORED" },
        { date: "2026-08-26", ref: "00346#", debit: 150_00 },
      ]);
      await tx.update(statementLines).set({ matchedInvoiceId: i346, matchStatus: "MATCHED" })
        .where(and(eq(statementLines.statementId, second), eq(statementLines.ref, "00346#")));
      /* القراءة الثالثة: المرجعُ مأخوذٌ من سطر السداد */
      const third = await statementWith(tx, s, [
        { date: "2026-08-26", ref: "000279#", debit: 0, credit: 750_00, status: "IGNORED" },
        { date: "2026-08-26", ref: "00281#", debit: 0, credit: 150_00, status: "IGNORED" },
        { date: "2026-08-26", ref: "000285لـ#", debit: 150_00 },
        { date: "2026-09-01", ref: "00350#", debit: 200_00 },
      ]);
      await tx.update(statementLines).set({ matchedInvoiceId: i350, matchStatus: "MATCHED" })
        .where(and(eq(statementLines.statementId, third), eq(statementLines.ref, "00350#")));
      return { s, i346, i347, third };
    }

    it("يطابق السطر بـ00346 ولا يقيّد فاتورة جديدة", () =>
      withRollback(async (tx) => {
        const { s, i346, third } = await bekov(tx);
        const out = await recordStatementOnlyInvoices(tx, third, await someone(tx));
        expect(out.created).toHaveLength(0);
        expect(out.matchedByAmount).toEqual([{ ref: "000285لـ#", invoiceNumber: "00346", date: "2026-08-26", amountMinor: 150_00 }]);
        const [l] = await tx.select({ m: statementLines.matchStatus, inv: statementLines.matchedInvoiceId }).from(statementLines)
          .where(and(eq(statementLines.statementId, third), eq(statementLines.ref, "000285لـ#")));
        expect(l).toEqual({ m: "MATCHED", inv: i346 });
        expect(await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.supplierId, s))).toHaveLength(2);
        /* ومرّةً ثانية لا شيء — والسطرُ صار مطابَقاً */
        const again = await recordStatementOnlyInvoices(tx, third, await someone(tx));
        expect(again.created.length + again.matchedByAmount.length).toBe(0);
      }));

    it("فاتورتان باليوم والمبلغ: لا يقيّد ولا يخمّن — يُذكر ملتبساً بمرشّحيه", () =>
      withRollback(async (tx) => {
        const { s, third } = await bekov(tx, true);
        const out = await recordStatementOnlyInvoices(tx, third, await someone(tx));
        expect(out.created).toHaveLength(0);
        expect(out.matchedByAmount).toHaveLength(0);
        expect(out.ambiguous).toHaveLength(1);
        expect([...out.ambiguous[0].candidates].sort()).toEqual(["00346", "00347"]);
        expect(await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.supplierId, s))).toHaveLength(3);
        /* وتنبيهُ الكشف يقوله ملتبساً لا «بلا ملف» */
        const open = await tx.select({ code: issues.code }).from(issues)
          .where(and(eq(issues.entityType, "statement"), eq(issues.entityId, third), eq(issues.status, "OPEN")));
        expect(open.map((o) => o.code)).toContain("STATEMENT_LINE_AMBIGUOUS");
        expect(open.map((o) => o.code)).not.toContain("INVOICE_IN_STATEMENT_NOT_ARCHIVED");
      }));

    it("ولا فاتورة باليوم والمبلغ: المرجع الملتبس لا يُقيَّد رقماً", () =>
      withRollback(async (tx) => {
        const s = await makeSupplier(tx);
        const i350 = await numbered(tx, s, "00350", "2026-09-01", 200_00);
        const st = await statementWith(tx, s, [
          { date: "2026-08-26", ref: "000285لـ#", debit: 150_00 },
          { date: "2026-09-01", ref: "00350#", debit: 200_00 },
          { date: "2026-09-03", ref: "00351#", debit: 90_00 },
        ]);
        await tx.update(statementLines).set({ matchedInvoiceId: i350, matchStatus: "MATCHED" })
          .where(and(eq(statementLines.statementId, st), eq(statementLines.ref, "00350#")));
        const out = await recordStatementOnlyInvoices(tx, st, await someone(tx));
        expect(out.unclear.map((u) => u.ref)).toEqual(["000285لـ#"]);
        expect(out.created.map((c) => c.number)).toEqual(["00351#"]);
      }));
  });
});
