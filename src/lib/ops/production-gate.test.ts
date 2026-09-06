import { describe, expect, it } from "vitest";
import { GATE_LABEL, GATE_ORDER, buildGate, type GateCheck } from "./production-gate";

const pass = (key: string): GateCheck => ({
  key, label: GATE_LABEL[key], status: "PASS", detail: "فُحص فنجح",
});

const all = () => GATE_ORDER.map(pass);

describe("بوّابة الإنتاج", () => {
  it("كلّ البنود تمرّ → جاهز", () => {
    const g = buildGate(all());
    expect(g.ready).toBe(true);
    expect(g.failed).toBe(0);
    expect(g.unknown).toBe(0);
  });

  it("بندٌ فاشل يمنع", () => {
    const g = buildGate([
      ...all().slice(1),
      { key: GATE_ORDER[0], label: "x", status: "FAIL", detail: "فشل" },
    ]);
    expect(g.ready).toBe(false);
    expect(g.verdict).toContain("فشل");
  });

  /*
    بوّابةٌ تعدّ غير المفحوص ناجحاً تُصدر شهادةً عن أشياء لم تُنظَر —
    وهي أخطر من ألّا تكون هناك بوّابة، إذ تُنتج ثقةً بلا سند.
  */
  it("«لم يُفحَص» يمنع كما يمنع «فشل»", () => {
    const g = buildGate([
      ...all().slice(1),
      { key: GATE_ORDER[0], label: "x", status: "UNKNOWN", detail: "لم يُفحَص" },
    ]);
    expect(g.ready).toBe(false);
    expect(g.unknown).toBe(1);
    expect(g.verdict).toContain("ليست «لا بأس»");
  });

  /* البند الساقط سهواً يجعل البوّابة تبدو أنقى ممّا هي */
  it("البند الساقط يُضاف مجهولاً ولا يختفي", () => {
    const g = buildGate(all().slice(0, 3));
    expect(g.checks).toHaveLength(GATE_ORDER.length);
    expect(g.unknown).toBe(GATE_ORDER.length - 3);
    expect(g.ready).toBe(false);
  });

  it("الترتيب ثابت — من الأساس إلى ما فوقه", () => {
    const g = buildGate(all());
    expect(g.checks.map((c) => c.key)).toEqual([...GATE_ORDER]);
    expect(GATE_ORDER[0]).toBe("migration_integrity");
  });

  it("لكلّ بندٍ اسمٌ عربيّ", () => {
    for (const key of GATE_ORDER) expect(GATE_LABEL[key]).toBeTruthy();
  });

  it("والبنود خمسة عشر — كما طُلبت", () => {
    expect(GATE_ORDER).toHaveLength(15);
  });
});
