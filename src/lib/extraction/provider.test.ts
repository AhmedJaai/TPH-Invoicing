import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectedProviderName } from "./provider";
import { geminiProvider } from "./provider-gemini";
import { ollamaProvider } from "./provider-ollama";

const VALID = {
  documentKind: "TAX_INVOICE",
  supplierNameAr: "أوراق الزيتون", supplierNameEn: "Olive Leaves",
  sellerVatNumber: "310111111100003", sellerCrNumber: "4030111111",
  buyerNameAr: "ذا بوبليك هاوس", buyerVatNumber: "310007971600003",
  invoiceNumber: "260302", invoiceDate: "2026-08-17",
  subtotalAmount: "113.04", vatAmount: "16.96", totalAmount: "130.00",
  beneficiaryName: "", lines: [],
  openingBalance: "", closingBalance: "", statementLines: [],
  confidence: { documentKind: 0.99, supplierName: 0.98, invoiceNumber: 0.97, invoiceDate: 0.99, amounts: 0.98, vatNumbers: 0.96 },
  notes: "",
};

const request = {
  data: Buffer.from("x"),
  mimeType: "application/pdf",
  companyVat: "310007971600003",
  companyName: "مؤسسة ذا بوبليك هاوس",
  supplierNames: ["أوراق الزيتون (OliveLeaves)"],
};

const geminiReply = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response);

describe("اختيار المزوّد", () => {
  const original = process.env.EXTRACTION_PROVIDER;
  afterEach(() => { process.env.EXTRACTION_PROVIDER = original; });

  it("الافتراضي كلود", () => {
    delete process.env.EXTRACTION_PROVIDER;
    expect(selectedProviderName()).toBe("claude");
  });

  it("يقبل جيميني وأولاما ويتجاهل الحروف الكبيرة", () => {
    process.env.EXTRACTION_PROVIDER = "GEMINI";
    expect(selectedProviderName()).toBe("gemini");
    process.env.EXTRACTION_PROVIDER = "ollama";
    expect(selectedProviderName()).toBe("ollama");
  });

  it("الاسم المجهول يرجع للافتراضي بدل أن يعطّل النظام", () => {
    process.env.EXTRACTION_PROVIDER = "chatgpt";
    expect(selectedProviderName()).toBe("claude");
  });
});

describe("مزوّد جيميني", () => {
  const original = process.env.GEMINI_API_KEY;
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_RETRY_BASE_MS = "0"; // بلا انتظار في الاختبارات
  });
  afterEach(() => {
    if (original === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = original;
    vi.unstubAllGlobals();
  });

  it("يشتكي بوضوح حين يغيب المفتاح", async () => {
    delete process.env.GEMINI_API_KEY;
    const r = await geminiProvider.extract(request);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("GEMINI_API_KEY");
  });

  it("يقرأ استجابة سليمة", async () => {
    vi.stubGlobal("fetch", geminiReply({
      candidates: [{ content: { parts: [{ text: JSON.stringify(VALID) }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 300 },
    }));
    const r = await geminiProvider.extract(request);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.invoiceNumber).toBe("260302");
    expect(r.value.totalAmount).toBe("130.00");
    expect(r.provider).toBe("gemini");
    expect(r.usage?.inputTokens).toBe(1200);
  });

  it("يترجم تجاوز حدّ الطبقة المجانية إلى رسالة مفهومة", async () => {
    vi.stubGlobal("fetch", geminiReply({ error: { message: "quota" } }, 429));
    const r = await geminiProvider.extract(request);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("الطبقة المجانية");
  });

  it("يرشد إلى تغيير اسم النموذج عند 404", async () => {
    vi.stubGlobal("fetch", geminiReply({ error: { message: "not found" } }, 404));
    const r = await geminiProvider.extract(request);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("GEMINI_MODEL");
  });

  it("يرفض المخرجات الناقصة بدل أن يمرّرها", async () => {
    vi.stubGlobal("fetch", geminiReply({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ documentKind: "TAX_INVOICE" }) }] }, finishReason: "STOP" }],
    }));
    const r = await geminiProvider.extract(request);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("ناقصة");
  });

  it("يرفض ما ليس JSON", async () => {
    vi.stubGlobal("fetch", geminiReply({
      candidates: [{ content: { parts: [{ text: "عذراً، لا أستطيع" }] }, finishReason: "STOP" }],
    }));
    const r = await geminiProvider.extract(request);
    expect(r.ok).toBe(false);
  });

  it("ينبّه على التوقّف لأسباب السلامة", async () => {
    vi.stubGlobal("fetch", geminiReply({ candidates: [{ finishReason: "SAFETY" }] }));
    const r = await geminiProvider.extract(request);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("SAFETY");
  });

  it("يرفض نوع ملف غير مدعوم", async () => {
    const r = await geminiProvider.extract({ ...request, mimeType: "text/plain" });
    expect(r.ok).toBe(false);
  });

  it("يعيد المحاولة على الضغط العابر ثم ينجح", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) {
        return { ok: false, status: 503, json: async () => ({}), text: async () => "busy" } as unknown as Response;
      }
      return {
        ok: true, status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(VALID) }] }, finishReason: "STOP" }] }),
        text: async () => "",
      } as unknown as Response;
    }));

    const r = await geminiProvider.extract(request);
    expect(calls).toBe(3);
    expect(r.ok).toBe(true);
  });

  it("يستسلم بعد أربع محاولات ويقول ذلك صراحةً", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      { ok: false, status: 503, json: async () => ({}), text: async () => "busy" } as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await geminiProvider.extract(request);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("ضغط شديد");
  });

  it("لا يعيد المحاولة على خطأ دائم مثل 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      { ok: false, status: 404, json: async () => ({}), text: async () => "no model" } as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await geminiProvider.extract(request);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
  });
});

describe("المزوّد المحلي", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("يوضّح أنه لا يقرأ PDF ويقترح البديل", async () => {
    const r = await ollamaProvider.extract(request);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("الصور");
      expect(r.reason).toContain("Claude");
    }
  });

  it("يرشد إلى تشغيل الخادم عند تعذّر الاتصال", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const r = await ollamaProvider.extract({ ...request, mimeType: "image/png" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("ollama serve");
  });

  it("يقرأ استجابة سليمة من نموذج محلي", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ message: { content: JSON.stringify(VALID) } }),
      text: async () => "",
    } as unknown as Response));
    const r = await ollamaProvider.extract({ ...request, mimeType: "image/png" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.provider).toBe("ollama");
  });
});
