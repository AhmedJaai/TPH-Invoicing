/**
 * الحَكَم محايدٌ عن المزوّد.
 *
 * كان مربوطاً بجيميني مباشرةً — يتجاوز تجريد المزوّد الذي بُني
 * للاستخراج. فالاستخراج محايد والتحكيم ليس كذلك، وهو تناقضٌ في
 * المعمارية لا مجرّد اختصار.
 *
 * وهذا ليس تفضيلاً لنموذجٍ على آخر: المهمّتان مختلفتان. الاستخراج
 * **رؤية** — يقرأ صورةً ويستخرج حقولاً. والتحكيم **استدلال** — يوازن
 * بين معلوماتٍ نصّية. وأفضلُ نموذجٍ في إحداهما ليس بالضرورة أفضلَه في
 * الأخرى.
 */
import { z } from "zod";
import { callDeepseek, parseJsonLoose } from "@/lib/ai/deepseek";
import { isDeepseekConfigured, modelFor } from "@/lib/ai/models";

export const verdictSchema = z.object({
  choice: z.string(),
  reasonCodes: z.array(z.string()).default([]),
  confidence: z.number(),
  reason: z.string().default(""),
});

export type Verdict = z.infer<typeof verdictSchema>;

export interface JudgeResult {
  verdict: Verdict;
  durationMs: number;
}

export interface AdjudicatorProvider {
  name: string;
  model: string;
  isConfigured(): boolean;
  judge(prompt: string): Promise<JudgeResult>;
}

/**
 * الحَكَم — DeepSeek.
 *
 * ولا يمرّ بـ`openAiCompatible` رغم أنّه يتكلّم لغتها. السبب أنّ تلك
 * تنادي `fetch` عارياً: بلا مهلة، وبلا إعادة محاولة، وبلا تمييزٍ بين
 * «الرصيد نفد» و«الخادم تحت ضغط». والتحكيم يقع داخل استيراد كشفٍ
 * بنكيّ — أي في مسارٍ ماليّ طويل، ونداءٌ فيه بلا مهلة يعلّق الطلب حتى
 * يقتله المزوّد فيردّ صفحةً نصّية تنفجر في الشاشة.
 *
 * فيمرّ بـ`callDeepseek`: مهلةٌ معلَنة، وإعادةٌ على العابر وحده، وعطبٌ
 * مصنَّف. وهي الطبقة نفسها التي يمرّ بها الاستخراج — فمزوّدٌ واحد
 * بسلوكٍ واحد، لا سلوكان في مسارين.
 *
 * وكان الافتراضي المكتوب هنا `deepseek-chat` — ولا وجود له في حساب
 * أحمد أصلاً: الحساب يعرض ثلاثة نماذج ليس فيها. سلسلةٌ حرفيّة كُتبت
 * مرّةً ولم يعد أحدٌ يسأل أصحيحةٌ هي، وهي بالضبط ما يمنعه `ai/models.ts`.
 */
export function deepseekProvider(): AdjudicatorProvider {
  const model = process.env.ADJUDICATOR_MODEL || modelFor("REASONING");
  return {
    name: "deepseek",
    model,
    isConfigured: isDeepseekConfigured,
    async judge(prompt) {
      /*
        شكلُ الجواب يُطلَب هنا لا يُترَك للمستدعي.

        جيميني كان يفرضه بـ`responseSchema`، وDeepSeek لا يفرض شيئاً.
        وجُرِّب بلا وصفٍ للشكل فاختار المرشّح **الصحيح** وأجاب
        `{"answer":"a"}` — حكمٌ سليم في غلافٍ لا يقرؤه المخطّط، فسقط
        كأنّه فشل. والخسارة هنا مضاعفة: كلفةُ نداءٍ صحيح، ثمّ حركةٌ
        تُرفَع إلى مراجعةٍ بشرية بلا حاجة.

        فالوصف في المزوّد نفسه: كلّ مستدعٍ يرث الصحّة، ولا يُنتظَر من
        كلّ واحدٍ أن يتذكّر.
      */
      const shape =
        'أجب بكائن JSON واحد بهذا الشكل حرفياً وبلا أيّ نصّ آخر:\n' +
        '{"choice": "معرّف المرشّح أو NONE", "reasonCodes": ["رموز الأدلّة"], ' +
        '"confidence": 0.0, "reason": "سببٌ بجملة قصيرة"}';

      const result = await callDeepseek({
        task: "REASONING",
        maxTokens: 2000,
        json: true,
        messages: [{ role: "user", content: `${prompt}\n\n${shape}` }],
      });
      if (!result.ok) throw new Error(result.reason);

      const parsed = parseJsonLoose(result.text);
      if (!parsed.ok) throw new Error("مخرَج الحَكَم ليس JSON");

      const verdict = verdictSchema.safeParse(parsed.value);
      if (!verdict.success) throw new Error("مخرَجٌ لا يطابق المخطّط");

      return { verdict: verdict.data, durationMs: result.durationMs };
    },
  };
}

/**
 * المزوّد المختار — DeepSeek وحده.
 *
 * كان هنا أربعة مزوّدين (جيميني وكلود وكوين وديب سيك) يُختار بينهم بـ
 * `ADJUDICATOR_PROVIDER`، وثلاثة عشر اختباراً تُخضّر الثلاثة الذين لا
 * يُستدعَون. ومن يقرأ الشيفرة يظنّ الحَكَم متعدّد المزوّدين وله احتياط،
 * والقرار «DeepSeek وحده، ولا احتياط». فحُذفوا، والدالّة باقيةٌ نقطةً
 * واحدة يستدعيها الاستيراد.
 */
export function selectedAdjudicator(): AdjudicatorProvider {
  return deepseekProvider();
}
