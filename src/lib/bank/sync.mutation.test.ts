import { describe, expect, it } from "vitest";
import { toCanonical, type RawBankRow } from "./canonical";
import { operationRef, operationRefs } from "./identity";
import {
  beneficiaryKey, factKey, identityKeyOf, looseKey, looseText, storedMissingFromFile, syncRows,
  type Incoming, type KnownRow,
} from "./sync";

/**
 * هويّةُ الحركة — ما كانت تنجو فيه طفراتُ Stryker. وكلُّ حالةٍ لو انكسرت
 * لدخلت حركةٌ مرّتين، أو ابتُلعت حركةٌ حقيقيّة، أو تغيّر مفتاحٌ مخزَّن.
 */
const ACC = "acct-1";
const day = (d: string) => new Date(`${d}T00:00:00Z`);
type Row = RawBankRow & { tag: string };
const row = (tag: string, over: Partial<RawBankRow>): Row => ({
  tag, valueDate: day("2026-09-01"), amountMinor: 3_000_00, direction: "DEBIT", ...over,
});
const incoming = (rows: readonly Row[]): Incoming<Row>[] => rows.map((r) => ({ row: r, tx: toCanonical(r) }));
function store(rows: readonly Row[], accountId: string | null = ACC): KnownRow[] {
  return rows.map((r) => {
    const tx = toCanonical(r);
    return {
      id: `db-${r.tag}`, accountId, refs: operationRefs(tx), operationRef: operationRef(tx),
      factKey: factKey(tx), looseKey: looseKey(tx), amountMinor: tx.amountMinor, direction: tx.direction,
      beneficiary: beneficiaryKey(tx),
    };
  });
}

describe("المفتاحُ المخزَّن لا يتغيّر شكلُه", () => {
  /* `identity_key` مكتوبٌ في القاعدة لكلّ حركة: تغييرُ الفاصل يُدخل الكشوفَ كلّها ثانيةً */
  it("مفتاحُ الوقائع والمتساهلُ بفاصل «|» وترتيبٍ ثابت", () => {
    const facts = { valueDate: day("2026-09-03"), amountMinor: 12_345, direction: "DEBIT" as const, description: "Fee 12 ABC" };
    expect(factKey(facts)).toBe("2026-09-03|12345|DEBIT|FEE 12 ABC");
    expect(looseKey(facts)).toBe("2026-09-03|12345|DEBIT|FEE ABC");
    expect(identityKeyOf(null, null, factKey(facts), 2)).toBe("FACT:~|2026-09-03|12345|DEBIT|FEE 12 ABC|2");
  });
});

describe("looseText — يُسقط كلمةَ المرجع وحدها لا ما يحويها", () => {
  it("«REFUND» و«UPDATE» كلمتان تبقيان، و«REF» و«DATE» وحدهما تسقطان", () => {
    expect(looseText("REF 123 REFUND")).toBe("REFUND");
    expect(looseText("DATE UPDATE")).toBe("UPDATE");
  });
});

describe("beneficiaryKey — ما ليس اسماً ليس مستفيداً", () => {
  it("فراغٌ أو ترقيمٌ وحده: «لم يُذكر» لا اسمٌ فارغ يمنع المطابقة", () => {
    expect(beneficiaryKey({ beneficiaryRaw: "   " })).toBeNull();
    expect(beneficiaryKey({ beneficiaryRaw: " — " })).toBeNull();
    expect(beneficiaryKey({ beneficiaryRaw: "  أوراق الزيتون " })).toBe("اوراق الزيتون");
  });
});

