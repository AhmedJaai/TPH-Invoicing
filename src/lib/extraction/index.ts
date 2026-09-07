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

export function activeProviderName(): string {
  return selectedProviderName();
}

export function activeProvider() {
  return PROVIDERS[selectedProviderName()];
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
