/**
 * عادةُ يوم الأسبوع من مبيعات فودكس المستورَدة (`lib/sales/weekday-habit.ts`).
 * أسطرُ المنتج وحدها — بلا خيارات الإضافة والملغى والمرتجع — مجموعةً بصنف نقطة البيع.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { lastCompleteWeek, shiftDays } from "@/lib/inventory/week";
import { decimalToMilli } from "@/lib/inventory/units";
import { buildWeekdayHabit, HABIT_WEEKS, type WeekdayHabit } from "@/lib/sales/weekday-habit";

export async function loadWeekdayHabit(): Promise<WeekdayHabit & { windowStart: string; windowEnd: string }> {
  const last = lastCompleteWeek();
  const windowStart = shiftDays(last.start, -7 * (HABIT_WEEKS - 1));
  const rows = (await db.execute<{ day: string; item_id: string; name: string; qty: string }>(sql`
    select s.business_date as day,
           coalesce(l.pos_product_id, 'desc:' || l.description) as item_id,
           coalesce(max(pp.name), max(l.description)) as name,
           sum(l.quantity)::text as qty
      from sale_lines l
      join sales s on s.id = l.sale_id
      left join pos_products pp on pp.id = l.pos_product_id
     where s.is_void = false and l.is_void = false and l.is_refund = false and l.is_modifier = false
       and s.business_date >= ${windowStart} and s.business_date <= ${last.end}
     group by s.business_date, coalesce(l.pos_product_id, 'desc:' || l.description)
  `)).rows;
  const sales = rows.flatMap((r) => {
    const milli = decimalToMilli(r.qty);
    /* كمّيّةٌ لا تُقرأ لا تُعدّ صفراً — تُسقَط من العادة */
    return milli === null ? [] : [{ day: r.day, itemId: r.item_id, itemName: r.name, quantityMilli: milli }];
  });
  return { ...buildWeekdayHabit(sales, last.start), windowStart, windowEnd: last.end };
}
