/**
 * التنبّؤ — صفحةٌ منعزلة تعرض المتوقَّع ولا تقرّر شيئاً (أحمد، ٢٥ نوفمبر ٢٠٢٦).
 *
 * ثلاثةُ أبواب لا رابع لها:
 *   - `loadForecastHistory` — ما بيع بالساعة، يقرؤه المحرّكُ الليليّ (`forecast/`).
 *   - `ingestForecastRun`   — يكتب ما تنبّأ به في جداول `forecast_*` وحدها.
 *   - `loadForecastView`    — ما تعرضه الصفحة: آخرُ تنبّؤ، ودقّتُه الماضية بالواقع.
 *
 * لا يقرأ هذا الملفَّ حسابُ مالٍ ولا جرد ولا مطابقة، ولا يكتب في غير `forecast_*`
 * (يحرسه `code-guards.test.ts`). والإيرادُ هو إيرادُ قائمة الدخل نفسُه: ما دفعه
 * الزبائن في فودكس بلا House Account (`loadRevenue`) — موزَّعاً على ساعة فتح الطلب.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { forecastBacktests, forecastDayContext, forecastEvents, forecastPeriods, forecastPoints, forecastRuns } from "@/db/schema";
import { createId } from "@/lib/id";
import { addDays, hourInRiyadh, todayInRiyadh } from "@/lib/riyadh-time";
import { businessDayOf } from "@/lib/pulse";
import { recordAudit } from "@/lib/audit";
import type { ForecastEventKind } from "@/lib/forecast/events";

/* ─────────────────────────── التاريخ للمحرّك ─────────────────────────── */

export interface ForecastHistory {
  generatedAt: string;
  today: string;
  /** [يوم, ساعة, هللاتٌ مدفوعة, طلبات] */
  totals: [string, number, number, number][];
  /** [يوم, ساعة, pos_product_id, مِلّي] */
  items: [string, number, string, number][];
  products: { id: string; name: string }[];
  /** أيّامٌ قرأتها المزامنة (فيها طلبٌ واحد على الأقلّ) — غيرُها مجهول لا صفر. */
  days: string[];
  events: { kind: string; label: string; fromDay: string; toDay: string; posProductId: string | null; fromHour: number | null }[];
}

export async function loadForecastHistory(opts: { events?: boolean } = {}): Promise<ForecastHistory> {
  const [totals, items, products, events] = await Promise.all([
    db.execute<{ d: string; h: number; paid: string; orders: number }>(sql`
      select o.business_date as d,
             extract(hour from coalesce(o.opened_at, o.closed_at) at time zone 'Asia/Riyadh')::int as h,
             coalesce(sum(p.amount_minor) filter (where p.method_type <> 5), 0)::bigint as paid,
             count(distinct o.id) filter (where o.status = 4 and p.method_type <> 5)::int as orders
        from foodics_orders o join foodics_order_payments p on p.order_id = o.id
       where o.status in (4, 5) and coalesce(o.opened_at, o.closed_at) is not null
       group by 1, 2 order by 1, 2
    `),
    db.execute<{ d: string; h: number; pid: string; q: string }>(sql`
      select s.business_date::text as d,
             extract(hour from s.sold_at at time zone 'Asia/Riyadh')::int as h,
             l.pos_product_id as pid,
             round(sum(l.quantity) * 1000)::bigint as q
        from sale_lines l
        join sales s on s.id = l.sale_id
        join pos_products pp on pp.id = l.pos_product_id
       where not s.is_void and not l.is_void and not l.is_refund
         and pp.kind = 'PRODUCT' and coalesce(pp.category, '') <> 'Test'
       group by 1, 2, 3 order by 1, 2
    `),
    db.execute<{ id: string; name: string }>(sql`
      select id, name from pos_products where kind = 'PRODUCT' and coalesce(category, '') <> 'Test'
    `),
    opts.events === false ? Promise.resolve([]) : db.select().from(forecastEvents).where(sql`${forecastEvents}.voided_at is null`),
  ]);
  const days = [...new Set(totals.rows.map((r) => r.d))].sort();
  /* يومُ العمل لا يومُ التقويم: قبل الخامسة فجراً ما زال يومُ أمس جارياً — لا يُتعلَّم منه ناقصاً */
  const now = new Date();
  return {
    generatedAt: now.toISOString(),
    today: businessDayOf(todayInRiyadh(now), hourInRiyadh(now), addDays),
    totals: totals.rows.map((r) => [r.d, r.h, Number(r.paid), r.orders]),
    items: items.rows.map((r) => [r.d, r.h, r.pid, Number(r.q)]),
    products: products.rows,
    days,
    events: events.map((e) => ({ kind: e.kind, label: e.label, fromDay: e.fromDay, toDay: e.toDay, posProductId: e.posProductId, fromHour: e.fromHour })),
  };
}