describe("syncRows — أحكامٌ لم يكن اختبارٌ يقولها بنصّها", () => {
  const TRF = "LOCAL TRANSFER AL FALAH TRADING CO. مرجع123456789";
  const TRF_BARE = "LOCAL TRANSFER AL FALAH TRADING CO.";

  it("المرجعُ نفسه: «معروفة بالمرجع» بنصّ حكمها", () => {
    const f = [row("a", { description: TRF })];
    const r = syncRows(incoming(f), store(f), ACC);
    expect(r.known[0].verdict).toMatchObject({ status: "KNOWN", matchedId: "db-a", basis: "REFERENCE" });
  });

  it("المرجعُ نفسه والاتّجاهُ مختلف: «متضاربة» بسببها", () => {
    const before = [row("a", { description: TRF })];
    const after = [row("b", { description: TRF, direction: "CREDIT" })];
    const r = syncRows(incoming(after), store(before), ACC);
    expect(r.conflict[0].verdict).toMatchObject({ status: "CONFLICT", againstId: "db-a" });
    expect(r.conflict[0].verdict.reason).toContain("الاتّجاه");
  });

  it("الوارد بلا مرجع يطابق المقيَّد بمرجعه **بالوقائع الصارمة** — معروفة، لا ملتبسة", () => {
    /* الوصفُ نفسه حرفاً، والمرجعُ في نوع الحركة لا في الوصف — فلا يُسأل الإنسان عمّا لا شكّ فيه */
    const before = [row("a", { description: TRF_BARE, transactionType: "TRF مرجع123456789" })];
    const after = [row("b", { description: TRF_BARE })];
    const stored = store(before);
    expect(stored[0].operationRef).not.toBeNull();
    const r = syncRows(incoming(after), stored, ACC);
    expect(r.ambiguous).toHaveLength(0);
    expect(r.known[0].verdict).toMatchObject({ status: "KNOWN", basis: "FACTS" });
    expect(r.known[0].verdict.reason).toBe("التاريخ والمبلغ والاتجاه والوصف نفسها");
  });

  it("الوارد بلا مرجع يقابل بالتساهل مقيَّداً له مرجع: «ملتبسة» بنصّها", () => {
    const before = [row("a", { description: TRF })];
    const after = [row("b", { description: "LOCAL TRANSFER AL FALAH TRADING CO. 2026" })];
    const r = syncRows(incoming(after), store(before), ACC);
    expect(r.ambiguous).toHaveLength(1);
    expect(r.ambiguous[0].verdict).toMatchObject({ status: "AMBIGUOUS", againstId: "db-a" });
  });

  it("الوارد بمرجعٍ يقابل بالتساهل مقيَّداً بلا مرجع: معروفة ويُثرى المقيَّد بمرجعه", () => {
    const before = [row("a", { description: TRF_BARE })];
    const after = [row("b", { description: TRF })];
    const r = syncRows(incoming(after), store(before), ACC);
    expect(r.known[0].verdict).toMatchObject({ status: "KNOWN", matchedId: "db-a", basis: "FACTS" });
    expect(r.known[0].verdict.reason).toContain("بعد إسقاط الأرقام");
    expect(r.enrich).toEqual([{ id: "db-a", operationRef: operationRef(toCanonical(after[0])) }]);
  });

  it("وبمستفيدَين مذكورَين مختلفَين لا يُقابَل بالتساهل — حركةٌ جديدة لا تُبتلَع", () => {
    const before = [row("a", { description: TRF_BARE, beneficiaryRaw: "مؤسسة أوراق الزيتون" })];
    const after = [row("b", { description: TRF, beneficiaryRaw: "شركة الفلاح" })];
    const r = syncRows(incoming(after), store(before), ACC);
    expect(r.known).toHaveLength(0);
    expect(r.fresh).toHaveLength(1);
    expect(r.fresh[0].verdict.status).toBe("NEW");
  });
});

describe("storedMissingFromFile — لا يُحكم إلّا بيقين", () => {
  const fee = row("fee", { description: "CITY:Digital Channel", amountMinor: 100 });
  const known = store([fee]);
  const empty = { known: [], ambiguous: [], conflict: [] };
  const at = (id: string, d: string) => ({ id, valueDate: day(d), bankAccountId: ACC });

  it("مدّةٌ نصفُها مجهول لا يُحكم فيها", () => {
    const stored = [at("x", "2026-09-02")];
    expect(storedMissingFromFile(stored, empty, { start: day("2026-09-01"), end: null }, ACC)).toEqual([]);
    expect(storedMissingFromFile(stored, empty, { start: null, end: day("2026-09-30") }, ACC)).toEqual([]);
  });

  it("أوّلُ المدّة وآخرُها داخلها", () => {
    const stored = [at("first", "2026-09-01"), at("last", "2026-09-30"), at("after", "2026-10-01"), at("before", "2026-08-31")];
    const out = storedMissingFromFile(stored, empty, { start: day("2026-09-01"), end: day("2026-09-30") }, ACC);
    expect(out.map((s) => s.id)).toEqual(["first", "last"]);
  });

  it("ما شابهه صفٌّ ملتبس أو متضارب ليس غائباً", () => {
    const result = {
      known: [],
      ambiguous: [{ row: null, verdict: { status: "AMBIGUOUS" as const, againstId: "amb", reason: "" } }],
      conflict: [{ row: null, verdict: { status: "CONFLICT" as const, againstId: "con", reason: "" } }],
    };
    const stored = [at("amb", "2026-09-02"), at("con", "2026-09-02"), at(known[0].id, "2026-09-02")];
    const out = storedMissingFromFile(stored, result, { start: day("2026-09-01"), end: day("2026-09-30") }, ACC);
    expect(out.map((s) => s.id)).toEqual([known[0].id]);
  });
});
