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
import { and, eq, inArray } from "drizzle-orm";
import { monthCloses } from "@/db/schema";
import { MonthClosedError } from "./validation.service";
import type { Tx } from "./types";

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