/* ─────────────────────────── ما يكتبه المحرّك ─────────────────────────── */

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const INT = z.number().int().safe();
const METRIC = z.enum(["NET_MINOR", "ORDERS", "QTY_MILLI"]);

export const forecastRunSchema = z.object({
  issuedOn: DAY,
  historyFrom: DAY,
  historyTo: DAY,
  engineVersion: z.string().min(1).max(60),
  durationMs: INT.nonnegative().nullable(),
  models: z.record(z.string(), z.unknown()),
  summary: z.record(z.string(), z.unknown()),
  /** [series, metric, day, hour|null, p10, p50, p90] */
  points: z.array(z.tuple([
    z.string().regex(/^(total|item:.+)$/), METRIC, DAY, INT.min(0).max(23).nullable(), INT.nonnegative(), INT.nonnegative(), INT.nonnegative(),
  ])).min(1).max(60_000)
    .refine((ps) => ps.every(([, , , , a, b, c]) => a <= b && b <= c), "p10 ≤ p50 ≤ p90"),
  context: z.array(z.object({ day: DAY, context: z.record(z.string(), z.unknown()) })).max(400),
  backtests: z.array(z.object({
    model: z.string().min(1).max(40),
    series: z.string().min(1).max(200),
    metric: METRIC,
    horizon: z.enum(["D1", "D2_7", "D8_31", "H_D1"]),
    wapeBp: INT.nonnegative(),
    biasBp: INT,
    coverageBp: INT.min(0).max(10_000).nullable(),
    n: INT.positive(),
  })).max(5_000),
  /** [شهر, مقياس, من يوم, أيّام, p10, p50, p90, meta] — غائبٌ في المحرّكات الأقدم */
  periods: z.array(z.tuple([
    z.string().regex(/^\d{4}-\d{2}$/), z.enum(["NET_MINOR", "ORDERS"]), DAY, INT.min(1).max(31),
    INT.nonnegative(), INT.nonnegative(), INT.nonnegative(), z.record(z.string(), z.unknown()),
  ])).max(100).default([])
    .refine((ps) => ps.every(([period, , from, , a, b, c]) => from.startsWith(period) && a <= b && b <= c), "شهرٌ غير متّسق"),
});
export type ForecastRunInput = z.infer<typeof forecastRunSchema>;

/** نقاطُ الساعة للأصناف تُبقى لآخر أسبوعين؛ ونقاطُ اليوم تبقى كلُّها — بها تُقاس الدقّةُ الماضية. */
export const HOURLY_ITEM_RETENTION_DAYS = 14;
const BATCH = 2_000;

