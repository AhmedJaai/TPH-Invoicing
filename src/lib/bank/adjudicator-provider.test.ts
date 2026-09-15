import { afterEach, describe, expect, it, vi } from "vitest";
import { deepseekProvider, selectedAdjudicator, verdictSchema } from "./adjudicator-provider";

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; vi.restoreAllMocks(); });

describe("مزوّد الحَكَم", () => {

  it("DeepSeek وحده — ولا يُختار غيره بمتغيّر", () => {
    process.env.ADJUDICATOR_PROVIDER = "claude";
    expect(selectedAdjudicator().name).toBe("deepseek");
  });

  it("والاسم المجهول يرجع إلى الافتراضيّ لا يكسر", () => {
    process.env.ADJUDICATOR_PROVIDER = "لا-يوجد";
    expect(selectedAdjudicator().name).toBe("deepseek");
  });

  it("غير المهيَّأ يُعلن ذلك ولا يُحاوَل", () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.QWEN_API_KEY;
    expect(deepseekProvider().isConfigured()).toBe(false);
  });

  it("النموذج مثبَّت لا عائم", () => {
    delete process.env.ADJUDICATOR_MODEL;
    for (const p of [deepseekProvider()]) {
      expect(p.model).not.toContain("latest");
      expect(p.model.length).toBeGreaterThan(0);
    }
  });
});

describe("قراءة المخرَج", () => {
  it("تقبل JSON صحيحاً", () => {
    const r = verdictSchema.safeParse({
      choice: "c1", reasonCodes: ["AMOUNT_EXACT"], confidence: 0.9, reason: "المبلغ",
    });
    expect(r.success).toBe(true);
  });

  it("وتقبل غياب الأسباب بقائمة فارغة لا بخطأ", () => {
    const r = verdictSchema.safeParse({ choice: "NONE", confidence: 0 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.reasonCodes).toEqual([]);
  });

  it("وترفض ما ينقصه الاختيار", () => {
    expect(verdictSchema.safeParse({ confidence: 0.9 }).success).toBe(false);
  });

  it("وترفض ثقةً ليست رقماً", () => {
    expect(verdictSchema.safeParse({ choice: "c1", confidence: "عالية" }).success).toBe(false);
  });
});

describe("الاستدعاء الفعليّ", () => {

  it("ويقرأ مخرَج ما يتكلّم لغة OpenAI", async () => {
    process.env.DEEPSEEK_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"choice":"NONE","reasonCodes":[],"confidence":0}' } }],
      }),
    })));
    const r = await deepseekProvider().judge("س");
    expect(r.verdict.choice).toBe("NONE");
  });
});
