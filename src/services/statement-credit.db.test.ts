import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { caught, day, makeDocument, makeInvoice, makeSupplier, withRollback } from "@/test/db";
import { monthCloses, statementLines, statements, users } from "@/db/schema";
import { CreditNoteRefused } from "./credit-note.service";
import { reversePayment } from "./payment.service";
import { loadStatementCredits, recordCreditFromStatementLine } from "./statement-credit.service";
import { loadSettlementComparisons } from "./statement-payments.service";
import { loadSupplierBalances } from "./supplier-balance.service";
import { MonthClosedError } from "./validation.service";
import type { Tx } from "./types";

async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `sc-${Date.now()}-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}

/** كشفٌ بافتتاحيّه وختاميّه — والختاميُّ معادلةُ أسطره: افتتاحي + مدين − دائن. */
async function statementWith(
  tx: Tx, supplierId: string, opening: number,
  lines: { date: string; ref: string | null; description?: string | null; debit?: number; credit?: number }[],
) {
  const closing = opening + lines.reduce((s, l) => s + (l.debit ?? 0) - (l.credit ?? 0), 0);
  const doc = await makeDocument(tx, supplierId, "2026-09-30");
  const [st] = await tx.insert(statements).values({
    documentId: doc, supplierId, periodStart: day("2026-09-01"), periodEnd: day("2026-09-30"),
    openingBalanceMinor: opening, closingBalanceMinor: closing,
  }).returning({ id: statements.id });
  const ids: string[] = [];
  for (const l of lines) {
    const [row] = await tx.insert(statementLines).values({
      statementId: st.id, date: day(l.date), ref: l.ref, description: l.description ?? null,
      debitMinor: l.debit ?? 0, creditMinor: l.credit ?? 0, matchStatus: "UNMATCHED",
    }).returning({ id: statementLines.id });
    ids.push(row.id);
  }
  return { statementId: st.id, lineIds: ids, closing };
}

async function equationHolds(tx: Tx, statementId: string): Promise<boolean> {
  const [r] = (await tx.execute<{ ok: boolean }>(sql`
    select (st.opening_balance_minor + coalesce(sum(sl.debit_minor), 0) - coalesce(sum(sl.credit_minor), 0)) = st.closing_balance_minor as ok
      from statements st left join statement_lines sl on sl.statement_id = st.id
     where st.id = ${statementId} group by st.id`)).rows;
  return r.ok;
}

describe("إشعارُ كشف المورّد مقابلَ الإشعار المسجَّل", () => {
  it("يُقيَّد من سطره فيُطابَق، ورصيدُ المورّد يساوي ختاميَّ كشفه — والمقابلةُ لا تغيّر الرصيد", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      await makeInvoice(tx, s, 1000_00, "2026-09-02");
      await makeInvoice(tx, s, 500_00, "2026-09-05");
      const { statementId, lineIds, closing } = await statementWith(tx, s, 0, [
        { date: "2026-09-02", ref: "A-1", debit: 1000_00 },
        { date: "2026-09-05", ref: "A-2", debit: 500_00 },
        { date: "2026-09-10", ref: "CN-0077", description: "إشعار دائن مرتجع", credit: 200_00 },
      ]);
      const creditLine = lineIds[2];
      expect(await equationHolds(tx, statementId)).toBe(true);

      /* قبل القيد: دائنٌ في الكشف بلا إشعار مسجَّل، ورصيدُنا أعلى من ختاميّه بمبلغه */
      const owed = async () => (await loadSupplierBalances(tx, s))[0].owedMinor;
      const before = (await loadStatementCredits([statementId], tx)).get(statementId)!.result;
      expect(before.unrecorded.map((l) => l.id)).toEqual([creditLine]);
      expect(await owed()).toBe(1500_00);
      /* والمقابلةُ قراءة: لا تكتب ولا تحرّك الرصيد */
      await loadStatementCredits([statementId], tx);
      await loadSettlementComparisons([s], tx);
      expect(await owed()).toBe(1500_00);

      const out = await recordCreditFromStatementLine(tx, { statementLineId: creditLine }, await someone(tx));
      expect(out.invoiceNumber).toBeNull();

      const after = (await loadStatementCredits([statementId], tx)).get(statementId)!.result;
      expect(after.unrecorded).toEqual([]);
      expect(after.matched.map((m) => [m.line.id, m.note.paymentId, m.by])).toEqual([[creditLine, out.paymentId, "REF"]]);
      expect(await owed()).toBe(closing);
      /* إعادةُ المقابلة لا تحرّك الرصيد، والكشفُ نفسه لم يُمسّ */
      await loadStatementCredits([statementId], tx);
      const settled = (await loadSettlementComparisons([s], tx))[0].comparison;
      expect(settled.matched.filter((m) => m.kind === "CREDIT_NOTE")).toHaveLength(1);
      expect(settled.theirsOnly).toEqual([]);
      expect(await owed()).toBe(closing);
      expect(await equationHolds(tx, statementId)).toBe(true);

      /* والدليلُ بنصّ السطر في سجلّ التدقيق */
      const [a] = (await tx.execute<{ origin: { statementLineId: string } | null }>(sql`
        select after->'من كشف المورّد' as origin from audit_logs where action = 'PAYMENT_CREDIT_NOTE_RECORDED' and entity_id = ${s}`)).rows;
      expect(a.origin?.statementLineId).toBe(creditLine);

      /* ضغطةٌ ثانية لا تقيّده مرّتين */
      const again = await caught(recordCreditFromStatementLine(tx, { statementLineId: creditLine }, await someone(tx)));
      expect(again).toBeInstanceOf(CreditNoteRefused);
      const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from payments where supplier_id = ${s} and method = 'CREDIT_NOTE'`)).rows;
      expect(n).toBe(1);

      /* والتراجعُ ردُّ الإشعار: يعود السطرُ «بلا إشعار مسجَّل» والرصيدُ كما كان */
      await reversePayment(tx, { paymentId: out.paymentId, kind: "VOID", reason: "اختبار التراجع", userId: await someone(tx) });
      const undone = (await loadStatementCredits([statementId], tx)).get(statementId)!.result;
      expect(undone.unrecorded.map((l) => l.id)).toEqual([creditLine]);
      expect(await owed()).toBe(1500_00);
    }));

  it("عكسُ فاتورةٍ ليست عندنا لا يُقيَّد إشعاراً، وعكسُ فاتورةٍ عندنا يُقيَّد عليها", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const inv = await makeInvoice(tx, s, 300_00, "2026-09-03");
      const [{ num }] = (await tx.execute<{ num: string }>(sql`select invoice_number as num from invoices where id = ${inv}`)).rows;
      const { lineIds } = await statementWith(tx, s, 150_00, [
        { date: "2026-09-03", ref: num, debit: 300_00 },
        { date: "2026-09-08", ref: "RINV/2026/00016 (Reversal of: INV/2026/99980)", description: "مستحق", credit: 150_00 },
        { date: "2026-09-09", ref: `RINV/2026/00017 (Reversal of: ${num})`, credit: 300_00 },
      ]);
      const unknown = await caught(recordCreditFromStatementLine(tx, { statementLineId: lineIds[1] }, await someone(tx)));
      expect(unknown).toBeInstanceOf(CreditNoteRefused);
      expect((unknown as Error).message).toContain("ليست في سجلاتنا");

      const out = await recordCreditFromStatementLine(tx, { statementLineId: lineIds[2] }, await someone(tx));
      expect(out.invoiceNumber).toBe(num);
      expect((await loadSupplierBalances(tx, s))[0].owedMinor).toBe(0);
    }));

  it("الشهرُ المقفل لا يُكتب فيه من سطر الكشف", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      await makeInvoice(tx, s, 1000_00, "2026-09-02");
      const { lineIds } = await statementWith(tx, s, 0, [
        { date: "2026-09-02", ref: "B-1", debit: 1000_00 },
        { date: "2026-09-10", ref: null, description: "إشعار دائن", credit: 100_00 },
      ]);
      await tx.insert(monthCloses).values({ month: "2026-09", status: "CLOSED" });
      const e = await caught(recordCreditFromStatementLine(tx, { statementLineId: lineIds[1] }, await someone(tx)));
      expect(e).toBeInstanceOf(MonthClosedError);
    }));

  it("سطرُ السداد لا يُقيَّد إشعاراً، والسطرُ الغائب يُقال غائباً", () =>
    withRollback(async (tx) => {
      const s = await makeSupplier(tx);
      const { lineIds } = await statementWith(tx, s, 100_00, [{ date: "2026-09-10", ref: null, description: "حوالة بنكية", credit: 100_00 }]);
      expect(await caught(recordCreditFromStatementLine(tx, { statementLineId: lineIds[0] }, await someone(tx)))).toBeInstanceOf(CreditNoteRefused);
      await tx.delete(statementLines).where(eq(statementLines.id, lineIds[0]));
      expect(await caught(recordCreditFromStatementLine(tx, { statementLineId: lineIds[0] }, await someone(tx)))).toBeInstanceOf(CreditNoteRefused);
    }));
});