export async function ingestForecastRun(input: ForecastRunInput): Promise<{ runId: string; points: number }> {
  const runId = createId();
  await db.transaction(async (t) => {
    await t.insert(forecastRuns).values({
      id: runId, issuedOn: input.issuedOn, historyFrom: input.historyFrom, historyTo: input.historyTo,
      engineVersion: input.engineVersion, models: input.models, summary: input.summary, durationMs: input.durationMs,
    });
    for (let i = 0; i < input.points.length; i += BATCH) {
      await t.insert(forecastPoints).values(input.points.slice(i, i + BATCH).map(([series, metric, day, hour, p10, p50, p90]) => ({
        runId, series, metric, day, hour, p10, p50, p90,
      })));
    }
    if (input.context.length) await t.insert(forecastDayContext).values(input.context.map((c) => ({ runId, day: c.day, context: c.context })));
    for (let i = 0; i < input.backtests.length; i += BATCH) {
      await t.insert(forecastBacktests).values(input.backtests.slice(i, i + BATCH).map((b) => ({ runId, ...b })));
    }
    if (input.periods.length) {
      await t.insert(forecastPeriods).values(input.periods.map(([period, metric, fromDay, days, p10, p50, p90, meta]) => ({
        runId, period, metric, fromDay, days, p10, p50, p90, meta,
      })));
    }
    /* ساعاتُ الأصناف في التنبّؤات القديمة لا يقرؤها أحد — وتبقى أيّامُها للدقّة */
    const cutoff = addDays(input.issuedOn, -HOURLY_ITEM_RETENTION_DAYS);
    await t.execute(sql`
      delete from forecast_points fp using forecast_runs r
       where fp.run_id = r.id and r.issued_on < ${cutoff} and fp.hour is not null and fp.series <> 'total'
    `);
  });
  return { runId, points: input.points.length };
}

/* ─────────────────────────── ما تعرضه الصفحة ─────────────────────────── */

export interface ForecastBand { p10: number; p50: number; p90: number }
export interface ForecastDay extends ForecastBand {
  day: string;
  orders: ForecastBand | null;
  context: ForecastContext | null;
}
export interface ForecastContext {
  hijri?: string;
  tags?: string[];
  estimated?: boolean;
  weather?: { t_max: number | null; humidity: number | null; rain_mm: number | null };
  weatherKind?: string;
  events?: { kind: string; label: string; source: string }[];
  drivers?: { label: string; minor: number }[];
}
export interface ForecastItem {
  id: string;
  name: string;
  /** أيّامُ الأسبوع الأوّل بالمِلّي، ومجموعُها. */
  days: ForecastBand[];
  week: ForecastBand;
}
export interface ForecastAccuracyRow {
  day: string;
  forecast: ForecastBand;
  actualMinor: number;
}
export interface ForecastBacktestRow {
  model: string;
  series: string;
  metric: string;
  horizon: string;
  wapeBp: number;
  coverageBp: number | null;
  n: number;
}
export interface ForecastEventRow {
  id: string;
  kind: string;
  label: string;
  fromDay: string;
  toDay: string;
  posProductId: string | null;
  productName: string | null;
  fromHour: number | null;
}
/**
 * شهرٌ في التوقّع. الجاري = ما بيع فعلاً قبل اليوم + اليوم (يضيفه الحيُّ في الصفحة) + ما بعده.
 * والقادم كلُّه متوقَّع. والمالُ ما دفعه الزبائن شاملاً الضريبة — إيرادُ قائمة الدخل قبل ضريبتها.
 */
export interface ForecastMonth {
  period: string;
  /** ما بيع فعلاً في أيّامٍ انتهت من هذا الشهر (قبل يوم العمل الجاري). */
  actualMinor: number;
  /** متوقَّعُ اليوم الجاري إن كان من هذا الشهر — الصفحةُ تستبدل به التنبّؤَ الحيّ. */
  today: ForecastBand | null;
  /** متوقَّعُ ما بعد اليوم حتى آخر الشهر. */
  rest: ForecastBand;
  /** الطلبات: الفعليُّ والمتوقَّع (الأوسط). */
  ordersActual: number;
  ordersRest: number;
  days: number;
  source: "daily" | "structural" | "mixed";
  unmeasured: string[];
  tags: string[];
}
export interface ForecastHealth {
  lastSyncAt: Date | null;
  lastSyncOk: boolean | null;
  lastSaleDay: string | null;
  /** أيّامٌ في آخر ستّين بلا طلبٍ واحد — مغلقةٌ أو لم تُقرأ. */
  emptyDays: string[];
  upcomingEvents: number;
}
export interface ForecastView {
  run: { id: string; issuedOn: string; historyFrom: string; historyTo: string; createdAt: Date; engineVersion: string; durationMs: number | null; models: Record<string, unknown>; summary: Record<string, unknown> } | null;
  days: ForecastDay[];
  /** ساعاتُ اليوم المختار: المتوقَّع، وما بيع فعلاً إن كان قد بدأ. */
  hours: { hour: number; p10: number; p50: number; p90: number; actualMinor: number | null }[];
  selectedDay: string | null;
  items: ForecastItem[];
  accuracy: ForecastAccuracyRow[];
  backtests: ForecastBacktestRow[];
  events: ForecastEventRow[];
  products: { id: string; name: string }[];
  /** يومُ العمل الجاري — يبدأ الخامسةَ فجراً كـ«نبض المقهى»، لا منتصفَ الليل. */
  today: string;
  /** ساعةُ الرياض الآن — للتنبّؤ الحيّ. */
  nowHour: number;
  /** ما بيع اليوم بالساعة حتى الآن — للتنبّؤ الحيّ. */
  todaySold: Map<number, number>;
  /** تنبّؤُ ساعات اليوم الجاري (إن كان في التنبّؤ) — للتنبّؤ الحيّ. */
  todayHours: { hour: number; p10: number; p50: number; p90: number }[];
  months: ForecastMonth[];
  /** ما بيع فعلاً في كلّ شهرٍ مضى (وجزءُ الجاري) — للمقارنة. */
  pastMonths: { period: string; actualMinor: number; days: number; orders: number }[];
  health: ForecastHealth;
}

