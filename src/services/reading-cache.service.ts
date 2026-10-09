/**
 * القراءة المحفوظة ببصمة الملفّ — بابٌ واحد للرفع والمزامنة.
 *
 * كان كلُّ مسارٍ يقرأ `extraction_cache` ويكتبه بطريقته: الرفعُ بـ`as` بلا تحقّق
 * (والمخطّط يتطوّر)، والمزوّدُ يُكتب «deepseek» حرفاً ولو قرأ غيرُه، ولا نسخةَ موجِّه
 * — فقراءةٌ بموجِّهٍ قديم تُعاد من الخزين بعد تغييره. فهنا:
 *   - تُفحص القراءةُ بالمخطّط نفسه، وما لا يطابقه يُقرأ من جديد؛
 *   - وما قُرئ بنسخة موجِّهٍ أو مخطّطٍ غير القائمة لا يُعاد؛
 *   - والأدلّة (`evidence.ts`: رمز الفاتورة ومصادر الحقول) تُحفظ مع القراءة.
 */
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { extractionCache } from "@/db/schema";
import { extractionSchema } from "@/lib/extraction/schema";
import { parseEvidence, type ExtractionEvidence } from "@/lib/extraction/evidence";
import { PROMPT_VERSION, SCHEMA_VERSION } from "@/lib/extraction/versions";
import type { ExtractionSuccess, ProviderName } from "@/lib/extraction/provider";

const TEXT_SOURCES = ["TEXT", "PDF_EMBEDDED", "PDF_RENDERED", "DIRECT"] as const;
const PROVIDERS: readonly ProviderName[] = ["deepseek", "claude", "gemini", "ollama"];

/** قراءةٌ حُفظت لهذه البصمة خلال `maxAgeMs` — أو `null` فتُقرأ من جديد. */
export async function loadCachedReading(sha256: string, maxAgeMs: number): Promise<ExtractionSuccess | null> {
  const [row] = await db
    .select({
      extraction: extractionCache.extraction,
      model: extractionCache.model,
      textSource: extractionCache.textSource,
      evidence: extractionCache.evidence,
      promptVersion: extractionCache.promptVersion,
      schemaVersion: extractionCache.schemaVersion,
      provider: extractionCache.provider,
    })
    .from(extractionCache)
    .where(and(eq(extractionCache.sha256, sha256), gt(extractionCache.createdAt, new Date(Date.now() - maxAgeMs))))
    .limit(1);
  if (!row) return null;
  /* قراءةٌ بموجِّهٍ أو مخطّطٍ سابق (أو قبل أن تُحفظ النسخة) لا تُعاد — تُقرأ بالقائم */
  if (row.promptVersion !== PROMPT_VERSION || row.schemaVersion !== SCHEMA_VERSION) return null;
  const parsed = extractionSchema.safeParse(row.extraction);
  if (!parsed.success) return null;
  return {
    ok: true,
    value: parsed.data,
    model: row.model ?? "cache",
    provider: PROVIDERS.find((p) => p === row.provider) ?? "deepseek",
    usage: { inputTokens: 0, outputTokens: 0 },
    textSource: TEXT_SOURCES.find((t) => t === row.textSource),
    evidence: parseEvidence(row.evidence) ?? undefined,
  };
}

export async function saveCachedReading(sha256: string, extraction: ExtractionSuccess, userId: string): Promise<void> {
  const reading = {
    extraction: extraction.value,
    model: extraction.model,
    textSource: extraction.textSource ?? null,
    evidence: extraction.evidence ?? null,
    promptVersion: extraction.evidence?.promptVersion ?? PROMPT_VERSION,
    schemaVersion: extraction.evidence?.schemaVersion ?? SCHEMA_VERSION,
    provider: extraction.provider,
    userId,
  };
  await db.insert(extractionCache).values({ sha256, ...reading })
    .onConflictDoUpdate({ target: extractionCache.sha256, set: { ...reading, createdAt: new Date() } });
}

/** أدلّةُ القراءة المحفوظة لهذه البصمة — للأرشفة ولوح المراجعة. */
export async function cachedEvidence(sha256: string): Promise<ExtractionEvidence | null> {
  const [row] = await db
    .select({ evidence: extractionCache.evidence })
    .from(extractionCache)
    .where(eq(extractionCache.sha256, sha256))
    .limit(1);
  return parseEvidence(row?.evidence);
}
