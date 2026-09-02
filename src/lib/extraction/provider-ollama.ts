/**
 * مزوّد مجاني مفتوح المصدر — نموذج رؤية يعمل على جهازك عبر Ollama.
 *
 * مجاني تماماً وخاص تماماً: لا مفتاح، ولا فاتورة، ولا تخرج فواتيرك من جهازك.
 * ثمن ذلك أمران يجب أن يكونا معلومين:
 *   ١. دقّته على الفواتير العربية الممسوحة أقل من النماذج التجارية، فتزيد المراجعة اليدوية.
 *   ٢. لا يعمل إلا والجهاز مشتغل — فلا يصله تطبيق منشور على السحابة.
 *
 * الإعداد:
 *   ollama pull qwen2.5vl:7b
 *   EXTRACTION_PROVIDER=ollama  و  OLLAMA_HOST=http://127.0.0.1:11434
 */
import { z } from "zod";
import { extractionSchema } from "./schema";
import {
  buildInstructions,
  type ExtractionOutcome,
  type ExtractionProvider,
  type ExtractionRequest,
} from "./provider";

const DEFAULT_HOST = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "qwen2.5vl:7b";

function host(): string {
  return (process.env.OLLAMA_HOST ?? DEFAULT_HOST).replace(/\/+$/, "");
}

function modelName(): string {
  return process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;
}

/** يحوّل مخطّط zod إلى JSON Schema يفهمه Ollama لتقييد المخرجات. */
function jsonSchema(): unknown {
  return z.toJSONSchema(extractionSchema);
}

export const ollamaProvider: ExtractionProvider = {
  name: "ollama",

  isConfigured() {
    return Boolean(process.env.OLLAMA_HOST || process.env.EXTRACTION_PROVIDER === "ollama");
  },

  async extract(request: ExtractionRequest): Promise<ExtractionOutcome> {
    // النماذج المحلية المتاحة اليوم تقرأ الصور لا ملفات PDF مباشرةً.
    if (request.mimeType === "application/pdf") {
      return {
        ok: false,
        provider: "ollama",
        reason:
          "النموذج المحلي يقرأ الصور فقط. حوّل صفحة الـPDF إلى صورة، أو استخدم مزوّد Claude لملفات PDF.",
      };
    }

    const url = `${host()}/api/chat`;
    let response: Response;

    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: modelName(),
          stream: false,
          format: jsonSchema(),
          options: { temperature: 0 },
          messages: [
            {
              role: "system",
              content: buildInstructions(
                request.companyVat,
                request.companyName,
                request.supplierNames,
              ),
            },
            {
              role: "user",
              content: "استخرج حقول هذا المستند وفق المخطط المطلوب.",
              images: [request.data.toString("base64")],
            },
          ],
        }),
      });
    } catch {
      return {
        ok: false,
        provider: "ollama",
        reason: `تعذّر الاتصال بـOllama على ${host()}. تأكّد أنه يعمل: ollama serve`,
      };
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        provider: "ollama",
        reason: `Ollama ردّ بخطأ ${response.status}. ${text.slice(0, 200)}`,
      };
    }

    let payload: { message?: { content?: string } };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      return { ok: false, provider: "ollama", reason: "رد غير مفهوم من Ollama" };
    }

    const raw = payload.message?.content?.trim();
    if (!raw) return { ok: false, provider: "ollama", reason: "لم يُرجع النموذج المحلي محتوى" };

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        provider: "ollama",
        reason: "لم يلتزم النموذج المحلي بصيغة JSON. جرّب نموذجاً أكبر أو استخدم Claude.",
      };
    }

    const parsed = extractionSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return {
        ok: false,
        provider: "ollama",
        reason: `مخرجات النموذج المحلي ناقصة: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => i.path.join("."))
          .join("، ")}`,
      };
    }

    return { ok: true, value: parsed.data, model: modelName(), provider: "ollama" };
  },
};
