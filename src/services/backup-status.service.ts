/**
 * حالُ النسخة الاحتياطيّة على جهاز المالك — كما أبلغها النصُّ في آخر تشغيل (`job_state` · `backup:local`).
 *
 * النسخةُ تجري على الجهاز لا على الخادم، فلا يعرف التطبيقُ حالَها إلّا بما تكتبه. وبلا صفٍّ «غير معروف»
 * — لا «سليمة». تعذّرت ثلاثةً وعشرين يوماً (٣١ أكتوبر – ٢٢ نوفمبر ٢٠٢٦) ولم يعرف بها أحد.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobState } from "@/db/schema";
import { BACKUP_HEARTBEAT_ROW, backupVerdict, parseHeartbeat, type BackupVerdict } from "@/lib/ops/local-backup";

export async function loadBackupVerdict(now: Date = new Date()): Promise<BackupVerdict> {
  const [row] = await db.select({ fp: jobState.fingerprint }).from(jobState).where(eq(jobState.name, BACKUP_HEARTBEAT_ROW)).limit(1);
  return backupVerdict(parseHeartbeat(row?.fp), now);
}
