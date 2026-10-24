import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { balanceIsLow, decimalToCents, formatAiBalance, parseBalanceReply } from "./balance";
import { fetchDeepseekBalance } from "./deepseek";
import { withDeadline } from "./deadline";

const reply = (infos: unknown[], available = true) => ({ is_available: available, balance_infos: infos });

describe("رصيد القراءة الذكيّة — قراءةُ الردّ", () => {
  it("المبلغُ نصّاً إلى سنتٍ صحيح، بلا عددٍ عائم", () => {
    expect(decimalToCents("110.00")).toBe(11_000);
    expect(decimalToCents("3.5")).toBe(350);
    expect(decimalToCents("7")).toBe(700);
    expect(decimalToCents("0.07")).toBe(7);
    expect(decimalToCents("1.234")).toBeNull();
    expect(decimalToCents("abc")).toBeNull();
    expect(decimalToCents(undefined)).toBeNull();
  });

  it("الدولارُ أوّلاً إن وُجد", () => {
    const b = parseBalanceReply(reply([
      { currency: "CNY", total_balance: "20.00" },
      { currency: "USD", total_balance: "4.20", granted_balance: "0.00", topped_up_balance: "4.20" },
    ]));
    expect(b).toEqual({ known: true, currency: "USD", cents: 420, available: true });
    expect(formatAiBalance(b)).toBe("4.20 USD");
  });

  it("ردٌّ بلا رصيدٍ يُقرأ: غير معروف — لا صفر", () => {
    expect(parseBalanceReply({}).known).toBe(false);
    expect(parseBalanceReply(reply([])).known).toBe(false);
    expect(parseBalanceReply(reply([{ currency: "USD", total_balance: "n/a" }])).known).toBe(false);
    expect(formatAiBalance({ known: false, reason: "x" })).toBe("غير معروف");
  });

  it("ينفد تحت ٥ دولارات، أو حين يقول المزوّد إنّه لا يكفي — وعملةٌ بلا حدّ لا تُنذر", () => {
    expect(balanceIsLow({ known: true, currency: "USD", cents: 499, available: true })).toBe(true);
    expect(balanceIsLow({ known: true, currency: "USD", cents: 500, available: true })).toBe(false);
    expect(balanceIsLow({ known: true, currency: "USD", cents: 90_000, available: false })).toBe(true);
    expect(balanceIsLow({ known: true, currency: "EUR", cents: 1, available: true })).toBe(false);
    expect(balanceIsLow({ known: false, reason: "x" })).toBe(false);
  });
});

describe("سؤالُ المزوّد عن الرصيد", () => {
  beforeEach(() => { process.env.DEEPSEEK_API_KEY = "sk-test"; });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.DEEPSEEK_API_KEY; });

  it("بالمفتاح نفسه إلى /user/balance", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify(reply([{ currency: "USD", total_balance: "12.34" }])), { status: 200 }));
    vi.stubGlobal("fetch", f);
    expect(await withDeadline(10_000, () => fetchDeepseekBalance())).toEqual({ known: true, currency: "USD", cents: 1_234, available: true });
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toMatch(/\/user\/balance$/);
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk-test");
  });

  it("بلا مفتاح لا يُنادى أحد", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect((await fetchDeepseekBalance()).known).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("رفضٌ أو ردٌّ لا يُقرأ أو انقطاع: غير معروف بسببه", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 401 })));
    expect(await fetchDeepseekBalance()).toEqual({ known: false, reason: "ردّ المزوّد 401" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })));
    expect((await fetchDeepseekBalance()).known).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await fetchDeepseekBalance()).toEqual({ known: false, reason: "تعذّر الاتصال بالمزوّد" });
  });

  it("لم يبقَ من موعد المسار ما يكفي: لا يُسأل", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect((await withDeadline(1_000, () => fetchDeepseekBalance())).known).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
