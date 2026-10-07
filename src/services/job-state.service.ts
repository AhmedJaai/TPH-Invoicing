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

/**
 * عقدٌ زمنيّ على عملٍ لا يجري مرّتين معاً — يُؤخَذ في أوّله ويُرَدّ في آخره.
 *
 * مزامنةُ الدرايف تُطلَق من كلّ جهازٍ بتوقيته: الهاتفُ والحاسوبُ يفتحان معاً فيقرأ كلٌّ
 * منهما الملفّين نفسيهما بالذكاء (نداءٌ مدفوع مرّتين)، ثمّ يردّ القيدُ الفريد الثاني.
 * والعقدُ صفٌّ في `job_state`: يُكتب إن لم يكن، أو إن انقضى عمرُه — في عبارةٍ واحدة،
 * فلا يأخذه اثنان. وانقضاءُ العمر يحرّر عقدَ طلبٍ قتلته المنصّة قبل أن يردّه.
 */
export async function acquireLease(name: string, holder: string, ttlMs: number, conn: Conn = db): Promise<boolean> {
  const { rows } = await conn.execute<{ name: string }>(sql`
    insert into job_state (name, fingerprint, ran_at) values (${name}, ${holder}, now())
    on conflict (name) do update set fingerprint = excluded.fingerprint, ran_at = now()
      where job_state.ran_at < now() - make_interval(secs => ${Math.ceil(ttlMs / 1000)}::int)
    returning name
  `);
  return rows.length > 0;
}

/** يردّه صاحبُه وحده — عقدٌ أخذه طلبٌ آخر بعد انقضاء عمره لا يُمسّ. */
export async function releaseLease(name: string, holder: string, conn: Conn = db): Promise<void> {
  await conn.execute(sql`
    update job_state set ran_at = to_timestamp(0) where name = ${name} and fingerprint = ${holder}
  `);
}
