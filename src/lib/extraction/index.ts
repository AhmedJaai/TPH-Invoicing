/** نقطة الدخول الوحيدة للاستخراج — تختار المزوّد من متغيّرات البيئة. */
import { claudeProvider } from "./extract";
import { ollamaProvider } from "./provider-ollama";
import { selectedProviderName, type ExtractionOutcome, type ExtractionRequest } from "./provider";

export { isSupportedUpload } from "./extract";
export type { ExtractionOutcome, ExtractionRequest } from "./provider";

const PROVIDERS = { claude: claudeProvider, ollama: ollamaProvider } as const;

export function activeProvider() {
  return PROVIDERS[selectedProviderName()];
}

export async function extractDocument(request: ExtractionRequest): Promise<ExtractionOutcome> {
  return activeProvider().extract(request);
}
