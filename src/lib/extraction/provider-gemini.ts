/**
 * مزوّد جيميني — الطبقة المجانية.
 *
 * تنبيه مسجَّل للمرجع: شروط جوجل للخدمات غير المدفوعة تنصّ على أنّ البيانات
 * تُستخدم لتحسين منتجاتها وقد يقرؤها مراجعون بشريون. اختار أحمد هذا المسار
 * مؤقتاً عن علم، على أن يُنقل لاحقاً. الانتقال سطر واحد: EXTRACTION_PROVIDER.
 *
 * الإعداد:
 *   GEMINI_API_KEY=...      من https://aistudio.google.com/apikey
 *   EXTRACTION_PROVIDER=gemini
 */
import { extractionSchema } from "./schema";
import {
  buildInstructions,
  type ExtractionOutcome,
  type ExtractionProvider,
  type ExtractionRequest,
} from "./provider";

const DEFAULT_MODEL = "gemini-flash-latest";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

function modelName(): string {
  return process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
}

/**
 * مخطّط جيميني مكتوب يدوياً لا مولَّداً من zod.
 * السبب: جيميني يقبل مجموعة فرعية من OpenAPI ويرفض مفاتيح JSON Schema
 * مثل additionalProperties و $ref التي يولّدها zod، فالتوليد التلقائي يفشل بصمت.
 */
const GEMINI_SCHEMA = {
  type: "OBJECT",
  properties: {
    documentKind: {
      type: "STRING",
      enum: [
        "TAX_INVOICE", "SIMPLIFIED_INVOICE", "STATEMENT", "QUOTATION", "PROFORMA",
        "RECEIPT", "CASH_RECEIPT", "CONTRACT", "UTILITY", "UNKNOWN",
      ],
      description: "نوع المستند",
    },
    supplierNameAr: { type: "STRING", description: "اسم المورد بالعربية أو فارغ" },
    supplierNameEn: { type: "STRING", description: "اسم المورد بالإنجليزية أو فارغ" },
    sellerVatNumber: { type: "STRING", description: "الرقم الضريبي للبائع أو فارغ" },
    sellerCrNumber: { type: "STRING", description: "السجل التجاري للبائع أو فارغ" },
    buyerNameAr: { type: "STRING", description: "اسم المشتري أو فارغ" },
    buyerVatNumber: { type: "STRING", description: "الرقم الضريبي للمشتري أو فارغ" },
    invoiceNumber: { type: "STRING", description: "رقم الفاتورة أو فارغ" },
    invoiceDate: { type: "STRING", description: "التاريخ بصيغة YYYY-MM-DD ميلادية أو فارغ" },
    subtotalAmount: { type: "STRING", description: "الإجمالي قبل الضريبة بمنزلتين عشريتين أو فارغ" },
    vatAmount: { type: "STRING", description: "مبلغ الضريبة بمنزلتين عشريتين أو فارغ" },
    totalAmount: { type: "STRING", description: "الإجمالي شامل الضريبة بمنزلتين عشريتين أو فارغ" },
    beneficiaryName: { type: "STRING", description: "اسم المستفيد في إيصال التحويل أو فارغ" },
    lines: {
      type: "ARRAY",
      description: "بنود الفاتورة",
      items: {
        type: "OBJECT",
        properties: {
          description: { type: "STRING" },
          quantity: { type: "STRING" },
          unitPrice: { type: "STRING" },
          lineTotal: { type: "STRING" },
        },
        required: ["description", "quantity", "unitPrice", "lineTotal"],
      },
    },
    confidence: {
      type: "OBJECT",
      description: "ثقتك في كل مجموعة حقول بين 0 و 1",
      properties: {
        documentKind: { type: "NUMBER" },
        supplierName: { type: "NUMBER" },
        invoiceNumber: { type: "NUMBER" },
        invoiceDate: { type: "NUMBER" },
        amounts: { type: "NUMBER" },
        vatNumbers: { type: "NUMBER" },
      },
      required: ["documentKind", "supplierName", "invoiceNumber", "invoiceDate", "amounts", "vatNumbers"],
    },
    notes: { type: "STRING", description: "ملاحظة قصيرة بالعربية أو فارغ" },
  },
  required: [
    "documentKind", "supplierNameAr", "supplierNameEn", "sellerVatNumber", "sellerCrNumber",
    "buyerNameAr", "buyerVatNumber", "invoiceNumber", "invoiceDate", "subtotalAmount",
    "vatAmount", "totalAmount", "beneficiaryName", "lines", "confidence", "notes",
  ],
} as const;

