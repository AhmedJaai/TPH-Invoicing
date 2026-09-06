import { describe, expect, it } from "vitest";
import {
  assignIdentities, countByNaturalKey, fileFingerprint, identityScope,
  naturalKey, normalizeDescription, scopedIdentity, transactionIdentity,
  unseenRows, UNSCOPED,
} from "./identity";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

const row = (date: string, amount: number, desc: string, dir: "DEBIT" | "CREDIT" = "DEBIT") => ({
  valueDate: d(date), amountMinor: amount, direction: dir, description: desc,
});

describe("transactionIdentity", () => {
  const base = {
    valueDate: "2026-08-13",
    amountMinor: 15_000,
    direction: "DEBIT" as const,
    description: "حوالة صادرة",
    occurrence: 0,
  };

  it("المدخلات نفسها تعطي الهوية نفسها", () => {
    expect(transactionIdentity(base)).toBe(transactionIdentity({ ...base }));
  });

  const id = transactionIdentity(base);

  it("اختلاف أي جزء يغيّر الهوية", () => {
    expect(transactionIdentity({ ...base, amountMinor: 15_001 })).not.toBe(id);
    expect(transactionIdentity({ ...base, valueDate: "2026-08-14" })).not.toBe(id);
    expect(transactionIdentity({ ...base, direction: "CREDIT" })).not.toBe(id);
    expect(transactionIdentity({ ...base, description: "غيره" })).not.toBe(id);
    expect(transactionIdentity({ ...base, occurrence: 1 })).not.toBe(id);
  });

  it("صيغتا تصدير مختلفتان لنفس الحركة تعطيان البصمة نفسها", () => {
    // الفراغ الزائد وحالة الأحرف اختلافُ عرضٍ لا اختلاف معنى
    const a = transactionIdentity({ ...base, description: "81140155-260508-POS VS VA T 418069" });
    const b = transactionIdentity({ ...base, description: "81140155-260508-POS  VS  va t  418069" });
    expect(a).toBe(b);
  });
});

/*
  كان هنا اختبارٌ يشترط أن يفصل رقمُ الحساب بين بصمتين — وقد أثبت الواقع
  أنّ الشرط خطأ: صُدِّر كشفان لنفس الحساب، أحدهما يحمل رقمه في ترويسته
  والآخر لا يحمله، فاختلفت بصمتا حركةٍ واحدة ودخلت مرّتين.

  وكانت المقايضة معلومة: حسابان يحملان في اليوم نفسه حركتين متطابقتين
  حرفاً بحرف تُعتبران واحدة. وهذا ما يُغلقه النطاق الآن — في القيد لا في
  البصمة، كما قال الاختبار القديم نصّاً.
*/
describe("نطاق الهوية", () => {
  it("الحساب المجهول نطاقٌ واحد ثابت", () => {
    expect(identityScope(null)).toBe(UNSCOPED);
    expect(identityScope(undefined)).toBe(UNSCOPED);
  });

  it("حسابان مختلفان يفصلان بين حركتين لهما البصمة نفسها", () => {
    const [tx] = assignIdentities([row("2026-08-01", 500_00, "إيجار")]);
    expect(scopedIdentity("acc_rajhi", tx.externalId))
      .not.toBe(scopedIdentity("acc_ahli", tx.externalId));
  });

  it("الحساب نفسه يجمعهما فتُعرَف الثانية مكرّرة", () => {
    const [tx] = assignIdentities([row("2026-08-01", 500_00, "إيجار")]);
    expect(scopedIdentity("acc_rajhi", tx.externalId))
      .toBe(scopedIdentity("acc_rajhi", tx.externalId));
  });
});

