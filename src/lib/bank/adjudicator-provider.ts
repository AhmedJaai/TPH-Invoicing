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
import { PINNED_MODELS } from "@/lib/extraction/versions";

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

export type AdjudicatorName = "gemini" | "claude" | "deepseek" | "qwen";

/** مخطّط المخرَج — واحدٌ لكل المزوّدين كي تُقارَن أحكامهم. */
const JSON_SHAPE = {
  type: "OBJECT",
  properties: {
    choice: { type: "STRING" },
    reasonCodes: { type: "ARRAY", items: { type: "STRING" } },
    confidence: { type: "NUMBER" },
    reason: { type: "STRING" },
  },
  required: ["choice", "reasonCodes", "confidence"],
};

function parseVerdict(text: string): Verdict {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  const parsed = verdictSchema.safeParse(JSON.parse(cleaned));
  if (!parsed.success) throw new Error("مخرَجٌ لا يطابق المخطّط");
  return parsed.data;
}

/* ─────────────────────── جيميني ─────────────────────── */

export function geminiProvider(): AdjudicatorProvider {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.ADJUDICATOR_MODEL ?? PINNED_MODELS.gemini;

  return {
    name: "gemini",
    model,
    isConfigured: () => Boolean(key),
    async judge(prompt) {
      const started = Date.now();
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key ?? "" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0,
              responseMimeType: "application/json",
              responseSchema: JSON_SHAPE,
            },
          }),
        },
      );
      if (!res.ok) throw new Error(`جيميني ردّ ${res.status}`);
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      return {
        verdict: parseVerdict(data.candidates?.[0]?.content?.parts?.[0]?.text ?? ""),
        durationMs: Date.now() - started,
      };
    },
  };
}

/* ─────────────────────── كلود ─────────────────────── */

export function claudeProvider(): AdjudicatorProvider {
  const key = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ADJUDICATOR_MODEL ?? PINNED_MODELS.claude;

  return {
    name: "claude",
    model,
    isConfigured: () => Boolean(key),
    async judge(prompt) {
      const started = Date.now();
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key ?? "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 512,
          temperature: 0,
          messages: [{ role: "user", content: `${prompt}\n\nأجب بـJSON وحده.` }],
        }),
      });
      if (!res.ok) throw new Error(`كلود ردّ ${res.status}`);
      const data = (await res.json()) as { content?: { text?: string }[] };
      return {
        verdict: parseVerdict(data.content?.[0]?.text ?? ""),
        durationMs: Date.now() - started,
      };
    },
  };
}

/* ─────────── ما يتكلّم لغة OpenAI: ديب سيك وكوين ─────────── */

/**
 * مزوّدٌ متوافق مع واجهة OpenAI.
 *
 * وديب سيك وكوين وغيرهما يتكلّمونها، فلا حاجة إلى حزمةٍ لكلٍّ منهم:
 * طلبُ HTTP يكفي. وإضافة حزمةٍ لكل مزوّد تُثقل المشروع بلا مقابل.
 */
function openAiCompatible(
  name: string,
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
): AdjudicatorProvider {
  return {
    name,
    model,
    isConfigured: () => Boolean(apiKey),
    async judge(prompt) {
      const started = Date.now();
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey ?? ""}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: `${prompt}\n\nأجب بـJSON وحده.` }],
        }),
      });
      if (!res.ok) throw new Error(`${name} ردّ ${res.status}`);
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      return {
        verdict: parseVerdict(data.choices?.[0]?.message?.content ?? ""),
        durationMs: Date.now() - started,
      };
    },
  };
}

export function deepseekProvider(): AdjudicatorProvider {
  return openAiCompatible(
    "deepseek",
    process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
    process.env.DEEPSEEK_API_KEY,
    process.env.ADJUDICATOR_MODEL ?? "deepseek-chat",
  );
}

export function qwenProvider(): AdjudicatorProvider {
  return openAiCompatible(
    "qwen",
    process.env.QWEN_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
    process.env.QWEN_API_KEY,
    process.env.ADJUDICATOR_MODEL ?? "qwen-max",
  );
}

const PROVIDERS: Record<AdjudicatorName, () => AdjudicatorProvider> = {
  gemini: geminiProvider,
  claude: claudeProvider,
  deepseek: deepseekProvider,
  qwen: qwenProvider,
};

/**
 * المزوّد المختار.
 *
 * `ADJUDICATOR_PROVIDER` منفصلٌ عن `EXTRACTION_PROVIDER` عمداً: قد
 * يُراد نموذجُ رؤيةٍ رخيصٌ للاستخراج ونموذجُ استدلالٍ قويّ للتحكيم.
 */
export function selectedAdjudicator(): AdjudicatorProvider {
  const raw = (process.env.ADJUDICATOR_PROVIDER ?? "gemini").toLowerCase();
  const make = PROVIDERS[raw as AdjudicatorName] ?? PROVIDERS.gemini;
  return make();
}

export function adjudicatorNames(): AdjudicatorName[] {
  return Object.keys(PROVIDERS) as AdjudicatorName[];
}
