/**
 * القراءة البصرية للكشف المصوَّر — استدعاء المزوّد.
 *
 * والفحص كلّه في `lib/bank/vision-statement.ts` دوالَّ خالصة: هذه
 * الطبقة تستدعي وتُسلّم، ولا تقرّر شيئاً.
 *
 * ولا يُستدعى إلّا حين يتعذّر النصّ. أكثرُ الكشوف منظَّمة، وقراءتها
 * حسابياً أدقّ وأرخص وأسرع — والنموذج للمصوَّر وحده.
 *
 * ويُرسَل الملفّ **مستنداً** لا صورةً مرسومة: كلا المزوّدَين يقرأ
 * الـPDF نفسه، فلا حاجة إلى تحويلٍ يفقد الدقّة ويضيف تبعيّة ثقيلة.
 */
import {
  buildVisionPrompt, visionStatementSchema, type VisionStatement,
} from "@/lib/bank/vision-statement";
import { callDeepseek } from "@/lib/ai/deepseek";
import { isDeepseekConfigured, modelFor } from "@/lib/ai/models";
import { resolveDocumentInput } from "@/lib/ai/document-input";
import { detailFor } from "@/lib/ai/pdf-images";

export type VisionProviderName = "deepseek" | "claude" | "gemini";

export interface VisionOutcome {
  ok: boolean;
  value?: VisionStatement;
  reason?: string;
  provider: VisionProviderName;
  model: string;
}

export interface VisionProvider {
  name: VisionProviderName;
  model: string;
  isConfigured(): boolean;
  read(pdf: Buffer): Promise<VisionOutcome>;
}

/** النماذج مثبَّتة لا عائمة — «الأحدث» يتغيّر تحتك بلا إعلان. */
export const VISION_MODELS = {
  claude: "claude-sonnet-5",
  gemini: "gemini-2.5-flash",
} as const;

/** يقتطع أوّل كتلة JSON — النماذج تُحيط الجواب بشرحٍ أحياناً رغم النهي. */
function firstJson(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function parseOrFail(
  text: string,
  provider: VisionProviderName,
  model: string,
): VisionOutcome {
  const json = firstJson(text);
  if (!json) return { ok: false, reason: "لم يُرجع النموذج JSON", provider, model };

  try {
    const value = visionStatementSchema.parse(JSON.parse(json));
    return { ok: true, value, provider, model };
  } catch {
    /*
      الجواب المخالف للمخطّط يُرَدّ ولا يُرمَّم. ترميمُه هنا يعني
      تخميناً على تخمين.
    */
    return { ok: false, reason: "جواب النموذج لا يوافق المخطّط", provider, model };
  }
}

export function claudeVision(): VisionProvider {
  const model = VISION_MODELS.claude;
  return {
    name: "claude",
    model,
    isConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY),
    async read(pdf) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 16_000,
          messages: [{
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") },
              },
              { type: "text", text: buildVisionPrompt() },
            ],
          }],
        }),
      });

      if (!res.ok) {
        return { ok: false, reason: `المزوّد ردّ ${res.status}`, provider: "claude", model };
      }

      const body = await res.json() as { content?: { type: string; text?: string }[] };
      const text = (body.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("");
      return parseOrFail(text, "claude", model);
    },
  };
}

export function geminiVision(): VisionProvider {
  const model = VISION_MODELS.gemini;
  return {
    name: "gemini",
    model,
    isConfigured: () => Boolean(process.env.GEMINI_API_KEY),
    async read(pdf) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": process.env.GEMINI_API_KEY ?? "",
          },
          body: JSON.stringify({
            contents: [{
              parts: [
                { inline_data: { mime_type: "application/pdf", data: pdf.toString("base64") } },
                { text: buildVisionPrompt() },
              ],
            }],
            generationConfig: { responseMimeType: "application/json", temperature: 0 },
          }),
        },
      );

      if (!res.ok) {
        return { ok: false, reason: `المزوّد ردّ ${res.status}`, provider: "gemini", model };
      }

      const body = await res.json() as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      return parseOrFail(text, "gemini", model);
    },
  };
}

/**
 * القراءة البصرية — DeepSeek.
 *
 * وهنا يظهر فرقٌ جوهريّ عن المزوّدَين السابقين: **كلاهما يقرأ الـPDF
 * نفسه، وDeepSeek لا يقبله.** الأنواع المقبولة عنده أربعة صور فقط،
 * وقد رُدّ الـPDF بـ٤٠٠ حين جُرّب.
 *
 * فيُنتزَع ما في الملفّ من صور. وهذا المسار لا يُستدعى أصلاً إلّا حين
 * يعجز استخراج النصّ — أي أنّ الملفّ مصوَّر، وصورتُه موضوعةٌ فيه كما
 * هي. فالانتزاع يجد ما يبحث عنه في الحالة التي بُني لها بالضبط.
 *
 * وإن لم يجد قال «لم يُقرأ» ولم يُرسل شيئاً — فالكشف الذي لا يُقرأ
 * يُعلَن، ولا تُخترَع له أرصدة.
 */
export function deepseekVision(): VisionProvider {
  const model = modelFor("VISION");
  return {
    name: "deepseek",
    model,
    isConfigured: isDeepseekConfigured,
    async read(pdf: Buffer): Promise<VisionOutcome> {
      const input = await resolveDocumentInput(pdf, "application/pdf");
      if (input.mode !== "IMAGE") {
        return {
          ok: false,
          provider: "deepseek",
          model,
          reason:
            input.mode === "UNREADABLE"
              ? input.reason
              : "الكشف نصّيّ — يُقرأ حسابياً ولا يُرسَل إلى نموذج رؤية",
        };
      }

      const result = await callDeepseek({
        task: "VISION",
        maxTokens: 16000,
        json: true,
        messages: [
          {
            role: "user",
            content: [
              ...input.images.map((img) => ({
                type: "image_url" as const,
                image_url: {
                  url: `data:${img.mimeType};base64,${img.data.toString("base64")}`,
                  detail: detailFor(img),
                },
              })),
              { type: "text" as const, text: buildVisionPrompt() },
            ],
          },
        ],
      });

      if (!result.ok) return { ok: false, provider: "deepseek", model, reason: result.reason };
      return parseOrFail(result.text, "deepseek", model);
    },
  };
}

/**
 * المزوّد المختار — بمتغيّر مستقلّ عن الاستخراج والتحكيم.
 *
 * لأنّها ثلاثة أعمالٍ مختلفة الحساسيّة: قراءةُ فاتورةٍ غير قراءةِ كشفٍ
 * كامل غير الترجيح بين مرشّحين. وربطُها بمتغيّر واحد يجعل تحسين أحدها
 * يُقلق الآخرين.
 */
export function selectedVision(): VisionProvider {
  const raw = (process.env.VISION_PROVIDER ?? "").toLowerCase();
  if (raw === "deepseek") return deepseekVision();
  if (raw === "gemini") return geminiVision();
  if (raw === "claude") return claudeVision();

  /*
    بلا اختيارٍ صريح: ديب سيك.

    وكان الاحتياط جيميني — وهو الذي يعمل في الإنتاج اليوم فعلاً، لأنّ
    `VISION_PROVIDER` غير مضبوط هناك. أي أنّ مسار القراءة البصرية كان
    يقع على جيميني بلا أن يختاره أحد.
  */
  return deepseekVision();
}