/** أخطاء عابرة تستحق إعادة المحاولة: ضغط على النموذج أو حدّ لحظي. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

/** أساس التباعد بين المحاولات. يُضبط صفراً في الاختبارات فلا تنتظر. */
function retryBaseMs(): number {
  const raw = Number(process.env.GEMINI_RETRY_BASE_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 1000;
}

const wait = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

const SUPPORTED = [
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
];

export const geminiProvider: ExtractionProvider = {
  name: "gemini",

  isConfigured() {
    return Boolean(process.env.GEMINI_API_KEY);
  },

  async extract(request: ExtractionRequest): Promise<ExtractionOutcome> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      return {
        ok: false,
        provider: "gemini",
        reason: "مفتاح GEMINI_API_KEY غير مضبوط. احصل عليه مجاناً من aistudio.google.com/apikey",
      };
    }
    if (!SUPPORTED.includes(request.mimeType)) {
      return { ok: false, provider: "gemini", reason: `نوع ملف غير مدعوم: ${request.mimeType}` };
    }

    const body = JSON.stringify({
          system_instruction: {
            parts: [
              {
                text: buildInstructions(
                  request.companyVat,
                  request.companyName,
                  request.supplierNames,
                ),
              },
            ],
          },
          contents: [
            {
              role: "user",
              parts: [
                { inline_data: { mime_type: request.mimeType, data: request.data.toString("base64") } },
                { text: "استخرج حقول هذا المستند وفق المخطط المطلوب." },
              ],
            },
          ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: GEMINI_SCHEMA,
      },
    });

    // النماذج المجانية تتعرّض للضغط كثيراً، والفشل من أول محاولة يوقف
    // المستخدم بلا داعٍ. نعيد المحاولة بتباعد متزايد على الأخطاء العابرة وحدها.
    let response: Response | null = null;
    let lastError = "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        response = await fetch(`${ENDPOINT}/${modelName()}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body,
        });
      } catch (e) {
        lastError = (e as Error).message;
        response = null;
        if (attempt < MAX_ATTEMPTS) {
          await wait(retryBaseMs() * 2 ** (attempt - 1));
          continue;
        }
        return { ok: false, provider: "gemini", reason: `تعذّر الاتصال بجيميني: ${lastError}` };
      }

      if (response.ok) break;

      if (RETRYABLE.has(response.status) && attempt < MAX_ATTEMPTS) {
        await wait(retryBaseMs() * 2 ** (attempt - 1));
        continue;
      }
      break;
    }

    if (!response) {
      return { ok: false, provider: "gemini", reason: `تعذّر الاتصال بجيميني: ${lastError}` };
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 429) {
        return {
          ok: false,
          provider: "gemini",
          reason: "تجاوزنا حدّ الطبقة المجانية لجيميني. انتظر دقيقة وأعد المحاولة.",
        };
      }
      if (response.status === 503) {
        return {
          ok: false,
          provider: "gemini",
          reason: `النموذج ${modelName()} تحت ضغط شديد الآن رغم ${MAX_ATTEMPTS} محاولات. أعد المحاولة بعد دقائق.`,
        };
      }
      if (response.status === 404) {
        return {
          ok: false,
          provider: "gemini",
          reason: `النموذج ${modelName()} غير متاح لمفتاحك. جرّب ضبط GEMINI_MODEL على اسم آخر.`,
        };
      }
      return {
        ok: false,
        provider: "gemini",
        reason: `جيميني ردّ بخطأ ${response.status}: ${text.slice(0, 200)}`,
      };
    }

    let payload: {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      return { ok: false, provider: "gemini", reason: "رد غير مفهوم من جيميني" };
    }

    const candidate = payload.candidates?.[0];
    if (candidate?.finishReason && !["STOP", "MAX_TOKENS"].includes(candidate.finishReason)) {
      return {
        ok: false,
        provider: "gemini",
        reason: `توقّف جيميني بسبب: ${candidate.finishReason}. راجع المستند يدوياً.`,
      };
    }

    const raw = candidate?.content?.parts?.map((p) => p.text ?? "").join("").trim();
    if (!raw) return { ok: false, provider: "gemini", reason: "لم يُرجع جيميني محتوى" };

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { ok: false, provider: "gemini", reason: "مخرجات جيميني ليست JSON صالحاً" };
    }

    const parsed = extractionSchema.safeParse(json);
    if (!parsed.success) {
      return {
        ok: false,
        provider: "gemini",
        reason: `مخرجات جيميني ناقصة: ${parsed.error.issues.slice(0, 3).map((i) => i.path.join(".")).join("، ")}`,
      };
    }

    return {
      ok: true,
      provider: "gemini",
      value: parsed.data,
      model: modelName(),
      usage: {
        inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  },
};
