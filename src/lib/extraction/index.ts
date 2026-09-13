/** نقطة الدخول الوحيدة للاستخراج — تختار المزوّد من متغيّرات البيئة. */
import { claudeProvider } from "./extract";
import { deepseekExtractionProvider } from "./provider-deepseek";
import { geminiProvider } from "./provider-gemini";
import { ollamaProvider } from "./provider-ollama";
import { selectedProviderName, type ExtractionOutcome, type ExtractionRequest } from "./provider";
import { deriveAmounts } from "./validate-extraction";

export { isSupportedUpload } from "./extract";
export type { ExtractionOutcome, ExtractionRequest } from "./provider";

const PROVIDERS = {
  deepseek: deepseekExtractionProvider,
  claude: claudeProvider,
  gemini: geminiProvider,
  ollama: ollamaProvider,
} as const;

/**
 * المزوّد الفعليّ — DeepSeek ما لم يُطلب غيره صراحةً.
 *
 * جيميني وOllama خاملان في الشيفرة. وكان متغيّرٌ قديمٌ واحد في Vercel
 * (`EXTRACTION_PROVIDER=gemini`) يكفي لإرسال فواتير المقهى كاملةً إلى طبقةٍ
 * مجانية تتدرّب عليها ويراجعها بشر — بلا إعلان. فصار البديل يحتاج إقراراً
 * ثانياً صريحاً، ويُسجَّل حين يُختار.
 */
function effectiveProviderName(): keyof typeof PROVIDERS {
  const name = selectedProviderName();
  if (name === "deepseek") return name;
  if (process.env.EXTRACTION_ALLOW_ALT_PROVIDER === "true") {
    console.warn(`extraction: المزوّد البديل «${name}» مُفعَّل بإقرارٍ صريح`);
    return name;
  }
  console.warn(`extraction: EXTRACTION_PROVIDER=${name} بلا EXTRACTION_ALLOW_ALT_PROVIDER=true — يُستعمل deepseek`);
  return "deepseek";
}

export function activeProviderName(): string {
  return effectiveProviderName();
}

export function activeProvider() {
  return PROVIDERS[effectiveProviderName()];
}

export async function extractDocument(request: ExtractionRequest): Promise<ExtractionOutcome> {
  const outcome = await activeProvider().extract(request);

  /*
    الاشتقاق الحسابيّ هنا — بعد المزوّد وقبل ما سواه.

    فيسري على المزوّدين كلّهم بقاعدةٍ واحدة، ولا يُترَك لكلّ واحدٍ أن
    يجتهد فيه. والنموذج يُطلَب منه النقل، والحسابُ شأنُ الشيفرة.
  */
  if (!outcome.ok) return outcome;
  return { ...outcome, value: deriveAmounts(outcome.value) };
}
