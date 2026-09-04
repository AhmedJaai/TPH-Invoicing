import { describe, expect, it } from "vitest";
import { assignIdentities, fileFingerprint, transactionIdentity } from "./identity";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

const row = (date: string, amount: number, desc: string, dir: "DEBIT" | "CREDIT" = "DEBIT") => ({
  valueDate: d(date), amountMinor: amount, direction: dir, description: desc,
});

describe("transactionIdentity", () => {
  const base = {
    accountNumber: "12600000942005",
    valueDate: "2026-08-13",
    amountMinor: 15_000,
    direction: "DEBIT" as const,
    description: "حوالة صادرة",
    occurrence: 0,
  };

  it("المدخلات نفسها تعطي الهوية نفسها", () => {
    expect(transactionIdentity(base)).toBe(transactionIdentity({ ...base }));
  });

  it("اختلاف أي جزء يغيّر الهوية", () => {
    const id = transactionIdentity(base);
    expect(transactionIdentity({ ...base, amountMinor: 15_001 })).not.toBe(id);
    expect(transactionIdentity({ ...base, valueDate: "2026-08-14" })).not.toBe(id);
    expect(transactionIdentity({ ...base, direction: "CREDIT" })).not.toBe(id);
    expect(transactionIdentity({ ...base, description: "غيره" })).not.toBe(id);
    expect(transactionIdentity({ ...base, occurrence: 1 })).not.toBe(id);
    expect(transactionIdentity({ ...base, accountNumber: "999" })).not.toBe(id);
  });

  it("الحساب الفارغ لا يكسر الهوية", () => {
    expect(transactionIdentity({ ...base, accountNumber: null })).toHaveLength(64);
  });
});

describe("assignIdentities", () => {
  it("استيراد الملف نفسه مرّتين يعطي البصمات نفسها — فلا يتكرّر", () => {
    const rows = [row("2026-08-01", 500, "أ"), row("2026-08-02", 700, "ب")];
    const first = assignIdentities(rows, "ACC").map((r) => r.externalId);
    const second = assignIdentities(rows, "ACC").map((r) => r.externalId);
    expect(second).toEqual(first);
  });

  it("حركتان متطابقتان في الملف الواحد تبقيان اثنتين", () => {
    const rows = [row("2026-08-01", 300, "رسوم"), row("2026-08-01", 300, "رسوم")];
    const ids = assignIdentities(rows, "ACC").map((r) => r.externalId);
    expect(new Set(ids).size).toBe(2);
  });

  it("ثلاث حركات متطابقة تعطي ثلاث هويات، وإعادة الاستيراد تعطيها هي نفسها", () => {
    const rows = [row("2026-08-01", 8, "قناة"), row("2026-08-01", 8, "قناة"), row("2026-08-01", 8, "قناة")];
    const a = assignIdentities(rows, "ACC").map((r) => r.externalId);
    const b = assignIdentities(rows, "ACC").map((r) => r.externalId);
    expect(new Set(a).size).toBe(3);
    expect(b).toEqual(a);
  });

  it("اختلاف رقم الحساب يفصل بين كشفين متشابهين", () => {
    const rows = [row("2026-08-01", 500, "أ")];
    expect(assignIdentities(rows, "ACC-1")[0].externalId)
      .not.toBe(assignIdentities(rows, "ACC-2")[0].externalId);
  });

  it("ترتيب المجموعة يُحسب لكل مجموعة على حدة", () => {
    const rows = [
      row("2026-08-01", 500, "أ"),
      row("2026-08-01", 700, "ب"),
      row("2026-08-01", 500, "أ"),
    ];
    const ids = assignIdentities(rows, "ACC");
    // الأوّل والثالث متطابقان في المحتوى لكن ترتيبهما مختلف
    expect(ids[0].externalId).not.toBe(ids[2].externalId);
    expect(new Set(ids.map((r) => r.externalId)).size).toBe(3);
  });

  it("الوصف الفارغ لا يُسقط الهوية", () => {
    const ids = assignIdentities([{ valueDate: d("2026-08-01"), amountMinor: 300, direction: "DEBIT" as const, description: null }], null);
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
