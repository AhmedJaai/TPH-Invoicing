/**
 * «أتغيّر شيءٌ منذ آخر مرّة؟» — قبل أن يُعاد عملٌ خلفيٌّ ثقيل (053).
 *
 * الاستدراكُ يجري عند فتح الصفحات كلَّ عشر دقائق لكلّ جهاز. وأكثرُ مرّاته لا جديد
 * فيها: يقرأ القراءاتِ والحركاتِ كلَّها ويفتح معاملةً لكلّ مورّدٍ له رصيد، فيُبقي
 * القاعدة مستيقظةً وينقل ما لا حاجة إليه. فتُحسب بصمةٌ رخيصة لِما يعمل عليه —
 * ولا يُعاد ما لم تتغيّر، إلّا بعد حدٍّ من الوقت: فللسياسات أيّامُها (نافذةُ
 * الخصم سبعة أيّام) وتتقدّم ولو لم يتغيّر صفّ.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobState } from "@/db/schema";
import type { Conn } from "./types";

/** ما يعمل عليه الاستدراك: المستنداتُ والفواتيرُ والدفعاتُ والتخصيصاتُ والكشفُ وقراراتُه. */
export async function backlogFingerprint(conn: Conn = db): Promise<string> {
  const [r] = (await conn.execute<{ fp: string }>(sql`
    select concat_ws('|',
      (select max(updated_at) from documents), (select count(*) from documents),
      (select max(updated_at) from invoices), (select count(*) from invoices),
      (select max(greatest(created_at, coalesce(voided_at, created_at), coalesce(reversed_at, created_at))) from payments),
      (select count(*) from payments),
      (select count(*) || ':' || coalesce(sum(amount_minor), 0) from payment_allocations),
      (select max(created_at) from bank_imports),
      (select max(created_at) from decision_history),
      (select count(*) from statements)
    ) as fp
  `)).rows;
  return r.fp;
}

/** يُعاد العملُ إن تغيّرت البصمة، أو مضى `maxAgeMs` منذ آخر تشغيل. */
export async function isDue(name: string, fingerprint: string, maxAgeMs: number, conn: Conn = db): Promise<boolean> {
  const [row] = await conn.select().from(jobState).where(eq(jobState.name, name)).limit(1);
  if (!row) return true;
  return row.fingerprint !== fingerprint || Date.now() - row.ranAt.getTime() >= maxAgeMs;
}

/** يُسجَّل بعد التشغيل — ببصمة ما بعده، فما كتبه العملُ نفسُه لا يُعدّ تغييراً. */
export async function markRan(name: string, fingerprint: string, conn: Conn = db): Promise<void> {
  await conn.insert(jobState).values({ name, fingerprint, ranAt: new Date() })
    .onConflictDoUpdate({ target: jobState.name, set: { fingerprint, ranAt: new Date() } });
}
