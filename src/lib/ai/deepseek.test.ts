import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callDeepseek, parseJsonLoose, mapWithConcurrency } from "./deepseek";

/**
 * الفشل يُصنَّف ولا يُخلَط.
 *
 * وهذا ما تحرسه هذه الاختبارات: «تعذّر الاتصال» تُقال حين لا يصل
 * الطلب، لا حين يردّ الخادم بخطأ — وإلّا أُرسل صاحب العمل يفحص شبكةً
 * سليمة بينما العطب رصيدٌ نفد.
 */

const ok = (content: string) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
    { status: 200 },
  );

const err = (status: number, message = "boom") =>
  new Response(JSON.stringify({ error: { message } }), { status });

const call = () =>
  callDeepseek({ task: "TEXT", maxTokens: 100, messages: [{ role: "user", content: "س" }] });

describe("نداء ديب سيك", () => {
  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    process.env.DEEPSEEK_RETRY_BASE_MS = "0";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("بلا مفتاح لا يُنادى أحد", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const r = await call();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("NOT_CONFIGURED");
  });

  it("ينجح ويحمل الاستهلاك", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok("مرحباً")));
    const r = await call();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toBe("مرحباً");
      expect(r.usage.inputTokens).toBe(10);
    }
  });

  /*
    ٤٠٢ وقعت فعلاً: المفتاح صحيح والرصيد صفر. وإعادة المحاولة عليها
    تُضيّع الوقت وتُخفي السبب — فتُميَّز وتُردّ من أوّل مرّة.
  */
  it("الرصيد الناضب يُميَّز ولا يُعاد عليه", async () => {
    const f = vi.fn().mockResolvedValue(err(402, "Insufficient Balance"));
    vi.stubGlobal("fetch", f);
    const r = await call();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("NO_BALANCE");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("المفتاح الباطل يُميَّز عن انقطاع الخدمة", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(err(401)));
    const r = await call();
    if (!r.ok) expect(r.kind).toBe("NOT_CONFIGURED");
  });

  it("النموذج المفقود يُسمّى في الرسالة", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(err(404)));
    const r = await call();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("غير متاح");
  });

  it("الضغط اللحظيّ يُعاد عليه ثمّ ينجح", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(err(429))
      .mockResolvedValueOnce(ok("تمّ"));
    vi.stubGlobal("fetch", f);
    const r = await call();
    expect(r.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("انقطاع الشبكة يُعاد عليه ثمّ يُعلَن", async () => {
    const f = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    vi.stubGlobal("fetch", f);
    const r = await call();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("AI_UNAVAILABLE");
    expect(f).toHaveBeenCalledTimes(3);
  });

  /*
    المخرَج المقطوع عند السقف ليس نجاحاً ناقصاً — هو فشل.
    JSON غير مكتمل يُقرأ نصفَ حقول، وفي مستندٍ ماليّ نصفُ الرقم أسوأ
    من لا رقم. وقد وقع فعلاً: انقطع مخرَجُ فاتورةٍ عند ٨٠٠٠ رمز.
  */
  it("الانقطاع عند سقف الرموز فشلٌ لا نجاح", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"a":' }, finish_reason: "length" }],
          }),
          { status: 200 },
        ),
      ),
    );
    const r = await call();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("INVALID_RESPONSE");
  });

  it("الردّ الذي ليس JSON يُعلَن ولا يُخمَّن", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>خطأ</html>", { status: 200 })),
    );
    const r = await call();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("INVALID_RESPONSE");
  });

  it("الردّ الفارغ فشل", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok("   ")));
    const r = await call();
    expect(r.ok).toBe(false);
  });
});

describe("تحليل JSON المتساهل", () => {
  it("يقرأ الكائن العاري", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("يقشّر سياج الشيفرة", () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("يلتقط الكائن من بين كلامٍ زائد", () => {
    expect(parseJsonLoose('إليك الجواب: {"a":1} انتهى')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("وما ليس فيه كائنٌ يُردّ ولا يُخترَع له شيء", () => {
    expect(parseJsonLoose("لا شيء هنا").ok).toBe(false);
  });
});

describe("التزامن المحدود", () => {
  it("يحفظ الترتيب ولا يتجاوز السقف", async () => {
    let live = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      live--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("والقائمة الفارغة لا تعلّق", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});
