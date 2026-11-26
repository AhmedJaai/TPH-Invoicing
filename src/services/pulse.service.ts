/**
 * نبضُ المقهى من مرآة فودكس (`foodics_orders`) — قراءةٌ لا كتابة، والمالُ ما دفعه الزبائن
 * (مشروباتُ الموظفين خارجه: `method_type = 5`) كما تحسبه «المبيعات» (`sales-analysis.service.ts`).
 * والطلبُ المعدود ما دُفع فيه شيء — مشروبُ موظّفٍ أو طلبٌ مخصومٌ كلُّه ليس «طلباً» بمتوسط صفر.
 */
import { cache } from "react";
import { decimalToMilli } from "@/lib/inventory/units";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { buildPulse, businessDayOf, type HourSales, type PulseView } from "@/lib/pulse";
import { addDays, hourInRiyadh, todayInRiyadh } from "@/lib/riyadh-time";
import type { Conn } from "./types";

/* يومُ اللحظة نفسها بتوقيت الرياض — لا ساعةُ الخادم */

export async function loadPulse(now = new Date(), conn: Conn = db): Promise<PulseView | null> {
  const hour = hourInRiyadh(now);
  const day = businessDayOf(todayInRiyadh(now), hour, addDays);
  const weekAgo = addDays(day, -7);
  const yesterday = addDays(day, -1);
  const sameDays = [8, 15, 22, 29].map((n) => addDays(day, -n));
  const nowWeekAgo = new Date(now.getTime() - 7 * 86_400_000);

  const hourly = (d: string, until: Date | null) => conn.execute<{ hour: number; paid: string; orders: number }>(sql`
    select extract(hour from o.opened_at at time zone 'Asia/Riyadh')::int as hour,
           coalesce(sum(p.amount_minor) filter (where p.method_type <> 5), 0)::bigint as paid,
           count(distinct o.id) filter (where o.status = 4 and p.method_type <> 5 and p.amount_minor > 0)::int as orders
      from foodics_orders o join foodics_order_payments p on p.order_id = o.id
     where o.status in (4, 5) and o.business_date = ${d} and o.opened_at is not null
       ${until ? sql`and o.opened_at <= ${until.toISOString()}` : sql``}
     group by 1
  `);
  const [today, lastWeek, lastWeekToNow, days, sync, top] = await Promise.all([
    hourly(day, now),
    hourly(weekAgo, null),
    hourly(weekAgo, nowWeekAgo),
    conn.execute<{ day: string; paid: string; orders: number }>(sql`
      select o.business_date as day,
             coalesce(sum(p.amount_minor) filter (where p.method_type <> 5), 0)::bigint as paid,
             count(distinct o.id) filter (where o.status = 4 and p.method_type <> 5 and p.amount_minor > 0)::int as orders
        from foodics_orders o join foodics_order_payments p on p.order_id = o.id
       where o.status in (4, 5) and o.business_date in (${sql.join([yesterday, ...sameDays].map((d) => sql`${d}`), sql`, `)})
       group by 1
    `),
    conn.execute<{ at: string | null }>(sql`
      select max(finished_at)::text as at from foodics_sync_runs where status in ('OK', 'SUCCESS', 'DONE', 'ok', 'success')
    `),
    /* ما يُطلب اليوم — سطورُ البيع نفسُها التي يقرؤها الجرد، بلا إضافاتٍ ولا مرتجعٍ ولا ملغى ولا ضيافة */
    conn.execute<{ name: string; qty: string }>(sql`
      select min(sl.description) as name, sum(sl.quantity)::text as qty
        from sale_lines sl join sales s on s.id = sl.sale_id
       where s.business_date = ${day} and not sl.is_modifier and not sl.is_refund
         and not sl.is_void and not s.is_void and not sl.is_complimentary
       group by coalesce(sl.pos_product_id::text, sl.description)
       order by sum(sl.quantity) desc limit 3
    `),
  ]);
  const rows = (r: { rows: { hour: number; paid: string; orders: number }[] }): HourSales[] =>
    r.rows.map((x) => ({ hour: Number(x.hour), paidMinor: Number(x.paid), orders: Number(x.orders) }));
  const byDay = new Map(days.rows.map((d) => [d.day, { paidMinor: Number(d.paid), orders: Number(d.orders) }]));
  const usual = sameDays.map((d) => byDay.get(d)?.paidMinor).filter((v): v is number => v !== undefined && v > 0);
  const todayRows = rows(today);
  const weekRows = rows(lastWeek);
  /* لا مبيعاتٍ في المرآة اليومَ ولا قبل أسبوع: فودكس غيرُ موصول أو لم يُزامَن — لا يُعرض «صفر» */
  if (todayRows.length === 0 && weekRows.length === 0 && !byDay.has(yesterday)) return null;
  const toNow = rows(lastWeekToNow);
  return buildPulse({
    businessDay: day, nowHour: hour,
    today: todayRows, lastWeek: weekRows,
    lastWeekToNow: weekRows.length === 0 ? null : { paidMinor: toNow.reduce((s, h) => s + h.paidMinor, 0), orders: toNow.reduce((s, h) => s + h.orders, 0) },
    yesterday: byDay.get(yesterday) ?? null,
    yesterdayDay: yesterday,
    yesterdayUsualMinor: usual.length === 0 ? null : Math.round(usual.reduce((a, b) => a + b, 0) / usual.length),
    syncedAt: sync.rows[0]?.at ? new Date(sync.rows[0].at).toISOString() : null,
    topItems: top.rows.flatMap((r) => {
      const quantityMilli = decimalToMilli(r.qty);
      return quantityMilli === null ? [] : [{ name: r.name, quantityMilli }];
    }),
  });
}

/** مرّةً لكلّ طلب صفحة — الجملةُ أعلى الرئيسيّة ولوحةُ النبض تقرآن الأرقامَ نفسها. */
export const loadPulseOnce = cache(() => loadPulse());