type Band3 = { p10: string | number; p50: string | number; p90: string | number };
const band = (r: Band3): ForecastBand => ({ p10: Number(r.p10), p50: Number(r.p50), p90: Number(r.p90) });
const PAID = sql`coalesce(sum(p.amount_minor) filter (where p.method_type <> 5), 0)::bigint`;

export async function loadForecastView(opts: { day?: string; at?: Date } = {}): Promise<ForecastView> {
  const at = opts.at ?? new Date();
  const nowHour = hourInRiyadh(at);
  const today = businessDayOf(todayInRiyadh(at), nowHour, addDays);
  const [[runRow], events, products, past, health] = await Promise.all([
    db.select().from(forecastRuns).orderBy(sql`${forecastRuns}.created_at desc`).limit(1),
    db.execute<{ id: string; kind: string; label: string; from_day: string; to_day: string; pos_product_id: string | null; name: string | null; from_hour: number | null }>(sql`
      select e.id, e.kind, e.label, e.from_day, e.to_day, e.pos_product_id, p.name, e.from_hour
        from forecast_events e left join pos_products p on p.id = e.pos_product_id
       where e.voided_at is null and e.to_day >= ${addDays(today, -60)}
       order by e.from_day desc limit 100
    `),
    db.execute<{ id: string; name: string }>(sql`
      select id, name from pos_products where kind = 'PRODUCT' and coalesce(category, '') <> 'Test' order by name
    `),
    db.execute<{ period: string; paid: string; days: number; orders: number }>(sql`
      select substr(o.business_date, 1, 7) as period, ${PAID} as paid,
             count(distinct o.business_date)::int as days,
             count(distinct o.id) filter (where o.status = 4 and p.method_type <> 5)::int as orders
        from foodics_orders o join foodics_order_payments p on p.order_id = o.id
       where o.status in (4, 5) and o.business_date < ${today}
       group by 1 order by 1
    `),
    loadHealth(today),
  ]);
  const base = {
    today, nowHour,
    events: events.rows.map((e) => ({ id: e.id, kind: e.kind, label: e.label, fromDay: e.from_day, toDay: e.to_day, posProductId: e.pos_product_id, productName: e.name, fromHour: e.from_hour })),
    products: products.rows,
    pastMonths: past.rows.map((r) => ({ period: r.period, actualMinor: Number(r.paid), days: r.days, orders: r.orders })),
    health,
  };
  if (!runRow) {
    return { run: null, days: [], hours: [], selectedDay: null, items: [], accuracy: [], backtests: [], todaySold: new Map(), todayHours: [], months: [], ...base };
  }
  const runId = runRow.id;
  const [dayPts, ctx, itemPts, bts, accuracy, sold, periods] = await Promise.all([
    db.execute<{ day: string; metric: string } & Band3>(sql`
      select day, metric, p10, p50, p90 from forecast_points
       where run_id = ${runId} and series = 'total' and hour is null order by day
    `),
    db.select().from(forecastDayContext).where(sql`${forecastDayContext}.run_id = ${runId}`),
    db.execute<{ series: string; day: string } & Band3>(sql`
      select series, day, p10, p50, p90 from forecast_points
       where run_id = ${runId} and series like 'item:%' and hour is null and day >= ${today} and day < ${addDays(today, 7)}
       order by series, day
    `),
    db.select().from(forecastBacktests).where(sql`${forecastBacktests}.run_id = ${runId}`),
    /*
      كم أصاب فعلاً: لكلّ يومٍ مضى، تنبّؤُ صباحه (التشغيلُ الصادر ذلك اليوم، آخرُه) مقابل ما دفعه
      الزبائن — الإيرادُ نفسُه الذي تقرؤه قائمةُ الدخل (بلا House Account).
    */
    db.execute<{ day: string; actual: string } & Band3>(sql`
      with issued as (
        select distinct on (issued_on) id, issued_on from forecast_runs order by issued_on, created_at desc
      ), fc as (
        select i.issued_on as day, p.p10, p.p50, p.p90
          from issued i join forecast_points p on p.run_id = i.id
         where p.series = 'total' and p.metric = 'NET_MINOR' and p.hour is null and p.day = i.issued_on
      ), act as (
        select o.business_date as day, ${PAID} as actual
          from foodics_orders o join foodics_order_payments p on p.order_id = o.id
         where o.status in (4, 5) and o.business_date in (select day from fc)
         group by 1
      )
      select fc.day, fc.p10, fc.p50, fc.p90, act.actual from fc join act on act.day = fc.day
       where fc.day < ${today} order by fc.day desc limit 30
    `),
    db.execute<{ h: number; paid: string }>(sql`
      select extract(hour from coalesce(o.opened_at, o.closed_at) at time zone 'Asia/Riyadh')::int as h, ${PAID} as paid
        from foodics_orders o join foodics_order_payments p on p.order_id = o.id
       where o.status in (4, 5) and o.business_date = ${today} and coalesce(o.opened_at, o.closed_at) is not null
       group by 1
    `),
    db.select().from(forecastPeriods).where(sql`${forecastPeriods}.run_id = ${runId}`),
  ]);

  const ctxOf = new Map(ctx.map((c) => [c.day, c.context as ForecastContext]));
  const net = dayPts.rows.filter((r) => r.metric === "NET_MINOR");
  const ord = new Map(dayPts.rows.filter((r) => r.metric === "ORDERS").map((r) => [r.day, band(r)]));
  /* الأيّامُ التي مضت منذ صدور التنبّؤ لا تُعرض توقّعاً — صارت واقعاً */
  const days: ForecastDay[] = net.filter((r) => r.day >= today).map((r) => ({ day: r.day, ...band(r), orders: ord.get(r.day) ?? null, context: ctxOf.get(r.day) ?? null }));
  const selectedDay = opts.day && days.some((d) => d.day === opts.day) ? opts.day : days[0]?.day ?? null;

  const todaySold = new Map(sold.rows.map((r) => [r.h, Number(r.paid)]));
  const hoursOf = async (day: string) => (await db.execute<{ hour: number } & Band3>(sql`
      select hour, p10, p50, p90 from forecast_points
       where run_id = ${runId} and series = 'total' and metric = 'NET_MINOR' and day = ${day} and hour is not null
    `)).rows.map((r) => ({ hour: r.hour, ...band(r) }));
  const hourRows = selectedDay ? await hoursOf(selectedDay) : [];
  const todayHours = selectedDay === today ? hourRows : days.some((d) => d.day === today) ? await hoursOf(today) : [];
  const actualFor = selectedDay === today ? todaySold : null;
  const hours = hourRows.map((r) => ({ ...r, actualMinor: actualFor ? actualFor.get(r.hour) ?? 0 : null }));

  const names = new Map(products.rows.map((p) => [p.id, p.name]));
  const byItem = new Map<string, ForecastBand[]>();
  for (const r of itemPts.rows) {
    const list = byItem.get(r.series) ?? [];
    list.push(band(r));
    byItem.set(r.series, list);
  }
  const items: ForecastItem[] = [...byItem].map(([series, list]) => {
    const id = series.slice("item:".length);
    return {
      id, name: names.get(id) ?? id, days: list,
      week: list.reduce((s, b) => ({ p10: s.p10 + b.p10, p50: s.p50 + b.p50, p90: s.p90 + b.p90 }), { p10: 0, p50: 0, p90: 0 }),
    };
  }).sort((a, b) => b.week.p50 - a.week.p50);

  const months = buildMonths({
    today, periods, netDays: net.map((r) => ({ day: r.day, ...band(r) })),
    ordDays: [...ord].map(([day, b]) => ({ day, ...b })), past: base.pastMonths,
  });

  return {
    run: {
      id: runRow.id, issuedOn: runRow.issuedOn, historyFrom: runRow.historyFrom, historyTo: runRow.historyTo,
      createdAt: runRow.createdAt, engineVersion: runRow.engineVersion, durationMs: runRow.durationMs,
      models: runRow.models as Record<string, unknown>, summary: runRow.summary as Record<string, unknown>,
    },
    days, hours, selectedDay, items,
    accuracy: accuracy.rows.map((r) => ({ day: r.day, forecast: band(r), actualMinor: Number(r.actual) })),
    backtests: bts.map((b) => ({ model: b.model, series: b.series, metric: b.metric, horizon: b.horizon, wapeBp: b.wapeBp, coverageBp: b.coverageBp, n: b.n })),
    todaySold,
    todayHours,
    months,
    ...base,
  };
}

