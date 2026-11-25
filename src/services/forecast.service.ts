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
import { forecastBacktests, forecastDayContext, forecastEvents, forecastPoints, forecastRuns } from "@/db/schema";
import { createId } from "@/lib/id";
import { addDays, todayInRiyadh } from "@/lib/riyadh-time";
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
  return {
    generatedAt: new Date().toISOString(),
    today: todayInRiyadh(),
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
  /** [اليوم الأوّل، الثاني] بالمِلّي، ومجموعُ الأيّام السبعة. */
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
  today: string;
  /** ما بيع اليوم بالساعة حتى الآن — للتنبّؤ الحيّ. */
  todaySold: Map<number, number>;
  /** تنبّؤُ ساعات اليوم الجاري (إن كان في التنبّؤ) — للتنبّؤ الحيّ. */
  todayHours: { hour: number; p10: number; p50: number; p90: number }[];
}

type Band3 = { p10: string | number; p50: string | number; p90: string | number };
const band = (r: Band3): ForecastBand => ({ p10: Number(r.p10), p50: Number(r.p50), p90: Number(r.p90) });

export async function loadForecastView(opts: { day?: string } = {}): Promise<ForecastView> {
  const today = todayInRiyadh();
  const [runRow] = await db.select().from(forecastRuns).orderBy(sql`${forecastRuns}.created_at desc`).limit(1);
  const [events, products] = await Promise.all([
    db.execute<{ id: string; kind: string; label: string; from_day: string; to_day: string; pos_product_id: string | null; name: string | null; from_hour: number | null }>(sql`
      select e.id, e.kind, e.label, e.from_day, e.to_day, e.pos_product_id, p.name, e.from_hour
        from forecast_events e left join pos_products p on p.id = e.pos_product_id
       where e.voided_at is null and e.to_day >= ${addDays(today, -60)}
       order by e.from_day desc limit 100
    `),
    db.execute<{ id: string; name: string }>(sql`
      select id, name from pos_products where kind = 'PRODUCT' and coalesce(category, '') <> 'Test' order by name
    `),
  ]);
  const base = {
    today,
    events: events.rows.map((e) => ({ id: e.id, kind: e.kind, label: e.label, fromDay: e.from_day, toDay: e.to_day, posProductId: e.pos_product_id, productName: e.name, fromHour: e.from_hour })),
    products: products.rows,
  };
  if (!runRow) {
    return { run: null, days: [], hours: [], selectedDay: null, items: [], accuracy: [], backtests: [], todaySold: new Map(), todayHours: [], ...base };
  }
  const runId = runRow.id;
  const [dayPts, ctx, itemPts, bts, accuracy, sold] = await Promise.all([
    db.execute<{ day: string; metric: string } & Band3>(sql`
      select day, metric, p10, p50, p90 from forecast_points
       where run_id = ${runId} and series = 'total' and hour is null order by day
    `),
    db.select().from(forecastDayContext).where(sql`${forecastDayContext}.run_id = ${runId}`),
    db.execute<{ series: string; day: string } & Band3>(sql`
      select series, day, p10, p50, p90 from forecast_points
       where run_id = ${runId} and series like 'item:%' and hour is null and day < ${addDays(runRow.issuedOn, 7)}
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
        select o.business_date as day, coalesce(sum(p.amount_minor) filter (where p.method_type <> 5), 0)::bigint as actual
          from foodics_orders o join foodics_order_payments p on p.order_id = o.id
         where o.status in (4, 5) and o.business_date in (select day from fc)
         group by 1
      )
      select fc.day, fc.p10, fc.p50, fc.p90, act.actual from fc join act on act.day = fc.day
       where fc.day < ${today} order by fc.day desc limit 30
    `),
    db.execute<{ h: number; paid: string }>(sql`
      select extract(hour from coalesce(o.opened_at, o.closed_at) at time zone 'Asia/Riyadh')::int as h,
             coalesce(sum(p.amount_minor) filter (where p.method_type <> 5), 0)::bigint as paid
        from foodics_orders o join foodics_order_payments p on p.order_id = o.id
       where o.status in (4, 5) and o.business_date = ${today} and coalesce(o.opened_at, o.closed_at) is not null
       group by 1
    `),
  ]);

  const ctxOf = new Map(ctx.map((c) => [c.day, c.context as ForecastContext]));
  const net = dayPts.rows.filter((r) => r.metric === "NET_MINOR");
  const ord = new Map(dayPts.rows.filter((r) => r.metric === "ORDERS").map((r) => [r.day, band(r)]));
  const days: ForecastDay[] = net.map((r) => ({ day: r.day, ...band(r), orders: ord.get(r.day) ?? null, context: ctxOf.get(r.day) ?? null }));
  const selectedDay = opts.day && days.some((d) => d.day === opts.day) ? opts.day : days.find((d) => d.day >= today)?.day ?? days[0]?.day ?? null;

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
    ...base,
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
