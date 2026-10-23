/**
 * ما تقوله المساحةُ الماليّة لـ«يحتاج قرارك» — **استعلاماتٌ رخيصة**: القائمةُ تُحمَّل مع كلّ
 * صفحة، فلا تُحسَب هنا قائمةُ دخلٍ ولا تقريرُ مخزون.
 *
 *   - إيجارٌ في الكشف لم يُقَل كم شهراً يغطّي، وشهرٌ انتهى بلا إيجارٍ أو رواتب.
 *   - بنودُ فواتير جاهزةٌ للربط بدليل فودكس.
 *   - صندوقٌ أُقفل بلا عدّ أو بفرقٍ ظاهر (آخر أسبوعين).
 *   - فودكس لم يُقرأ منذ يومٍ وأكثر — مزامنةٌ تقف بلا أن يعلم أحد.
 *   - صنفٌ تكرّر فرقُه شهرين: يُحسَب عند المزامنة ويُحفَظ (`refreshRecurringGaps`) ويُقرأ هنا.
 *
 * وكلُّ بندٍ له جوابٌ ممكن وزرٌّ يُسكته: فرقٌ تفسيرُه معروف لا يُنبَّه عليه.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { previousMonth } from "@/lib/finance/stock-window";
import { recurringGaps, type MonthGap, type RecurringGap } from "@/lib/finance/stock-gaps";
import { silencedKeys } from "@/lib/signal-decisions";
import { addDays, currentMonthRiyadh, todayInRiyadh } from "@/lib/riyadh-time";
import { foodicsConfigured } from "@/lib/foodics/client";
import { isReady, loadStockLinks } from "./stock-link.service";
import { loadFlowMonths, loadMonthStockFlow } from "./stock-flow.service";

/** فرقُ صندوقٍ فوق هذا يُسأل عنه. أكثرُ فروق المقهى دون عشرين ريالاً (فكّة). */
export const TILL_GAP_MINOR = 50_00;
export const TILL_LOOKBACK_DAYS = 14;
/** المزامنةُ كلَّ ثلاث ساعات حين يُفتَح التطبيق؛ فوق هذا «لم يُقرأ». */
export const FOODICS_STALE_HOURS = 30;
const GAPS_KEY = "finance.recurring-gaps";
/** كم شهراً منتهياً يُفحَص لتكرار الفرق. */
const GAP_MONTHS = 3;

export const tillSignalKey = (tillId: string) => `foodics-till:${tillId}`;
export const stockGapKey = (productId: string, kind: string) => `stock-gap:${productId}:${kind}`;

export interface FinanceAttentionFacts {
  rentLumps: { day: string; amountMinor: number }[];
  /** آخرُ شهرٍ انتهى وما ينقص ربحَه من الأساسيّات. */
  lastMonthMissing: { month: string; rent: boolean; salary: boolean } | null;
  readyLinks: { count: number; valueMinor: number };
  tillGaps: { id: string; day: string; userName: string | null; varianceMinor: number; uncounted: boolean }[];
  /** ساعاتٌ منذ آخر مزامنةٍ ناجحة — `null` لا يُنبَّه (غير موصول، أو حديث). */
  foodicsStaleHours: number | null;
  foodicsLastError: string | null;
  recurring: RecurringGap[];
}

/** يحسب الأصنافَ التي تكرّر فرقُها في آخر الأشهر المنتهية ويحفظها — يُستدعى بعد المزامنة ومن النصّ. */
export async function refreshRecurringGaps(): Promise<RecurringGap[]> {
  const current = currentMonthRiyadh();
  const months = (await loadFlowMonths()).filter((m) => m < current).slice(0, GAP_MONTHS);
  const gaps: MonthGap[] = [];
  for (const month of months) {
    const flow = await loadMonthStockFlow(month);
    /* بلا عدٍّ في الطرفين لا فرق — والشهرُ يقطع السلسلة بحقّ */
    for (const x of flow.items) {
      if (x.unexplainedMinor === null && x.witnessUnexplainedMinor === null) continue;
      gaps.push({ month, productId: x.productId, name: x.name, oursMinor: x.unexplainedMinor, witnessMinor: x.witnessUnexplainedMinor });
    }
  }
  const found = recurringGaps(gaps, months);
  const value = JSON.stringify({ at: new Date().toISOString(), months, gaps: found });
  await db.insert(appSettings).values({ key: GAPS_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  return found;
}

function isRecurringGap(x: unknown): x is RecurringGap {
  if (typeof x !== "object" || x === null) return false;
  const g = x as Record<string, unknown>;
  return typeof g.productId === "string" && typeof g.name === "string" && (g.kind === "SHORTAGE" || g.kind === "OVER_AVAILABLE")
    && Array.isArray(g.months) && typeof g.totalMinor === "number" && typeof g.byWitness === "boolean";
}

async function loadStoredGaps(): Promise<RecurringGap[]> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, GAPS_KEY)).limit(1);
  if (!row) return [];
  try {
    const parsed: unknown = JSON.parse(row.value);
    const list = typeof parsed === "object" && parsed !== null ? (parsed as { gaps?: unknown }).gaps : null;
    return Array.isArray(list) ? list.filter(isRecurringGap) : [];
  } catch {
    return [];
  }
}

