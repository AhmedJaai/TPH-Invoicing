import { describe, expect, it } from "vitest";
import { toCanonical, type RawBankRow } from "./canonical";
import { operationRef, operationRefs } from "./identity";
import {
  factKey, identityText, looseKey, syncRows, type Incoming, type KnownRow,
} from "./sync";

const ACC = "acct-1";
const day = (d: string) => new Date(`${d}T00:00:00Z`);

type Row = RawBankRow & { tag: string };

const row = (tag: string, over: Partial<RawBankRow>): Row => ({
  tag,
  valueDate: day("2026-09-01"),
  amountMinor: 3_000_00,
  direction: "DEBIT",
  ...over,
});

const incoming = (rows: readonly Row[]): Incoming<Row>[] =>
  rows.map((r) => ({ row: r, tx: toCanonical(r) }));

/** يحاكي ما يُقيَّد في القاعدة بعد قبول صفوف. */
function store(rows: readonly Row[], accountId: string | null = ACC): KnownRow[] {
  return rows.map((r) => {
    const tx = toCanonical(r);
    return {
      id: `db-${r.tag}`,
      accountId,
      refs: operationRefs(tx),
      operationRef: operationRef(tx),
      factKey: factKey(tx),
      looseKey: looseKey(tx),
    };
  });
}

const TRF_OLD = "حوالات تحت الطلب20260901S ANCBKNCBK6B82412005390704 AL FALAH TRADING مرجع123456789";
const TRF_NEW = "LOCAL TRANSFER AL FALAH TRADING CO. مرجع123456789";
const FEE = "CITY:Digital Channel";

describe("أ · الملفّ نفسه مرّتين", () => {
  const file = [row("a", { description: TRF_OLD }), row("b", { description: FEE, amountMinor: 50 })];

  it("أوّل رفع: كلّها جديدة", () => {
    const r = syncRows(incoming(file), [], ACC);
    expect(r.fresh).toHaveLength(2);
    expect(r.known).toHaveLength(0);
  });

  it("ثاني رفع: لا شيء جديد", () => {
    const r = syncRows(incoming(file), store(file), ACC);
    expect(r.fresh).toHaveLength(0);
    expect(r.known).toHaveLength(2);
  });

  it("وعشرون رفعاً لا تزيد حركة", () => {
    const stored = store(file);
    for (let i = 0; i < 20; i++) {
      expect(syncRows(incoming(file), stored, ACC).fresh).toHaveLength(0);
    }
  });
});

describe("ب · التصدير يتغيّر والعمليّة واحدة", () => {
  it("الوصف يتغيّر والمرجع واحد ← ليست جديدة", () => {
    const before = [row("a", { description: TRF_OLD })];
    const after = [row("a2", { description: TRF_NEW })];
    const r = syncRows(incoming(after), store(before), ACC);
    expect(r.fresh).toHaveLength(0);
    expect(r.known[0].verdict.basis).toBe("REFERENCE");
  });

  it("والفراغ والترقيم وحالة الأحرف لا تصنع حركة", () => {
    const before = [row("a", { description: "رسوم  خدمة  شهرية" })];
    const after = [row("a2", { description: "رسوم خدمه، شهريه." })];
    expect(syncRows(incoming(after), store(before), ACC).fresh).toHaveLength(0);
  });

  it("ولا تُجمَع جهتان مختلفتان بحجّة التوحيد", () => {
    expect(identityText("مؤسسة عمار")).not.toBe(identityText("مؤسسة عماد"));
  });
});

describe("ج · كشفٌ أوسع يحوي القديم", () => {
  it("لا يدخل إلّا الفرق", () => {
    const old = [row("a", { description: TRF_OLD }), row("b", { description: FEE, amountMinor: 50 })];
    const wider = [
      ...old,
      row("c", { description: "حوالة أخرى مرجع999888777", valueDate: day("2026-09-05") }),
    ];
    const r = syncRows(incoming(wider), store(old), ACC);
    expect(r.fresh).toHaveLength(1);
    expect(r.fresh[0].row.tag).toBe("c");
    expect(r.known).toHaveLength(2);
  });
});

describe("د · كشفان متداخلان", () => {
  it("المشترك يُعرَف مرّةً واحدة", () => {
    const first = [row("a", { description: TRF_OLD }), row("b", { description: "حوالة ب مرجع222" })];
    const second = [row("b2", { description: "حوالة ب مرجع222" }), row("c", { description: "حوالة ج مرجع333" })];
    const r = syncRows(incoming(second), store(first), ACC);
    expect(r.known).toHaveLength(1);
    expect(r.fresh).toHaveLength(1);
    expect(r.fresh[0].row.tag).toBe("c");
  });
});