/**
 * الأشهر من نقاط اليوم (ما يقع في الأيّام الواحد والثلاثين) ومن أشهر المحرّك (ما بعدها).
 * دالّةٌ خالصة: ما مضى من الشهر الجاري واقعٌ من فودكس، واليومُ الجاري مستقلّ، وما بعده متوقَّع.
 */
export function buildMonths(i: {
  today: string;
  periods: { period: string; metric: string; fromDay: string; days: number; p10: number; p50: number; p90: number; meta: unknown }[];
  netDays: ({ day: string } & ForecastBand)[];
  ordDays: ({ day: string } & ForecastBand)[];
  past: { period: string; actualMinor: number; orders: number }[];
}): ForecastMonth[] {
  const lastDaily = i.netDays.at(-1)?.day ?? null;
  const net = i.periods.filter((p) => p.metric === "NET_MINOR").sort((a, b) => a.period.localeCompare(b.period));
  const ordP = new Map(i.periods.filter((p) => p.metric === "ORDERS").map((p) => [p.period, p]));
  const pastOf = new Map(i.past.map((p) => [p.period, p]));
  const thisMonth = i.today.slice(0, 7);
  return net.filter((p) => p.period >= thisMonth).map((p) => {
    const meta = (p.meta ?? {}) as { source?: string; unmeasured?: string[]; tags?: string[] };
    const ratioLo = p.p50 > 0 ? p.p10 / p.p50 : 1;
    const ratioHi = p.p50 > 0 ? p.p90 / p.p50 : 1;
    const inMonth = (d: string) => d.startsWith(p.period);
    const tomorrow = addDays(i.today, 1);
    /* بعد آخر يومٍ يوميّ: معدّلُ المحرّك البنيويّ لأيّام هذا الشهر */
    const tailFrom = [`${p.period}-01`, tomorrow, lastDaily ? addDays(lastDaily, 1) : tomorrow].sort().at(-1)!;
    const tailDays = remainingDays(p.period, tailFrom);
    const perDay = (x: { p50: number; days: number } | undefined) => (x && x.days > 0 ? x.p50 / x.days : 0);
    const todayBand = i.netDays.find((d) => d.day === i.today && inMonth(d.day)) ?? null;
    const restP50 = i.netDays.filter((d) => inMonth(d.day) && d.day > i.today).reduce((s, d) => s + d.p50, 0) + perDay(p) * tailDays;
    const o = ordP.get(p.period);
    const ordRest = i.ordDays.filter((d) => inMonth(d.day) && d.day >= i.today).reduce((s, d) => s + d.p50, 0) + perDay(o) * tailDays;
    const past = pastOf.get(p.period);
    const current = p.period === thisMonth;
    return {
      period: p.period,
      actualMinor: current ? past?.actualMinor ?? 0 : 0,
      today: todayBand ? { p10: todayBand.p10, p50: todayBand.p50, p90: todayBand.p90 } : null,
      rest: { p10: Math.round(restP50 * ratioLo), p50: Math.round(restP50), p90: Math.round(restP50 * ratioHi) },
      ordersActual: current ? past?.orders ?? 0 : 0,
      ordersRest: Math.round(ordRest),
      days: daysInPeriod(p.period),
      source: tailDays === 0 ? "daily" : tailDays >= daysInPeriod(p.period) ? "structural" : "mixed",
      unmeasured: meta.unmeasured ?? [],
      tags: meta.tags ?? [],
    };
  });
}

