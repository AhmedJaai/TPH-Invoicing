import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { toCanonical, type RawBankRow } from "./canonical";
import { operationRef, operationRefs } from "./identity";
import {
  beneficiaryKey, factKey, identityKeyOf, identityText, looseKey, looseText, syncRows,
  type Incoming, type KnownRow, type SyncResult,
} from "./sync";

/**
 * خصائصُ هويّة الحركة — الخوارزميّةُ «الواحدة» وقد كلّف تكرارُها حذفَ صفوفٍ حقيقيّة.
 *
 * الملفّ يُولَّد: تواريخُ ومبالغُ قليلةٌ عمداً (فيكثر التشابه)، وأوصافٌ عامّة،
 * ومراجعُ اختياريّة، وصفوفٌ متطابقةٌ حقّاً. ثمّ يُسأل ما يسأله صاحبُ الكشف:
 * أرفعُه مرّتين فلا يتضاعف؟ وهل تبقى الحركتان المتطابقتان اثنتين؟
 */
const RUNS = { numRuns: 500, seed: 20261010 };
const ACC = "acct-1";

type Row = RawBankRow & { tag: number };

const WORDS = ["TRF ABC", "LOCAL TRANSFER AL FALAH TRADING", "CITY:Digital Channel", "رسوم تحويل", "TRANSFER"];
const BENEFICIARIES = [undefined, "مؤسسة عمار", "مؤسسة عماد"];

/** صفٌّ بلا مرجع — هويّتُه وقائعُه وترتيبُه */
const plainRow = fc.record({
  day: fc.integer({ min: 1, max: 4 }),
  amountMinor: fc.constantFrom(50, 1_150, 300_000),
  direction: fc.constantFrom<"DEBIT" | "CREDIT">("DEBIT", "CREDIT"),
  word: fc.constantFrom(...WORDS),
  beneficiaryRaw: fc.constantFrom(...BENEFICIARIES),
});

const toRow = (r: {
  day: number; amountMinor: number; direction: "DEBIT" | "CREDIT"; word: string;
  beneficiaryRaw: string | undefined; ref?: number | null;
}, tag: number): Row => ({
  tag,
  valueDate: new Date(Date.UTC(2026, 8, r.day)),
  amountMinor: r.amountMinor,
  direction: r.direction,
  description: r.ref == null ? r.word : `${r.word} مرجع${r.ref}`,
  beneficiaryRaw: r.beneficiaryRaw,
});

/** ملفٌّ فيه صفوفٌ بلا مرجع (وقد تتطابق) وصفوفٌ بمراجعَ لا تتكرّر — كما يعطيها البنك */
const fileArb: fc.Arbitrary<Row[]> = fc.tuple(
  fc.array(plainRow, { maxLength: 10 }),
  fc.uniqueArray(
    fc.tuple(plainRow, fc.integer({ min: 100_000_000, max: 999_999_999 })),
    { selector: ([, ref]) => ref, maxLength: 6 },
  ),
).chain(([plain, withRef]) => {
  const rows = [...plain.map((p) => ({ ...p, ref: null })), ...withRef.map(([p, ref]) => ({ ...p, ref }))];
  return fc.shuffledSubarray(rows, { minLength: rows.length });
}).map((rows) => rows.map(toRow));

const incoming = (rows: readonly Row[]): Incoming<Row>[] => rows.map((r) => ({ row: r, tx: toCanonical(r) }));

/** يقيّد ما حكمت به المزامنةُ «جديداً» — كما يفعل مسارُ الاستيراد */
function persist(result: SyncResult<Row>, into: KnownRow[], accountId: string | null): KnownRow[] {
  const out = [...into];
  for (const { row, verdict } of result.fresh) {
    const tx = toCanonical(row);
    out.push({
      id: verdict.identityKey,
      accountId,
      refs: operationRefs(tx),
      operationRef: operationRef(tx),
      factKey: factKey(tx),
      looseKey: looseKey(tx),
      amountMinor: tx.amountMinor,
      direction: tx.direction,
      beneficiary: beneficiaryKey(tx),
    });
  }
  for (const e of result.enrich) {
    const i = out.findIndex((k) => k.id === e.id);
    if (i >= 0) out[i] = { ...out[i], operationRef: e.operationRef, refs: [...new Set([...out[i].refs, e.operationRef])] };
  }
  return out;
}

