/**
 * أيّامُ النقد الباقية من القاعدة — الرصيدُ من `loadCashPosition` (المصدرُ نفسُه للرئيسية
 * والنقد القادم)، والصادرُ من كشف البنك في الستّين يوماً المنتهية بيوم الرصيد.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { buildRunway, RUNWAY_WINDOW_DAYS, type Runway } from "@/lib/cash-runway";
import { todayInRiyadh } from "@/lib/riyadh-time";
import { loadCashPosition } from "./briefing.service";

export async function loadRunway(): Promise<Runway> {
  const cash = await loadCashPosition();
  const today = todayInRiyadh();
  const asOf = cash.asOf === null ? null : String(cash.asOf).slice(0, 10);
  if (cash.balanceMinor === null || asOf === null) {
    return buildRunway({ balanceMinor: null, balanceAsOf: null, today, outflowMinor: 0, firstDay: null });
  }
  const [row] = (await db.execute<{ out: string; first_day: string | null }>(sql`
    select coalesce(sum(bt.amount_minor) filter (where bt.direction = 'DEBIT'
             /* حركةٌ بين حسابَي المنشأة ليست مالاً خرج منها */
             and bt.category::text <> 'INTERNAL'
             /* وما خرج ثمّ عاد وحُسم «ارتدّت» لم يخرج */
             and not exists (
               select 1 from alert_resolutions ar
                where ar.decision = 'BOUNCED' and ar.key like 'bounce:' || bt.id || ':%')), 0)::bigint as out,
           to_char(min(bt.value_date at time zone 'Asia/Riyadh'), 'YYYY-MM-DD') as first_day
      from bank_transactions bt
     where (bt.value_date at time zone 'Asia/Riyadh')::date > ${asOf}::date - ${RUNWAY_WINDOW_DAYS}::int
       and (bt.value_date at time zone 'Asia/Riyadh')::date <= ${asOf}::date
  `)).rows;
  return buildRunway({
    balanceMinor: cash.balanceMinor,
    balanceAsOf: asOf,
    today,
    outflowMinor: Number(row?.out ?? 0),
    firstDay: row?.first_day ?? null,
  });
}
