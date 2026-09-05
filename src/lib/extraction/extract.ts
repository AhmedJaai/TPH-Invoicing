/**
 * استخراج بيانات الفاتورة من الملف نفسه.
 *
 * يُمرَّر ملف الـPDF أو الصورة إلى Claude مباشرةً — فهو يقرأ المستندات
 * الممسوحة ضوئياً بنفسه. وهذا يغني عن محرّك OCR منفصل، ويحلّ مشكلة
 * الحروف العربية المقلوبة التي تصيب استخراج النصّ من ملفات PDF.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { extractionSchema } from "./schema";
import { PINNED_MODELS } from "./versions";
import {
  buildInstructions,
  type ExtractionOutcome,
  type ExtractionProvider,
  type ExtractionRequest,
} from "./provider";

export const EXTRACTION_MODEL = PINNED_MODELS.claude;

/** أنواع الملفات التي يقبلها النموذج مباشرةً. */
const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
const PDF_TYPE = "application/pdf";

export function isSupportedUpload(mimeType: string): boolean {
  return mimeType === PDF_TYPE || (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(mimeType);
}

async function extractWithClaude(input: ExtractionRequest): Promise<ExtractionOutcome> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      provider: "claude",
      reason: "مفتاح ANTHROPIC_API_KEY غير مضبوط. أضفه إلى .env أو بدّل إلى المزوّد المحلي المجاني بـEXTRACTION_PROVIDER=ollama",
    };
  }
  if (!isSupportedUpload(input.mimeType)) {
    return { ok: false, provider: "claude", reason: `نوع ملف غير مدعوم: ${input.mimeType}` };
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
          text: buildInstructions(input.companyVat, input.companyName, input.supplierNames),
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
      return { ok: false, provider: "claude", reason: "رفض النموذج معالجة هذا الملف. راجعه يدوياً." };
    }
    if (response.stop_reason === "max_tokens") {
      return { ok: false, provider: "claude", reason: "المستند أطول من المتوقع ولم يكتمل استخراجه." };
    }
    if (!response.parsed_output) {
      return { ok: false, provider: "claude", reason: "تعذّر تحليل مخرجات النموذج." };
    }

    return {
      ok: true,
      provider: "claude",
      value: response.parsed_output,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, provider: "claude", reason: "تجاوزنا حدّ الطلبات. أعد المحاولة بعد قليل." };
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return { ok: false, provider: "claude", reason: "مفتاح Anthropic غير صالح." };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, provider: "claude", reason: `خطأ من واجهة Claude (${error.status}): ${error.message}` };
    }
    return { ok: false, provider: "claude", reason: `خطأ غير متوقع: ${(error as Error).message}` };
  }
}

export const claudeProvider: ExtractionProvider = {
  name: "claude",
  isConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY),
  extract: extractWithClaude,
};
