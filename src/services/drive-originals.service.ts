/**
 * أأصولُ المستندات ما زالت في الدرايف؟ — فحصُ الصباح، قراءةٌ محضة.
 *
 * وُجد بتدقيقٍ يدويّ (٢٥ نوفمبر ٢٠٢٦، `ops:truth`): ثمانيةُ قيودٍ يقول الدرايف إنّ أصولَها غيرُ موجودة
 * (٤٠٤) — حُذفت أو لم تعد مشارَكة — والقيدُ في الدفاتر بلا ورقة. والمحاسبُ والهيئةُ يطلبان الورقة.
 * فصار فحصاً يجري كلَّ صباح ويُقال في «يحتاج قرارك» بأسمائها، قبل أن يُطلب أصلٌ لا يوجد.
 *
 * لا يكتب في الدرايف شيئاً (`probeFile` قراءةٌ وحدها)، والمجهولُ (عطلٌ مؤقّت) لا يُعدّ غياباً.
 */
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, documents } from "@/db/schema";
import { probeFile } from "@/lib/drive";
import type { drive_v3 } from "googleapis";
import type { Conn } from "./types";

const KEY = "drive-originals-check";
/** نداءاتٌ متوازية — خمسُمئة ملفٍّ في ثوانٍ، ودون حدّ المزوّد. */
const PARALLEL = 12;

export interface MissingOriginal { documentId: string; fileName: string; state: "gone" | "trashed" }
export interface OriginalsCheck { checkedAt: string; checked: number; unknown: number; missing: MissingOriginal[] }

export async function checkDriveOriginals(drive: drive_v3.Drive, conn: Conn = db): Promise<OriginalsCheck> {
  const docs = await conn.select({ id: documents.id, fileId: documents.driveFileId, name: documents.fileName })
    /* المرفوضُ ليس في الدفاتر — غيابُ ملفّه لا يطلبه أحد (الثمانيةُ التي وُجدت أوّلاً كلُّها مرفوضة) */
    .from(documents).where(and(isNotNull(documents.driveFileId), ne(documents.status, "REJECTED")));
  const missing: MissingOriginal[] = [];
  let unknown = 0;
  for (let i = 0; i < docs.length; i += PARALLEL) {
    const slice = docs.slice(i, i + PARALLEL);
    const states = await Promise.all(slice.map((d) => probeFile(drive, d.fileId!)));
    states.forEach((s, k) => {
      if (s.state === "gone" || s.state === "trashed") missing.push({ documentId: slice[k].id, fileName: slice[k].name, state: s.state });
      else if (s.state === "unknown") unknown++;
    });
  }
  const result: OriginalsCheck = { checkedAt: new Date().toISOString(), checked: docs.length, unknown, missing };
  await conn.insert(appSettings).values({ key: KEY, value: JSON.stringify(result) })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(result), updatedAt: new Date() } });
  return result;
}

/** آخرُ ما وجده الفحص — `null` لم يجرِ بعد. */
export async function loadOriginalsCheck(conn: Conn = db): Promise<OriginalsCheck | null> {
  const [row] = await conn.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
  if (!row) return null;
  try {
    const v = JSON.parse(row.value) as OriginalsCheck;
    return Array.isArray(v.missing) ? v : null;
  } catch {
    return null;
  }
}
