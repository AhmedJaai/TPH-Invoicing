/**
 * استخراج بيانات الفاتورة من الملف نفسه.
 *
 * يُمرَّر ملف الـPDF أو الصورة إلى Claude مباشرةً — فهو يقرأ المستندات
 * الممسوحة ضوئياً بنفسه. وهذا يغني عن محرّك OCR منفصل، ويحلّ مشكلة
 * الحروف العربية المقلوبة التي تصيب استخراج النصّ من ملفات PDF.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { extractionSchema, type ExtractionResult } from "./schema";

export const EXTRACTION_MODEL = "claude-opus-5";

/** أنواع الملفات التي يقبلها النموذج مباشرةً. */
const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
const PDF_TYPE = "application/pdf";

export function isSupportedUpload(mimeType: string): boolean {
  return mimeType === PDF_TYPE || (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(mimeType);
}

function buildSystemPrompt(companyVat: string, companyName: string, supplierNames: string[]): string {
  return `أنت مساعد محاسبي دقيق في ${companyName}، مقهى في جدة. مهمتك قراءة مستند مالي واستخراج حقوله حرفياً.

الرقم الضريبي لمنشأتنا: ${companyVat}
نحن دائماً المشتري في هذه المستندات، لا البائع.

موردونا المعروفون: ${supplierNames.join(" · ")}

قواعد الاستخراج:
- انسخ الأرقام كما هي حرفياً. لا تحسب ولا تصحّح ولا تستنتج مبلغاً غائباً.
- إن كان المبلغ غير واضح أو مقطوعاً، اتركه فارغاً واخفض الثقة. الفراغ أأمن من التخمين.
- ميّز الرقم الضريبي للبائع عن رقم المشتري بموضعه في المستند لا بشكله. رقمنا ${companyVat} هو رقم المشتري دائماً.
- المستند الذي يحمل «عرض سعر» أو Quotation أو Proforma ليس فاتورة مهما شابهها.
- المستند الذي يجمع عدة عمليات بتواريخ مختلفة ورصيد مُدوَّر هو كشف حساب لا فاتورة.
- التاريخ بصيغة YYYY-MM-DD ميلادية. إن لم يظهر إلا التاريخ الهجري فحوّله واخفض ثقة التاريخ.
- الثقة تقديرك الصادق للوضوح: المستند الممسوح بجودة رديئة ثقته منخفضة ولو قرأتَه.`;
}

export interface ExtractionInput {
  data: Buffer;
  mimeType: string;
  companyVat: string;
  companyName: string;
  supplierNames: string[];
}

export interface ExtractionOutcome {
  ok: true;
  value: ExtractionResult;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ExtractionFailure {
  ok: false;
  reason: string;
}

export async function extractDocument(
  input: ExtractionInput,
): Promise<ExtractionOutcome | ExtractionFailure> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, reason: "مفتاح ANTHROPIC_API_KEY غير مضبوط. أضفه إلى ملف .env" };
  }
  if (!isSupportedUpload(input.mimeType)) {
    return { ok: false, reason: `نوع ملف غير مدعوم: ${input.mimeType}` };
  }

  const client = new Anthropic();
  const base64 = input.data.toString("base64");

  const fileBlock =
    input.mimeType === PDF_TYPE
      ? ({
          type: "document" as const,
          source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 },
        })
      : ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: input.mimeType as (typeof SUPPORTED_IMAGE_TYPES)[number],
            data: base64,
          },
        });

  try {
    const response = await client.messages.parse({
      model: EXTRACTION_MODEL,
      max_tokens: 16000,
      system: [
        {
          type: "text",
          text: buildSystemPrompt(input.companyVat, input.companyName, input.supplierNames),
          // التعليمات ثابتة عبر كل الرفعات — تخزينها يخفض الكلفة كثيراً
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            fileBlock,
            { type: "text", text: "استخرج حقول هذا المستند وفق المخطط المطلوب." },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(extractionSchema) },
    });

    if (response.stop_reason === "refusal") {
      return { ok: false, reason: "رفض النموذج معالجة هذا الملف. راجعه يدوياً." };
    }
    if (response.stop_reason === "max_tokens") {
      return { ok: false, reason: "المستند أطول من المتوقع ولم يكتمل استخراجه." };
    }
    if (!response.parsed_output) {
      return { ok: false, reason: "تعذّر تحليل مخرجات النموذج." };
    }

    return {
      ok: true,
      value: response.parsed_output,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, reason: "تجاوزنا حدّ الطلبات. أعد المحاولة بعد قليل." };
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return { ok: false, reason: "مفتاح Anthropic غير صالح." };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, reason: `خطأ من واجهة Claude (${error.status}): ${error.message}` };
    }
    return { ok: false, reason: `خطأ غير متوقع: ${(error as Error).message}` };
  }
}
