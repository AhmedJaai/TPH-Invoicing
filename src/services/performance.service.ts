/**
 * أداءُ المقهى من كلّ مصادره معاً — الربحُ بأبوابه شهراً بشهر (`loadPnlSeries`)، وسرعةُ
 * الخدمة من شاشة التحضير في فودكس (٠٩٣)، والتسرّبُ والنقدُ وما عليه.
 *
 * قراءةٌ فوق الدفاتر: لا تُنشئ قيداً ولا رقماً جديداً — تقسم ما حسبته الخدمات نفسُها.
 * وتغذّي صفحةَ «الأداء» والمستشارَ معاً: الرقمُ الواحد بجوابٍ واحد في الموضعين.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { monthKpi, serviceSpeed, type MonthKpi, type ServiceSpeed } from "@/lib/finance/performance";
import { addDays, currentMonthRiyadh, todayInRiyadh } from "@/lib/riyadh-time";
import { loadPnlSeries, type PnlView } from "./profit.service";
import { loadBalanceTotals } from "./supplier-balance.service";
import { loadCashOutlook } from "./cash-outlook.service";

type Conn = typeof db;

/** الشهرُ مؤشّراتٍ — والمجهولُ من أبوابه ما ظهر في الربح سطراً بلا مبلغ. */
export function kpiOf(view: PnlView): MonthKpi {
  const p = view.pnl;
  return monthKpi({
    month: view.month,
    revenueMinor: p.revenueMinor,
    paidMinor: view.revenue?.paidMinor ?? null,
    cardMinor: view.revenue?.cardMinor ?? null,
    orders: view.revenue?.orders ?? null,
    cogsMinor: p.cogsMinor,
    opex: new Map(p.opexByCategory.map((x) => [x.category, x.amountMinor])),
    missing: new Set(p.lines.filter((l) => l.id.startsWith("op-") && l.amountMinor === null).map((l) => l.id.slice(3))),
    profitMinor: p.profitMinor,
    profitLabel: p.profitLabel,
    complete: p.complete,
    open: view.input.open,
    discountMinor: view.revenue?.discountMinor ?? 0,
    refundsMinor: view.revenue?.refundsMinor ?? 0,
    staffListMinor: view.revenue?.staffListMinor ?? 0,
  });
}

export interface SpeedWindow {
  from: string;
  to: string;
  speed: ServiceSpeed;
  /** طلباتُ النافذة المقفلة كلُّها — فيُعرف كم منها قُرئ وقتُه. */
  closedOrders: number;
  /** طلباتٌ لم يُقرأ وقتا شاشتها بعد (`null` في المرآة) — نقصٌ في القراءة لا في المقهى. */
  unread: number;
}

/** سرعةُ التحضير في نافذة أيّام — من وقتَي الشاشة، بساعة الرياض. */
export async function loadServiceSpeed(from: string, to: string, conn: Conn = db): Promise<SpeedWindow> {
  const rows = await conn.execute<{ hour: number; seconds: number }>(sql`
    select extract(hour from kitchen_received_at at time zone 'Asia/Riyadh')::int as hour,
           extract(epoch from kitchen_done_at - kitchen_received_at)::int as seconds
      from foodics_orders
     where status = 4 and kitchen_received_at is not null and kitchen_done_at is not null
       and business_date >= ${from} and business_date <= ${to}`);
  const [c] = (await conn.execute<{ closed: number; unread: number }>(sql`
    select count(*)::int as closed, count(*) filter (where kitchen_done_at is null and wasted_lines is null)::int as unread
      from foodics_orders where status = 4 and business_date >= ${from} and business_date <= ${to}`)).rows;
  return { from, to, speed: serviceSpeed(rows.rows), closedOrders: c?.closed ?? 0, unread: c?.unread ?? 0 };
}

/** أوّلُ يومٍ عُرفت فيه أوقاتُ الشاشة — قبله لا يُقال «بطيء» ولا «سريع». */
export async function loadSpeedSince(conn: Conn = db): Promise<string | null> {
  const r = await conn.execute<{ day: string | null }>(sql`select min(business_date) as day from foodics_orders where kitchen_done_at is not null`);
  return r.rows[0]?.day ?? null;
}

export interface ReturnsWitness {
  /** طلباتُ مرتجَعٍ في النافذة. */
  returnOrders: number;
  /** منها ما قال الكاشير إنّ مكوّنات سطرٍ منه هُدرت. */
  wastedOrders: number;
  /** طلباتٌ قُرئت بعد ٠٩٣ (لها جواب) — قبلها لا يُعرف. */
  answered: number;
}

/** جوابُ الكاشير عن المرتجَع — شاهدٌ على «مرتجع بعد التحضير» الذي نحسبه بالوصفة. */
export async function loadReturnsWitness(from: string, to: string, conn: Conn = db): Promise<ReturnsWitness> {
  const r = await conn.execute<{ n: number; wasted: number; answered: number }>(sql`
    select count(*)::int as n,
           count(*) filter (where wasted_lines > 0)::int as wasted,
           count(*) filter (where wasted_lines is not null)::int as answered
      from foodics_orders where status = 5 and business_date >= ${from} and business_date <= ${to}`);
  const row = r.rows[0];
  return { returnOrders: row?.n ?? 0, wastedOrders: row?.wasted ?? 0, answered: row?.answered ?? 0 };
}

export interface CafePerformance {
  months: MonthKpi[];
  /** آخرُ شهرٍ انتهى — عليه تُقرأ المؤشّرات؛ والجاري «حتى اليوم». */
  latest: MonthKpi | null;
  current: MonthKpi | null;
  speed: { last30: SpeedWindow; previous30: SpeedWindow; since: string | null };
  returns: ReturnsWitness & { from: string; to: string };
  cash: { balanceMinor: number | null; balanceAsOf: string | null; dueNext60Minor: number; shortfallAt: string | null };
  owedMinor: number;
}

export async function loadPerformance(opts: { canSeePayroll: boolean }): Promise<CafePerformance> {
  const today = todayInRiyadh();
  const yesterday = addDays(today, -1);
  const [series, last30, previous30, since, outlook, balances] = await Promise.all([
    loadPnlSeries(),
    loadServiceSpeed(addDays(today, -30), yesterday),
    loadServiceSpeed(addDays(today, -60), addDays(today, -31)),
    loadSpeedSince(),
    loadCashOutlook({ canSeePayroll: opts.canSeePayroll }),
    loadBalanceTotals(),
  ]);
  const months = series.map(kpiOf).sort((a, b) => a.month.localeCompare(b.month));
  const thisMonth = currentMonthRiyadh();
  const finished = months.filter((m) => m.month < thisMonth && m.revenueMinor !== null);
  const returnsFrom = addDays(today, -90);
  const returns = await loadReturnsWitness(returnsFrom, yesterday);
  return {
    months,
    latest: finished.at(-1) ?? null,
    current: months.find((m) => m.month === thisMonth) ?? null,
    speed: { last30, previous30, since },
    returns: { ...returns, from: returnsFrom, to: yesterday },
    cash: { balanceMinor: outlook.balanceMinor, balanceAsOf: outlook.balanceAsOf, dueNext60Minor: outlook.totalMinor, shortfallAt: outlook.shortfallAt },
    owedMinor: balances.totals.owedMinor,
  };
}