function daysInPeriod(period: string): number {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** أيّامُ الشهر من `from` (شاملاً) إلى آخره. */
function remainingDays(period: string, from: string): number {
  if (!from.startsWith(period)) return from < period ? daysInPeriod(period) : 0;
  return daysInPeriod(period) - Number(from.slice(8, 10)) + 1;
}

async function loadHealth(today: string): Promise<ForecastHealth> {
  const [sync, last, empty, upcoming] = await Promise.all([
    /* الاستعلامُ الخامّ يُرجع الوقتَ نصّاً — يُحوَّل تاريخاً هنا لا في الصفحة */
    db.execute<{ finished_at: string | Date | null; status: string }>(sql`
      select finished_at, status from foodics_sync_runs where finished_at is not null order by finished_at desc limit 1
    `),
    db.execute<{ d: string | null }>(sql`select max(business_date) as d from foodics_orders where status in (4, 5)`),
    db.execute<{ d: string }>(sql`
      select to_char(g, 'YYYY-MM-DD') as d
        from generate_series(${addDays(today, -60)}::date, ${addDays(today, -1)}::date, interval '1 day') g
       where to_char(g, 'YYYY-MM-DD') >= (select min(business_date) from foodics_orders)
         and not exists (select 1 from foodics_orders o where o.business_date = to_char(g, 'YYYY-MM-DD') and o.status in (4, 5))
       order by 1
    `),
    db.execute<{ n: number }>(sql`
      select count(*)::int as n from forecast_events where voided_at is null and to_day >= ${today}
    `),
  ]);
  const s = sync.rows[0];
  return {
    lastSyncAt: s?.finished_at ? new Date(s.finished_at) : null,
    /* «OK» اكتملت، و«PARTIAL» قرأت بعضاً — وكلاهما من `foodics-sync.service.ts` */
    lastSyncOk: s ? s.status === "OK" : null,
    lastSaleDay: last.rows[0]?.d ?? null,
    emptyDays: empty.rows.map((r) => r.d),
    upcomingEvents: upcoming.rows[0]?.n ?? 0,
  };
}

/* ─────────────────────────── أحداثٌ يعرفها الإنسان ─────────────────────────── */


export interface ForecastEventInput {
  kind: ForecastEventKind;
  label: string;
  fromDay: string;
  toDay: string;
  posProductId: string | null;
  fromHour: number | null;
}

export async function createForecastEvent(input: ForecastEventInput, actorId: string): Promise<string> {
  const id = createId();
  await db.transaction(async (t) => {
    await t.insert(forecastEvents).values({ id, ...input, createdById: actorId });
    await recordAudit({ actorId, action: "FORECAST_EVENT_SAVED", entityType: "forecast_event", entityId: id, after: input }, t);
  });
  return id;
}

export async function voidForecastEvent(id: string, actorId: string): Promise<boolean> {
  return db.transaction(async (t) => {
    const rows = await t.update(forecastEvents).set({ voidedAt: new Date() })
      .where(sql`${forecastEvents}.id = ${id} and ${forecastEvents}.voided_at is null`).returning({ id: forecastEvents.id });
    if (rows.length === 0) return false;
    await recordAudit({ actorId, action: "FORECAST_EVENT_VOIDED", entityType: "forecast_event", entityId: id }, t);
    return true;
  });
}
