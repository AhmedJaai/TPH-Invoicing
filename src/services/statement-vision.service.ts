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

export type VisionProviderName = "deepseek";

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
 * المزوّد المختار — DeepSeek وحده.
 *
 * كان `VISION_PROVIDER` يختار بين جيميني وكلود وديب سيك، وكان الاحتياط
 * جيميني يعمل في الإنتاج بلا أن يختاره أحد. والقرار «ولا احتياط»: فحُذف
 * المزوّدان الآخران، ولا متغيّر يُقرأ.
 */
export function selectedVision(): VisionProvider {
  return deepseekVision();
}