describe("assignIdentities", () => {
  it("استيراد الملف نفسه مرّتين يعطي البصمات نفسها — فلا يتكرّر", () => {
    const rows = [row("2026-08-01", 500, "أ"), row("2026-08-02", 700, "ب")];
    const first = assignIdentities(rows).map((r) => r.externalId);
    const second = assignIdentities(rows).map((r) => r.externalId);
    expect(second).toEqual(first);
  });

  it("حركتان متطابقتان في الملف الواحد تبقيان اثنتين", () => {
    const rows = [row("2026-08-01", 300, "رسوم"), row("2026-08-01", 300, "رسوم")];
    const ids = assignIdentities(rows).map((r) => r.externalId);
    expect(new Set(ids).size).toBe(2);
  });

  it("ثلاث حركات متطابقة تعطي ثلاث هويات، وإعادة الاستيراد تعطيها هي نفسها", () => {
    const rows = [row("2026-08-01", 8, "قناة"), row("2026-08-01", 8, "قناة"), row("2026-08-01", 8, "قناة")];
    const a = assignIdentities(rows).map((r) => r.externalId);
    const b = assignIdentities(rows).map((r) => r.externalId);
    expect(new Set(a).size).toBe(3);
    expect(b).toEqual(a);
  });

  /*
    هذا هو العطب الذي كشفته المراجعة: العدّ كان بالوصف الخام والبصمة
    بالوصف الموحَّد. فحركتان لا يفرّقهما إلّا فراغٌ مزدوج تأخذان الترتيب
    صفراً كلتاهما، ثمّ يوحّدهما التطبيع فتخرج لهما بصمةٌ واحدة —
    فتُبتلَع الثانية بوصفها «مكرّرة». مالٌ حقيقي يختفي بلا شكوى.
  */
  it("حركتان يفرّقهما الفراغ وحده تبقيان اثنتين", () => {
    const rows = [
      row("2026-08-01", 300, "رسوم قناة"),
      row("2026-08-01", 300, "رسوم  قناة"),
    ];
    const ids = assignIdentities(rows).map((r) => r.externalId);
    expect(new Set(ids).size).toBe(2);
  });

  it("العدّ والبصمة يستعملان التطبيع نفسه", () => {
    // ثلاث صيغٍ لوصفٍ واحد: ترتيبها ٠ و١ و٢ لا ثلاثة أصفار
    const rows = [
      row("2026-08-01", 8, "POS VS"),
      row("2026-08-01", 8, "pos  vs"),
      row("2026-08-01", 8, " POS VS "),
    ];
    const ids = assignIdentities(rows).map((r) => r.externalId);
    expect(new Set(ids).size).toBe(3);
    expect(normalizeDescription("pos  vs")).toBe(normalizeDescription(" POS VS "));
  });

  it("ترتيب المجموعة يُحسب لكل مجموعة على حدة", () => {
    const rows = [
      row("2026-08-01", 500, "أ"),
      row("2026-08-01", 700, "ب"),
      row("2026-08-01", 500, "أ"),
    ];
    const ids = assignIdentities(rows);
    // الأوّل والثالث متطابقان في المحتوى لكن ترتيبهما مختلف
    expect(ids[0].externalId).not.toBe(ids[2].externalId);
    expect(new Set(ids.map((r) => r.externalId)).size).toBe(3);
  });

  it("الوصف الفارغ لا يُسقط الهوية", () => {
    const ids = assignIdentities([
      { valueDate: d("2026-08-01"), amountMinor: 300, direction: "DEBIT" as const, description: null },
    ]);
    expect(ids[0].externalId).toHaveLength(64);
  });
});

describe("fileFingerprint", () => {
  it("الملف نفسه يعطي البصمة نفسها", () => {
    const a = Buffer.from("محتوى كشف");
    expect(fileFingerprint(a)).toBe(fileFingerprint(Buffer.from("محتوى كشف")));
  });

  it("اختلاف بايت واحد يغيّر البصمة", () => {
    expect(fileFingerprint(Buffer.from("أ"))).not.toBe(fileFingerprint(Buffer.from("ب")));
  });
});

describe("المفتاح الطبيعيّ: رفعُ الكشف عشرين مرّة لا يزيد حركة", () => {
  const day = (d: string) => new Date(`${d}T00:00:00Z`);

  /** كشفٌ فيه حركتان متطابقتان في اليوم — وهما حقيقيّتان. */
  const file = [
    { valueDate: day("2026-08-12"), amountMinor: 50, direction: "DEBIT" as const, description: "CITY:Digital Channel" },
    { valueDate: day("2026-08-12"), amountMinor: 50, direction: "DEBIT" as const, description: "CITY:Digital Channel" },
    { valueDate: day("2026-08-12"), amountMinor: 833_75, direction: "DEBIT" as const, description: "حوالة top taste" },
  ];

  it("أوّل استيراد: كلّ الصفوف جديدة", () => {
    const rows = assignIdentities(file);
    expect(unseenRows(rows, new Map())).toHaveLength(3);
  });

  it("رفعُ الملف نفسه عشرين مرّة لا يضيف شيئاً", () => {
    const rows = assignIdentities(file);
    let stored = [...rows];
    for (let i = 0; i < 20; i++) {
      const fresh = unseenRows(rows, countByNaturalKey(stored));
      expect(fresh).toHaveLength(0);
      stored = [...stored, ...fresh];
    }
    expect(stored).toHaveLength(3);
  });

  it("الحركتان المتطابقتان الحقيقيّتان تبقيان اثنتين", () => {
    const stored = assignIdentities(file);
    expect(countByNaturalKey(stored).get(naturalKey(file[0]))).toBe(2);
  });

  it("كشفٌ أطول يذكرها ثلاثاً: تدخل الثالثة وحدها", () => {
    const stored = assignIdentities(file);
    const longer = assignIdentities([...file, {
      valueDate: day("2026-08-12"), amountMinor: 50, direction: "DEBIT" as const,
      description: "CITY:Digital Channel",
    }]);
    const fresh = unseenRows(longer, countByNaturalKey(stored));
    expect(fresh).toHaveLength(1);
    expect(fresh[0].occurrence).toBe(2);
  });

  it("المفتاح لا يتأثّر بفراغٍ مزدوج ولا بحالة الأحرف", () => {
    expect(naturalKey({ ...file[2], description: "حوالة  TOP  TASTE" }))
      .toBe(naturalKey({ ...file[2], description: " حوالة top taste " }));
  });

  it("حركةٌ بمبلغٍ مختلف مفتاحُها مختلف — ولا تُبتلَع", () => {
    expect(naturalKey(file[0])).not.toBe(naturalKey({ ...file[0], amountMinor: 51 }));
  });
});
