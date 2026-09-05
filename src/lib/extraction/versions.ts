/**
 * نسخة الاستخراج — أثرٌ لا يُنسى.
 *
 * كان يُحفَظ اسم النموذج وحده. فإذا اختلفت دقّة القراءة بين شهر وشهر
 * لم يُعرف السبب: أتغيّر الموجِّه؟ أم المخطّط؟ أم النموذج نفسه تحت
 * اسمٍ عائم؟
 *
 * وأخطر ما كان: `gemini-flash-latest` اسمٌ **عائم** في مسار حرج —
 * يتغيّر النموذج تحته بلا إشعار، فتتغيّر أرقام الفواتير ولا يُعلَم.
 */

/**
 * تُرفَع مع كل تغيير في نصّ الموجِّه.
 *
 * والرفع ليس تجميلاً: قراءتان بموجِّهين مختلفين لا تُقارَنان، ومن يرى
 * انحداراً في الدقّة يحتاج أن يعرف متى تغيّر ما.
 */
export const PROMPT_VERSION = "2026-09-05.1";

/** تُرفَع مع كل تغيير في شكل المخرَج المطلوب. */
export const SCHEMA_VERSION = "2026-09-05.1";

/**
 * النماذج المثبَّتة.
 *
 * لا اسم عائم في مسار حرج. و«الأحدث» ليس وصفاً لنموذج بل وعدٌ متغيّر.
 */
export const PINNED_MODELS = {
  claude: "claude-opus-5",
  /*
    مثبَّتٌ بنسخته. وكان `gemini-flash-latest` — يتغيّر تحته النموذج
    بلا إشعار في مسارٍ يقرأ أرقام فواتير.
  */
  gemini: "gemini-2.5-flash",
  ollama: "qwen2.5vl:7b",
} as const;

export interface ExtractionProvenance {
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  /** كم استغرق الطلب — أساس المقارنة بين المزوّدين. */
  durationMs: number;
  /** ما استُهلك، إن أخبر المزوّد. */
  inputTokens?: number;
  outputTokens?: number;
  at: string;
}

export function provenance(
  provider: string,
  model: string,
  durationMs: number,
  usage?: { inputTokens?: number; outputTokens?: number },
): ExtractionProvenance {
  return {
    provider,
    model,
    promptVersion: PROMPT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    durationMs,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    at: new Date().toISOString(),
  };
}