export async function loadFinanceAttentionFacts(): Promise<FinanceAttentionFacts> {
  const today = todayInRiyadh();
  const lastMonth = previousMonth(currentMonthRiyadh());
  const [lumps, covered, links, tills, sync, decisions, stored] = await Promise.all([
    db.execute<{ day: string; amount_minor: number }>(sql`
      select to_char(bt.value_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as day, bt.amount_minor
        from bank_transactions bt
       where bt.direction = 'DEBIT' and bt.category = 'RENT'
         and not exists (select 1 from finance_declarations d where d.bank_transaction_id = bt.id and d.voided_at is null)
       order by bt.value_date desc
    `),
    db.execute<{ has_sales: boolean; rent: boolean; salary: boolean }>(sql`
      select exists (select 1 from sales where to_char(business_date, 'YYYY-MM') = ${lastMonth}) as has_sales,
             (exists (select 1 from expenses e where e.period_month = ${lastMonth} and e.category = 'RENT' and e.amount_minor > 0
                         and not exists (select 1 from finance_declarations d where d.bank_transaction_id = e.bank_transaction_id and d.voided_at is null and d.kind = 'SPREAD'))
              or exists (select 1 from finance_declarations d where d.voided_at is null and d.category = 'RENT' and d.from_month <= ${lastMonth} and d.to_month >= ${lastMonth})) as rent,
             (exists (select 1 from expenses e where e.period_month = ${lastMonth} and e.category = 'SALARY' and e.amount_minor > 0)
              or exists (select 1 from finance_declarations d where d.voided_at is null and d.category = 'SALARY' and d.from_month <= ${lastMonth} and d.to_month >= ${lastMonth})
              /* رواتبُ دفعها المالكُ من تحويلاته لنفسه ووزّعها على موظّفيه (084) */
              or exists (select 1 from payroll_links pl join bank_transactions bt on bt.id = pl.bank_transaction_id
                          where pl.voided_at is null and pl.purpose in ('SALARY', 'ADVANCE', 'LOAN') and bt.category = 'PERSONAL'
                            and to_char(bt.value_date at time zone 'Asia/Riyadh', 'YYYY-MM') = ${lastMonth})) as salary
    `),
    loadStockLinks(),
    db.execute<{ id: string; day: string; user_name: string | null; variance_minor: number | null; closing_minor: number | null; estimated_cash_minor: number | null }>(sql`
      select id, business_date as day, user_name, variance_minor, closing_minor, estimated_cash_minor
        from foodics_tills
       where closed_at is not null and business_date >= ${addDays(today, -TILL_LOOKBACK_DAYS)}
         and (abs(coalesce(variance_minor, 0)) >= ${TILL_GAP_MINOR})
       order by business_date desc
    `),
    db.execute<{ last_ok: Date | null; last_error: string | null; orders: number }>(sql`
      select (select max(finished_at) from foodics_sync_runs where status = 'OK') as last_ok,
             (select error from foodics_sync_runs order by started_at desc limit 1) as last_error,
             (select count(*)::int from foodics_orders) as orders
    `),
    db.execute<{ key: string; decision: string }>(sql`select key, decision from alert_resolutions where key like 'foodics-till:%' or key like 'stock-gap:%'`),
    loadStoredGaps(),
  ]);
  const silenced = silencedKeys(decisions.rows, today);
  const ready = links.rows.filter(isReady);
  const c = covered.rows[0];
  const s = sync.rows[0];
  const lastOk = s?.last_ok ? new Date(s.last_ok) : null;
  const staleHours = lastOk ? Math.floor((Date.now() - lastOk.getTime()) / 3_600_000) : null;
  return {
    rentLumps: lumps.rows.map((r) => ({ day: r.day, amountMinor: r.amount_minor })),
    lastMonthMissing: c?.has_sales && (!c.rent || !c.salary) ? { month: lastMonth, rent: !c.rent, salary: !c.salary } : null,
    readyLinks: { count: ready.length, valueMinor: ready.reduce((sum, r) => sum + r.valueMinor, 0) },
    tillGaps: tills.rows
      .filter((t) => !silenced.has(tillSignalKey(t.id)))
      .map((t) => ({ id: t.id, day: t.day, userName: t.user_name, varianceMinor: Number(t.variance_minor ?? 0), uncounted: Number(t.closing_minor ?? 0) === 0 && Number(t.estimated_cash_minor ?? 0) > 0 })),
    /* لا يُنبَّه على قاعدةٍ لم تُقرأ قطّ ولا على مفتاحٍ غير مضبوط: ذاك إعدادٌ لا عطل */
    foodicsStaleHours: foodicsConfigured() && (s?.orders ?? 0) > 0 && staleHours !== null && staleHours >= FOODICS_STALE_HOURS ? staleHours : null,
    foodicsLastError: s?.last_error ?? null,
    recurring: stored.filter((g) => !silenced.has(stockGapKey(g.productId, g.kind))),
  };
}
