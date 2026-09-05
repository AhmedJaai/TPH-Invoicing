import { describe, expect, it, vi, afterEach } from "vitest";
import {
  adjudicatorNames, claudeProvider, deepseekProvider, geminiProvider,
  qwenProvider, selectedAdjudicator, verdictSchema,
} from "./adjudicator-provider";

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; vi.restoreAllMocks(); });

describe("المزوّدون — التحكيم محايد", () => {
  it("أربعة مزوّدين معرَّفون", () => {
    expect(adjudicatorNames().sort()).toEqual(["claude", "deepseek", "gemini", "qwen"]);
  });

  it("يُختار بمتغيّر منفصل عن الاستخراج", () => {
    process.env.ADJUDICATOR_PROVIDER = "claude";
    process.env.EXTRACTION_PROVIDER = "gemini";
    expect(selectedAdjudicator().name).toBe("claude");
  });

  it("والاسم المجهول يرجع إلى الافتراضيّ لا يكسر", () => {
    process.env.ADJUDICATOR_PROVIDER = "لا-يوجد";
    expect(selectedAdjudicator().name).toBe("gemini");
  });

  it("غير المهيَّأ يُعلن ذلك ولا يُحاوَل", () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.QWEN_API_KEY;
    expect(geminiProvider().isConfigured()).toBe(false);
    expect(claudeProvider().isConfigured()).toBe(false);
    expect(deepseekProvider().isConfigured()).toBe(false);
    expect(qwenProvider().isConfigured()).toBe(false);
  });

  it("النموذج مثبَّت لا عائم", () => {
    delete process.env.ADJUDICATOR_MODEL;
    for (const p of [geminiProvider(), claudeProvider()]) {
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
  it("يقرأ مخرَج جيميني ويحسب المدّة", async () => {
    process.env.GEMINI_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{
          text: '{"choice":"c1","reasonCodes":["AMOUNT_EXACT"],"confidence":0.9,"reason":"م"}',
        }] } }],
      }),
    })));
    const r = await geminiProvider().judge("س");
    expect(r.verdict.choice).toBe("c1");
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

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

  it("ويُزيل سياج الشيفرة إن أحاط بالمخرَج", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        content: [{ text: '```json\n{"choice":"c2","reasonCodes":[],"confidence":0.7}\n```' }],
      }),
    })));
    expect((await claudeProvider().judge("س")).verdict.choice).toBe("c2");
  });

  it("والفشل يُرفَع خطأً لا يُبتلَع", async () => {
    process.env.GEMINI_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429 })));
    await expect(geminiProvider().judge("س")).rejects.toThrow("429");
  });
});
