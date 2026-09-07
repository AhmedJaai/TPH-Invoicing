/** نقطة الدخول الوحيدة للاستخراج — تختار المزوّد من متغيّرات البيئة. */
import { claudeProvider } from "./extract";
import { deepseekExtractionProvider } from "./provider-deepseek";
import { geminiProvider } from "./provider-gemini";
import { ollamaProvider } from "./provider-ollama";
import { selectedProviderName, type ExtractionOutcome, type ExtractionRequest } from "./provider";

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
  return activeProvider().extract(request);
}