describe("هـ · حركتان متطابقتان حقيقيّتان", () => {
  const twice = [
    row("f1", { description: FEE, amountMinor: 50 }),
    row("f2", { description: FEE, amountMinor: 50 }),
  ];

  it("تبقيان اثنتين ولا تُبتلَع إحداهما", () => {
    const r = syncRows(incoming(twice), [], ACC);
    expect(r.fresh).toHaveLength(2);
    expect(r.fresh.map((f) => f.verdict.occurrence)).toEqual([0, 1]);
  });

  it("وإعادة الرفع لا تزيدهما", () => {
    expect(syncRows(incoming(twice), store(twice), ACC).fresh).toHaveLength(0);
  });

  it("وإن ذكرهما كشفٌ ثالثاً دخلت الثالثة وحدها", () => {
    const thrice = [...twice, row("f3", { description: FEE, amountMinor: 50 })];
    const r = syncRows(incoming(thrice), store(twice), ACC);
    expect(r.fresh).toHaveLength(1);
    expect(r.fresh[0].verdict.occurrence).toBe(2);
  });
});

describe("و · الترتيب ليس هويّة", () => {
  it("صفوفٌ أُعيد ترتيبها لا تُنتج تكراراً", () => {
    const first = [
      row("a", { description: FEE, amountMinor: 50 }),
      row("b", { description: FEE, amountMinor: 50 }),
      row("c", { description: "حوالة ج مرجع333" }),
    ];
    const reordered = [first[2], first[0], first[1]];
    expect(syncRows(incoming(reordered), store(first), ACC).fresh).toHaveLength(0);
  });

  it("وحركةٌ دُسّت بين متطابقتين لا تُضاعفهما", () => {
    const first = [
      row("a", { description: FEE, amountMinor: 50 }),
      row("b", { description: FEE, amountMinor: 50 }),
    ];
    const withInsert = [first[0], row("x", { description: "حوالة س مرجع555" }), first[1]];
    const r = syncRows(incoming(withInsert), store(first), ACC);
    expect(r.fresh).toHaveLength(1);
    expect(r.fresh[0].row.tag).toBe("x");
  });
});

describe("ز · الحساب نطاقٌ", () => {
  it("الحركة نفسها في حسابين حركتان", () => {
    const one = [row("a", { description: TRF_OLD })];
    const r = syncRows(incoming(one), store(one, "acct-2"), ACC);
    expect(r.fresh).toHaveLength(1);
  });
});

describe("ح · التاريخ يُؤخَذ بيومه", () => {
  it("اختلاف الساعة لا يصنع حركة أخرى", () => {
    const a = [row("a", { description: FEE, amountMinor: 50, valueDate: new Date("2026-09-01T00:00:00Z") })];
    const b = [row("a2", { description: FEE, amountMinor: 50, valueDate: new Date("2026-09-01T21:30:00Z") })];
    expect(syncRows(incoming(b), store(a), ACC).fresh).toHaveLength(0);
  });
});

describe("ط · المرجع يُتعلَّم ولا يُنشئ حركة", () => {
  it("حركةٌ قُيّدت بلا مرجع ثمّ عُرف مرجعُها ← تُثرى لا تُكرَّر", () => {
    const before = [row("a", { description: "حوالة بلا مرجع ظاهر" })];
    const stored = store(before);
    expect(stored[0].operationRef).toBeNull();

    const after = [row("a2", { description: "حوالة بلا مرجع ظاهر مرجع777666" })];
    const r = syncRows(incoming(after), stored, ACC);
    expect(r.fresh).toHaveLength(0);
    expect(r.enrich).toHaveLength(1);
    expect(r.enrich[0].operationRef).toContain("777666");
    expect(r.known[0].verdict.basis).toBe("FACTS");
  });
});

describe("ي · مرجعان مختلفان عمليّتان — والالتباس غيرُ ذلك", () => {
  it("البنك يعطي كلّ عمليّةٍ رقمها، فاختلافُ الرقمين اختلافُ عمليّتين", () => {
    const before = [row("a", { description: "حوالة مرجع111111" })];
    const after = [row("a2", { description: "حوالة مرجع222222" })];
    const r = syncRows(incoming(after), store(before), ACC);
    expect(r.fresh).toHaveLength(1);
    expect(r.ambiguous).toHaveLength(0);
  });

  it("والالتباس: واردٌ بلا مرجع يقابل مقيَّداً له مرجع", () => {
    const before = [row("a", { description: "حوالة مرجع111111" })];
    const after = [row("a2", { description: "حوالة" })];
    const r = syncRows(incoming(after), store(before), ACC);
    expect(r.ambiguous).toHaveLength(1);
    expect(r.fresh).toHaveLength(0);
    expect(r.known).toHaveLength(0);
  });
});