const importFile = (rows: readonly Row[], stored: KnownRow[], accountId: string | null = ACC) => {
  const result = syncRows(incoming(rows), stored, accountId);
  return { result, stored: persist(result, stored, accountId) };
};

describe("syncRows — خصائص", () => {
  it("كلُّ صفٍّ يأخذ حكماً واحداً، ولا مقيَّدٌ يُدَّعى مرّتين", () => {
    fc.assert(fc.property(fileArb, fileArb, (first, second) => {
      const { stored } = importFile(first, []);
      const r = syncRows(incoming(second), stored, ACC);
      expect(r.known.length + r.fresh.length + r.ambiguous.length + r.conflict.length).toBe(second.length);
      // صفّان من الملفّ لا يذوبان في حركةٍ واحدة مقيَّدة — وهو النقصُ الذي لا يُرى
      const claimed = r.known.map((k) => k.verdict.matchedId);
      expect(new Set(claimed).size).toBe(claimed.length);
    }), RUNS);
  });

  it("الملفُّ على قاعدةٍ فارغة: كلُّه جديد، ولكلِّ حركةٍ مفتاحٌ لا يشاركها فيه غيرُها", () => {
    fc.assert(fc.property(fileArb, (file) => {
      const { result } = importFile(file, []);
      expect(result.fresh).toHaveLength(file.length);
      const keys = result.fresh.map((f) => f.verdict.identityKey);
      expect(new Set(keys).size).toBe(keys.length);
    }), RUNS);
  });

  it("رفعُه ثانيةً لا يضيف شيئاً — ولا يلتبس ولا يتضارب", () => {
    fc.assert(fc.property(fileArb, (file) => {
      const { stored } = importFile(file, []);
      const again = syncRows(incoming(file), stored, ACC);
      expect(again.fresh).toHaveLength(0);
      expect(again.ambiguous).toHaveLength(0);
      expect(again.conflict).toHaveLength(0);
      expect(again.known).toHaveLength(file.length);
      expect(again.enrich).toHaveLength(0);
    }), RUNS);
  });

  it("وثالثةً بترتيبٍ آخر للصفوف: لا جديد", () => {
    fc.assert(fc.property(
      fileArb.chain((f) => fc.tuple(fc.constant(f), fc.shuffledSubarray(f, { minLength: f.length }))),
      ([file, shuffled]) => {
        const { stored } = importFile(file, []);
        const again = syncRows(incoming(shuffled), stored, ACC);
        expect(again.fresh).toHaveLength(0);
        expect(again.known).toHaveLength(file.length);
      },
    ), RUNS);
  });

  it("الحركاتُ المتطابقةُ حقّاً تبقى بعددها: n في الملفّ ← n مقيَّدة، ثمّ صفرٌ جديد", () => {
    fc.assert(fc.property(plainRow, fc.integer({ min: 1, max: 6 }), (shape, n) => {
      const file = Array.from({ length: n }, (_, i) => toRow({ ...shape, ref: null }, i));
      const first = importFile(file, []);
      expect(first.result.fresh.map((f) => f.verdict.occurrence)).toEqual(Array.from({ length: n }, (_, i) => i));
      expect(new Set(first.result.fresh.map((f) => f.verdict.identityKey)).size).toBe(n);
      // وكشفٌ لاحقٌ يحمل واحدةً زائدة: الزائدةُ وحدها جديدة
      const more = [...file, toRow({ ...shape, ref: null }, n)];
      const second = syncRows(incoming(more), first.stored, ACC);
      expect(second.known).toHaveLength(n);
      expect(second.fresh).toHaveLength(1);
      expect(second.fresh[0].verdict.occurrence).toBe(n);
    }), RUNS);
  });

  it("جزءٌ ثمّ الكلّ: ما قُيِّد لا يتجاوز الملفّ، وما قُيِّد يُعرَف كلُّه عند إعادة الرفع", () => {
    fc.assert(fc.property(fileArb, fc.nat(), (file, cut) => {
      const head = file.slice(0, file.length === 0 ? 0 : cut % (file.length + 1));
      const a = importFile(head, []);
      const b = importFile(file, a.stored);
      // لا يدخل الكشفُ أكثرَ ممّا فيه — مهما قُسِّم
      expect(b.stored.length).toBeLessThanOrEqual(file.length);
      expect(b.result.known.length).toBeGreaterThanOrEqual(head.length - b.result.ambiguous.length - b.result.conflict.length);
      const again = syncRows(incoming(file), b.stored, ACC);
      expect(again.fresh.length).toBeLessThanOrEqual(b.result.ambiguous.length + b.result.conflict.length);
    }), RUNS);
  });

  it("حسابٌ لم يكن يُقرأ ثمّ قُرئ: الكشفُ نفسه لا يدخل ثانيةً", () => {
    fc.assert(fc.property(fileArb, (file) => {
      // قُيِّد والحسابُ مجهول، ثمّ أُعيد رفعُه وقد عُرف — وبالعكس
      const unknownFirst = importFile(file, [], null);
      expect(syncRows(incoming(file), unknownFirst.stored, ACC).fresh).toHaveLength(0);
      const knownFirst = importFile(file, [], ACC);
      expect(syncRows(incoming(file), knownFirst.stored, null).fresh).toHaveLength(0);
    }), RUNS);
  });

  it("وحسابٌ آخر معروف لا يبتلع حركاتِ هذا", () => {
    fc.assert(fc.property(fileArb, (file) => {
      const other = importFile(file, [], "acct-2");
      expect(syncRows(incoming(file), other.stored, ACC).fresh).toHaveLength(file.length);
    }), RUNS);
  });

  it("المرجعُ نفسه بمبلغٍ آخر تضاربٌ يُوقَف — لا معروفٌ ولا جديد", () => {
    fc.assert(fc.property(
      plainRow, fc.integer({ min: 100_000_000, max: 999_999_999 }), fc.integer({ min: 1, max: 9_999 }),
      (shape, ref, delta) => {
        const { stored } = importFile([toRow({ ...shape, ref }, 0)], []);
        const r = syncRows(incoming([toRow({ ...shape, ref, amountMinor: shape.amountMinor + delta }, 1)]), stored, ACC);
        expect(r.conflict).toHaveLength(1);
        expect(r.known).toHaveLength(0);
        expect(r.fresh).toHaveLength(0);
      },
    ), RUNS);
  });
});

