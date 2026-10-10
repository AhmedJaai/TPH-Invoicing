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
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, extractionCache } from "@/db/schema";
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

/** كم يوماً تبقى قراءةٌ بلا مستند — الرفعُ يُؤرشَف في دقائق، والمزامنةُ تقيّد مستندَها فوراً. */
export const ORPHAN_READING_DAYS = 30;

/**
 * يحذف قراءاتٍ لا مستندَ لها مضى عليها شهر. **لا يُستدعى من نفسه**: الحذفُ الآليّ ينتظر
 * إذنَ أحمد (٩ أكتوبر ٢٠٢٦) — كان يُشغَّل مصادفةً بعد كلّ حفظ.
 *
 * كلُّ قراءةٍ تُحفظ ببصمة ملفّها (المحتوى المستخرَج كاملاً) ولم يكن شيءٌ يحذفها: ملفٌّ
 * رُفع ولم يُؤرشَف — أو رُفع خطأً: صورةٌ شخصيّة، هويّة — تبقى قراءتُه في القاعدة بلا
 * مستند. **وما له مستندٌ بأيّ حال (ولو مرفوضاً) لا يُمسّ**: أدلّتُه تُقرأ من هنا.
 * وهذا خزينُ قراءةٍ لا مال: ما حُذف يُقرأ من ملفّه من جديد. بدفعاتٍ لا دفعةً واحدة.
 */
export async function pruneOrphanReadings(days: number = ORPHAN_READING_DAYS, batch = 500): Promise<number> {
  const result = await db.execute<{ sha256: string }>(sql`
    delete from ${extractionCache}
     where ${extractionCache}.sha256 in (
       select c.sha256 from ${extractionCache} c
        where c.created_at < now() - make_interval(days => ${days})
          and not exists (select 1 from ${documents} d where d.sha256 = c.sha256)
        limit ${batch}
     )
    returning sha256
  `);
  return result.rows.length;
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
