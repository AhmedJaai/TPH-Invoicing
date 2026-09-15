/**
 * الشهر المقفل لا يُكتب فيه — من أيّ باب.
 *
 * كان `assertMonthOpen` يُستدعى في الأرشفة وحدها. فمن أقفل أغسطس ثمّ
 * قيّد حوالةً من الكشف، أو سجّل سداد فاتورة، أو زامن الدرايف، كتب في
 * الشهر المقفل بلا اعتراض — والإقفال شهادة. فصار الحارس في طبقة
 * الخدمات التي يمرّ بها كلّ مسار: إنشاء الدفعة، والتخصيص، والفاتورة.
 * وفي القاعدة مؤثِّرٌ يرفض الشيء نفسه (الهجرة ٠٢٨)، فالحارس مزدوج.
 *
 * ويُقرأ بمقبض المعاملة: قراءةٌ بـ`db` من داخل معاملة تنتظر اتّصالاً
 * محجوزاً على Vercel.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { db } from "@/db";
import { monthCloses } from "@/db/schema";
import { MonthClosedError } from "./validation.service";
import type { Tx } from "./types";

/**
 * أوّلُ شهرٍ مقفل من القائمة، أو `null` — قراءةٌ بلا رمي.
 *
 * لمن يسأل **قبل** عملٍ مكلف: المزامنة تقرأ الملفّ بالذكاء ثمّ تكتب،
 * فإن كان شهرُه مقفلاً رُدّت الكتابة وضاع ثمنُ القراءة. فتسأل هنا عند
 * الباب، ويبقى `assertMonthsOpen` في الخدمة حارساً ثانياً وقت الكتابة.
 */
export async function firstClosedMonth(
  executor: typeof db | Tx,
  months: readonly (string | null | undefined)[],
): Promise<string | null> {
  const list = [...new Set(months.filter((m): m is string => Boolean(m)))];
  if (list.length === 0) return null;
  const { rows } = await executor.execute<{ month: string }>(sql`
    select month from month_closes
     where status = 'CLOSED' and month in (${sql.join(list.map((m) => sql`${m}`), sql`, `)})
     order by month limit 1
  `);
  return rows[0]?.month ?? null;
}

export async function assertMonthsOpen(
  tx: Tx,
  months: readonly (string | null | undefined)[],
): Promise<void> {
  const list = [...new Set(months.filter((m): m is string => Boolean(m)))];
  if (list.length === 0) return;
  const [row] = await tx
    .select({ month: monthCloses.month })
    .from(monthCloses)
    .where(and(inArray(monthCloses.month, list), eq(monthCloses.status, "CLOSED")))
    .limit(1);
  if (row) throw new MonthClosedError(row.month);
}