describe("identityText / looseText / identityKeyOf", () => {
  it("التوحيدُ ثابتٌ عند إعادته، ولا يفرّق بين عرضين لنصٍّ واحد", () => {
    fc.assert(fc.property(fc.string({ maxLength: 40 }), (text) => {
      const once = identityText(text);
      expect(identityText(once)).toBe(once);
      expect(identityText(`  ${text}  `)).toBe(once);
      expect(looseText(looseText(text))).toBe(looseText(text));
    }), RUNS);
    expect(identityText("trf-al.falah")).toBe(identityText("TRF AL FALAH"));
    expect(identityText(null)).toBe("");
  });

  it("ولا يُبالَغ: اسمان متقاربان يبقيان اسمين", () => {
    expect(identityText("مؤسسة عمار")).not.toBe(identityText("مؤسسة عماد"));
    expect(looseText("مؤسسة عمار")).not.toBe(looseText("مؤسسة عماد"));
  });

  it("المتساهلُ يُسقط ما يتغيّر بين تصديرين ويُبقي الكلمات", () => {
    expect(looseText("TRF ABC 123456")).toBe(looseText("TRF ABC 654321"));
    expect(looseText("TRF ABC مرجع123456789")).toBe("TRF ABC");
    expect(looseText("TRF ABC REF 2026-09-01")).toBe("TRF ABC");
    expect(looseText("TRF ABC")).not.toBe(looseText("TRF XYZ"));
    // نصٌّ كلُّه أرقام يصير فارغاً — فلا يُبنى عليه وحده حكم
    expect(looseText("123456 20260901")).toBe("");
  });

  it("المرجعُ هويّةٌ بلا ترتيب، والوقائعُ هويّةٌ بترتيبها، والمجهولُ نطاقٌ واحد", () => {
    expect(identityKeyOf("acc", "BANK_REF:1", "f", 0)).toBe(identityKeyOf("acc", "BANK_REF:1", "g", 5));
    expect(identityKeyOf("acc", null, "f", 0)).not.toBe(identityKeyOf("acc", null, "f", 1));
    expect(identityKeyOf("acc", null, "f", 0)).not.toBe(identityKeyOf("acc2", null, "f", 0));
    expect(identityKeyOf(null, null, "f", 0)).toBe("FACT:~|f|0");
    expect(identityKeyOf(null, "BANK_REF:1", "f", 0)).toBe("REF:~|BANK_REF:1");
  });
});
