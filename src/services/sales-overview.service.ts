/**
 * لوحةُ المبيعات من القاعدة — ما استُورد من ملفّ فودكس، مجموعاً في SQL.
 * قراءةٌ وحدها، والبناءُ في `lib/sales/overview.ts` الخالصة.
 *
 * الفترةُ تنتهي عند **آخر يومِ عملٍ مستورَد** لا عند اليوم: الملفُّ يُرفع أسبوعيّاً،
 * وفترةٌ تنتهي اليوم تبدأ دائماً بأسبوعٍ «غير مستورَد».
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  COMPARE_WEEKS, buildDailySeries, buildLeakSummary, buildMenuMix, comparable,
  type DailySeries, type ItemSales, type LeakDay, type LeakKind, type LeakSummary, type MenuMix, type SalesDay,
} from "@/lib/sales/overview";
import { isoDay } from "@/lib/riyadh-time";

export const PERIOD_CHOICES = [7, 28, 90] as const;
export type PeriodDays = (typeof PERIOD_CHOICES)[number];

export function parsePeriod(raw: string | undefined): PeriodDays {
  return PERIOD_CHOICES.find((p) => String(p) === raw) ?? 28;
}

export interface SalesOverview {
  /** آخرُ يومِ عملٍ مستورَد — `null`: لا مبيعاتٍ مستورَدة أصلاً. */
  lastDay: string | null;
  firstDay: string | null;
  period: PeriodDays;
  current: DailySeries;
  previous: DailySeries;
  /** الفترتان مكتملتا التغطية — فتُعرض المقارنة. */
  canCompare: boolean;
  menu: MenuMix;
  leaks: LeakSummary;
  /** الملفُّ يحمل الطلبات (لا تقريرَ «مزيج المنتجات» المجمَّع). */
  hasOrders: boolean;
}

function shift(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return isoDay(new Date(Date.UTC(y, m - 1, d + n)));
}

function isLeakKind(v: string): v is LeakKind {
  return v === "VOID" || v === "REFUND" || v === "COMP";
}

async function loadItems(from: string, to: string): Promise<ItemSales[]> {
  const res = await db.execute<{ key: string; name: string; category: string | null; qty: string; sales: string }>(sql`
    select coalesce(pp.id, l.description) as key,
           coalesce(pp.name, l.description) as name,
           max(pp.category) as category,
           (sum(l.quantity) * 1000)::bigint as qty,
           sum(l.line_total_minor)::bigint as sales
      from sale_lines l
      join sales s on s.id = l.sale_id
      left join pos_products pp on pp.id = l.pos_product_id
     where s.business_date >= ${from} and s.business_date <= ${to}
       and s.is_void = false and l.is_modifier = false and l.is_void = false and l.is_refund = false
     group by 1, 2
  `);
  return res.rows.map((r) => ({ key: r.key, name: r.name, category: r.category, quantityMilli: Number(r.qty), salesMinor: Number(r.sales) }));
}

export async function loadSalesOverview(period: PeriodDays): Promise<SalesOverview> {
  const span = (await db.execute<{ first_day: string | null; last_day: string | null }>(sql`
    select min(business_date) as first_day, max(business_date) as last_day from sales
  `)).rows[0];
  const lastDay = span?.last_day ?? null;
  const empty = buildDailySeries([], "2000-01-02", "2000-01-01");
  if (!lastDay) {
    return {
      lastDay: null, firstDay: null, period, current: empty, previous: empty, canCompare: false,
      menu: buildMenuMix([], [], false), leaks: buildLeakSummary([], null, []), hasOrders: false,
    };
  }

  const from = shift(lastDay, -(period - 1));
  const prevTo = shift(from, -1);
  const prevFrom = shift(prevTo, -(period - 1));
  /* عادةُ اليوم تُقرأ من أربعة أسابيع قبله — فتُحمَّل أيّامُها مع الفترتين */
  const loadFrom = shift(prevFrom, -7 * COMPARE_WEEKS);

  const [dayRows, items, prevItems, leakRows] = await Promise.all([
    db.execute<{ day: string; sales: string; vat: string; refunds: string; orders: string }>(sql`
      select business_date as day,
             coalesce(sum(net_minor), 0)::bigint    as sales,
             coalesce(sum(vat_minor), 0)::bigint    as vat,
             coalesce(sum(refund_minor), 0)::bigint as refunds,
             coalesce(sum(order_count), 0)::bigint  as orders
        from sales
       where is_void = false and business_date >= ${loadFrom} and business_date <= ${lastDay}
       group by business_date
    `),
    loadItems(from, lastDay),
    loadItems(prevFrom, prevTo),
    db.execute<{ day: string; kind: string; n: number; qty: string; value: string }>(sql`
      select s.business_date as day,
             case when l.is_void then 'VOID' when l.is_refund then 'REFUND' else 'COMP' end as kind,
             count(*)::int as n,
             (sum(l.quantity) * 1000)::bigint as qty,
             sum(case when l.is_void or l.is_refund then l.line_total_minor
                      else round(l.unit_price_minor * l.quantity) end)::bigint as value
        from sale_lines l
        join sales s on s.id = l.sale_id
       where s.business_date >= ${from} and s.business_date <= ${lastDay}
         and l.is_modifier = false and (l.is_void or l.is_refund or l.is_complimentary)
       group by 1, 2
    `),
  ]);

  const days: SalesDay[] = dayRows.rows.map((r) => ({
    day: r.day, salesMinor: Number(r.sales), vatMinor: Number(r.vat), refundMinor: Number(r.refunds), orders: Number(r.orders),
  }));
  const current = buildDailySeries(days, from, lastDay);
  const previous = buildDailySeries(days, prevFrom, prevTo);
  const canCompare = comparable(current, previous);
  const leaks: LeakDay[] = leakRows.rows.flatMap((r) =>
    isLeakKind(r.kind) ? [{ day: r.day, kind: r.kind, lines: Number(r.n), quantityMilli: Number(r.qty), valueMinor: Number(r.value) }] : [],
  );

  return {
    lastDay,
    firstDay: span?.first_day ?? null,
    period,
    current,
    previous,
    canCompare,
    menu: buildMenuMix(items, prevItems, canCompare),
    leaks: buildLeakSummary(leaks, current.salesMinor, current.rows.flatMap((r) => (r.salesMinor === null ? [] : [r.day]))),
    hasOrders: (current.orders ?? 0) > 0,
  };
}
