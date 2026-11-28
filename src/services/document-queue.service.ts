import { desc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";

/** ما لم يُبتّ فيه — «ينتظر المراجعة» بأحواله الثلاث، كلسان المستندات وعدّاد الشريط. */
export const WAITING_STATUSES = ["PENDING", "EXTRACTED", "NEEDS_REVIEW"] as const;

export interface WaitingQueuePlace {
  /** ترتيبُه بين ما ينتظر (من ١)، أو `null` إن لم يعد ينتظر. */
  position: number | null;
  total: number;
  prevId: string | null;
  /** التالي: بعده في الطابور، أو أوّلُ ما ينتظر إن خرج هو منه للتوّ. */
  nextId: string | null;
}

/**
 * موضعُ المستند في طابور «ينتظر المراجعة» — بترتيب قائمة المستندات نفسه
 * (الشهر ثمّ الوصول، الأحدث أوّلاً)، فالتالي في الملفّ هو التالي في القائمة.
 *
 * كان الحسمُ في الملفّ ينتهي بتحديث الصفحة نفسها: «اعتُمد» ثمّ لا شيء، ومن
 * يراجع عشرةً يعود إلى القائمة عشر مرّات. فالملفُّ يعرف تاليه ويذهب إليه.
 */
export async function loadWaitingQueue(documentId: string, lastActionAt: Date | null = null): Promise<WaitingQueuePlace & { justDecided: boolean }> {
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(inArray(documents.status, [...WAITING_STATUSES]))
    .orderBy(desc(documents.periodMonth), desc(documents.uploadedAt))
    .limit(1000);
  /* حُسم قبل دقائق (آخرُ إجراءٍ عليه): يُعرض شريطُ الطابور ليمضي من حسمه إلى التالي */
  const justDecided = lastActionAt !== null && Date.now() - new Date(lastActionAt).getTime() < 15 * 60_000;
  return { ...placeIn(rows.map((r) => r.id), documentId), justDecided };
}

/** خالصة — تُختبَر بلا قاعدة. */
export function placeIn(ids: readonly string[], documentId: string): WaitingQueuePlace {
  const at = ids.indexOf(documentId);
  if (at === -1) return { position: null, total: ids.length, prevId: null, nextId: ids[0] ?? null };
  return {
    position: at + 1,
    total: ids.length,
    prevId: at > 0 ? ids[at - 1] : null,
    nextId: at + 1 < ids.length ? ids[at + 1] : null,
  };
}
