import { describe, expect, it } from "vitest";
import {
  CREDIT_NOTE_LABEL_PREFIX, creditNoteReferenceOf, matchCreditNotes, normalizeCreditRef, reversedInvoiceOf,
  type RecordedCreditNote, type StatementCreditNoteLine,
} from "./credit-notes";

const PERIOD = { from: "2026-09-01", to: "2026-09-30" };
const line = (id: string, day: string, amountMinor: number, ref: string | null = null, description: string | null = "إشعار دائن"): StatementCreditNoteLine =>
  ({ id, day, ref, description, amountMinor });
const note = (paymentId: string, day: string, amountMinor: number, reference: string | null = null): RecordedCreditNote =>
  ({ paymentId, day, amountMinor, reference });

describe("مرجعُ الإشعار من اسمه المحفوظ", () => {
  it("يعود كما كُتب، وبلا مرجعٍ null", () => {
    expect(creditNoteReferenceOf(`${CREDIT_NOTE_LABEL_PREFIX} CN-12`)).toBe("CN-12");
    expect(creditNoteReferenceOf(CREDIT_NOTE_LABEL_PREFIX)).toBeNull();
    expect(creditNoteReferenceOf("حوالة")).toBeNull();
  });
});

describe("إشعاراتُ الكشف مقابلَ ما قيّدناه", () => {
  it("بالرقم والمبلغ بالهللة — مطابَق", () => {
    const r = matchCreditNotes([line("l1", "2026-09-10", 700_00, "CN-0012")], [note("p1", "2026-09-12", 700_00, "CN-0012")], PERIOD);
    expect(r.matched.map((m) => [m.line.id, m.note.paymentId, m.by])).toEqual([["l1", "p1", "REF"]]);
    expect(r.unrecorded).toEqual([]);
    expect(r.notInStatement).toEqual([]);
  });

  it("الرقم نفسه والمبلغ غيره: اقتراحٌ لا مطابقة", () => {
    const r = matchCreditNotes([line("l1", "2026-09-10", 700_00, "CN-0012")], [note("p1", "2026-09-10", 650_00, "CN-0012")], PERIOD);
    expect(r.matched).toEqual([]);
    expect(r.suggested.map((s) => s.line.id)).toEqual(["l1"]);
    expect(r.unrecorded).toEqual([]);
    expect(r.notInStatement).toEqual([]);
  });

  it("بلا رقم: المبلغُ بالهللة وحده، ولا تسامحَ بريال", () => {
    const exact = matchCreditNotes([line("l1", "2026-09-10", 700_00)], [note("p1", "2026-09-15", 700_00)], PERIOD);
    expect(exact.matched.map((m) => m.by)).toEqual(["AMOUNT"]);
    const off = matchCreditNotes([line("l1", "2026-09-10", 700_00)], [note("p1", "2026-09-15", 699_99)], PERIOD);
    expect(off.matched).toEqual([]);
    expect(off.unrecorded.map((l) => l.id)).toEqual(["l1"]);
    expect(off.notInStatement.map((n) => n.paymentId)).toEqual(["p1"]);
  });

  it("رقمان مختلفان بالمبلغ نفسه ورقتان لا ورقة", () => {
    const r = matchCreditNotes([line("l1", "2026-09-10", 700_00, "CN-0099")], [note("p1", "2026-09-10", 700_00, "CN-0012")], PERIOD);
    expect(r.matched).toEqual([]);
    expect(r.unrecorded.map((l) => l.id)).toEqual(["l1"]);
    expect(r.notInStatement.map((n) => n.paymentId)).toEqual(["p1"]);
  });

  it("إشعاران مسجّلان بالمبلغ نفسه وسطرٌ واحد: اقتراحٌ بالمرشّحَين، لا يُحسم بالترتيب", () => {
    const r = matchCreditNotes([line("l1", "2026-09-10", 300_00)], [note("p1", "2026-09-05", 300_00), note("p2", "2026-09-20", 300_00)], PERIOD);
    expect(r.matched).toEqual([]);
    expect(r.suggested[0].candidates.map((c) => c.paymentId)).toEqual(["p1", "p2"]);
    /* المرشّحان ليسا «لم يردا في كشفه» */
    expect(r.notInStatement).toEqual([]);
  });

  it("سطران بالمبلغ نفسه وإشعارٌ واحد: كلاهما اقتراح", () => {
    const r = matchCreditNotes([line("l1", "2026-09-10", 300_00), line("l2", "2026-09-11", 300_00)], [note("p1", "2026-09-10", 300_00)], PERIOD);
    expect(r.matched).toEqual([]);
    expect(r.suggested.map((s) => s.line.id)).toEqual(["l1", "l2"]);
  });

  it("إشعارٌ خارج مدّة الكشف لا يُدّعى أنّه غاب عنه، والنتيجةُ لا تتغيّر بالترتيب", () => {
    const lines = [line("l1", "2026-09-10", 100_00), line("l2", "2026-09-12", 200_00, "CN-5555")];
    const notes = [note("p0", "2026-08-01", 900_00), note("p2", "2026-09-12", 200_00, "CN-5555"), note("p1", "2026-09-09", 100_00)];
    const a = matchCreditNotes(lines, notes, PERIOD);
    const b = matchCreditNotes([...lines].reverse(), [...notes].reverse(), PERIOD);
    expect(a.notInStatement).toEqual([]);
    expect(a.matched.map((m) => [m.line.id, m.note.paymentId])).toEqual(b.matched.map((m) => [m.line.id, m.note.paymentId]));
    expect(a.matched).toHaveLength(2);
  });

  it("عكسُ فاتورةٍ ليست عندنا لا يُعدّ «بلا إشعار مسجَّل»، وعكسُ فاتورةٍ عندنا يُعدّ", () => {
    const rev = line("l1", "2026-09-12", 1998_70, "RINV/2026/00016 (Reversal of: INV/2026/00080)", "مستحق");
    expect(reversedInvoiceOf(rev)).toBe("INV/2026/00080");
    const unknown = matchCreditNotes([rev], [], PERIOD, { knownInvoices: new Set() });
    expect(unknown.unrecorded).toEqual([]);
    expect(unknown.reversesUnknown.map((x) => x.invoiceNumber)).toEqual(["INV/2026/00080"]);
    const known = matchCreditNotes([rev], [], PERIOD, { knownInvoices: new Set([normalizeCreditRef("INV/2026/00080")]) });
    expect(known.unrecorded.map((l) => l.id)).toEqual(["l1"]);
    /* وبلا معرفةٍ بفواتيرنا لا يُحكم: يبقى سؤالاً */
    expect(matchCreditNotes([rev], [], PERIOD).unrecorded).toHaveLength(1);
  });

  it("الإشعارُ المقيَّد بمرجع سطر الكشف كاملاً يقابله بالرقم", () => {
    const rev = line("l1", "2026-09-12", 1998_70, "RINV/2026/00016 (Reversal of: INV/2026/00080)");
    const r = matchCreditNotes([rev], [note("p1", "2026-09-12", 1998_70, "RINV/2026/00016 (Reversal of: INV/2026/00080)")], PERIOD, { knownInvoices: new Set() });
    expect(r.matched.map((m) => m.by)).toEqual(["REF"]);
    expect(r.reversesUnknown).toEqual([]);
  });
});
