/**
 * ما قبضه فودكس أمام ما دخل البنك — يجلب الطرفين من القاعدة، والحكمُ في
 * `lib/foodics/takings.ts` الخالصة. قراءةٌ وحدها: لا يكتب في البنك ولا في الإقرار.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ORDER_STATUS, PAYMENT_TYPE } from "@/lib/foodics/types";
import {
  compareCardTakings, summariseCash,
  type CardComparison, type CashMonth, type CashMonthInput,
} from "@/lib/foodics/takings";
import { silencedKeys } from "@/lib/signal-decisions";
import { todayInRiyadh } from "@/lib/riyadh-time";
import { loadPosWatch } from "./pos-watch.service";

/** مفتاحُ قرار الإنسان في دفعةٍ فرقُها ظاهر — يُشتقّ من تاريخها ولا يُولَّد. */
export function cardGapKey(day: string): string {
  return `foodics-card:${day}`;
}

/** ما أسكته صاحبُه من ملاحظات فودكس ببادئتها. */
export async function loadFoodicsSilenced(prefix: "foodics-card" | "foodics-purchase"): Promise<Set<string>> {
  const rows = (await db.execute<{ key: string; decision: string }>(sql`
    select key, decision from alert_resolutions where key like ${`${prefix}:%`}
  `)).rows;
  return silencedKeys(rows, todayInRiyadh());
}

export interface FoodicsTakings {
  /** أيعرف فودكس شيئاً؟ — قبل أن يُعرَض رقم. */
  hasOrders: boolean;
  firstDay: string | null;
  lastDay: string | null;
  lastBankDay: string | null;
  card: CardComparison;
  cash: CashMonth[];
  /** دفعاتُ بطاقةٍ بلا وقتٍ مسجَّل — لا موضعَ لها في ترتيب الزمن، فخرجت من المقارنة. */
  untimedCardPayments: number;
}

/** الطلبُ المغلق والمرتجَع وحدهما مالٌ وقع — الملغى لم يُقبَض عنه شيء. */
const SETTLED = sql`o.status in (${ORDER_STATUS.CLOSED}, ${ORDER_STATUS.RETURNED})`;

export async function loadFoodicsTakings(): Promise<FoodicsTakings> {
  const [pos, cardDays, span, monthly, tills, bankOther, typed] = await Promise.all([
    loadPosWatch(),
    db.execute<{ at_ms: string | null; amount_minor: number }>(sql`
      select (extract(epoch from p.added_at) * 1000)::bigint as at_ms, p.amount_minor
        from foodics_order_payments p join foodics_orders o on o.id = p.order_id
       where ${SETTLED} and p.method_type = ${PAYMENT_TYPE.CARD}
    `),
    db.execute<{ first: string | null; last: string | null; n: number; until_ms: string | null }>(sql`
      select min(coalesce(to_char(p.added_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD'), p.business_date)) as first,
             max(coalesce(to_char(p.added_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD'), p.business_date)) as last,
             count(*)::int as n,
             (select (extract(epoch from max(source_updated_at)) * 1000)::bigint from foodics_orders) as until_ms
        from foodics_order_payments p join foodics_orders o on o.id = p.order_id
       where ${SETTLED}
    `),
    db.execute<{ month: string; cash: string; house: string; other: string }>(sql`
      select substr(p.business_date, 1, 7) as month,
             coalesce(sum(p.amount_minor) filter (where p.method_type = ${PAYMENT_TYPE.CASH}), 0)::bigint as cash,
             coalesce(sum(p.amount_minor) filter (where p.method_type = ${PAYMENT_TYPE.HOUSE_ACCOUNT}), 0)::bigint as house,
             coalesce(sum(p.amount_minor) filter (where p.method_type not in (${PAYMENT_TYPE.CASH}, ${PAYMENT_TYPE.CARD}, ${PAYMENT_TYPE.HOUSE_ACCOUNT})), 0)::bigint as other
        from foodics_order_payments p join foodics_orders o on o.id = p.order_id
       where ${SETTLED}
       group by 1
    `),
    db.execute<{ month: string; variance: string | null }>(sql`
      select substr(business_date, 1, 7) as month, sum(variance_minor)::bigint as variance
        from foodics_tills where closed_at is not null and variance_minor is not null
       group by 1
    `),
    db.execute<{ month: string; total: string }>(sql`
      select to_char(value_date at time zone 'Asia/Riyadh', 'YYYY-MM') as month, sum(amount_minor)::bigint as total
        from bank_transactions
       where direction = 'CREDIT' and category <> 'POS_SETTLEMENT'
       group by 1
    `),
    db.execute<{ month: string; cash_sales_gross_minor: number }>(sql`select month, cash_sales_gross_minor from vat_period_inputs`),
  ]);

  const firstDay = span.rows[0]?.first ?? null;
  const lastDay = span.rows[0]?.last ?? null;
  const timed = cardDays.rows.flatMap((r) => (r.at_ms === null ? [] : [{ atMs: Number(r.at_ms), amountMinor: Number(r.amount_minor) }]));
  const card = compareCardTakings(
    timed,
    pos.days.filter((d) => d.batches > 0).map((d) => ({ day: d.day, settlementMinor: d.settlementMinor, byValueDate: d.byValueDate })),
    pos.lastBankDay,
    span.rows[0]?.until_ms ? Number(span.rows[0].until_ms) : null,
  );

  const variance = new Map(tills.rows.map((r) => [r.month, r.variance === null ? null : Number(r.variance)]));
  const other = new Map(bankOther.rows.map((r) => [r.month, Number(r.total)]));
  const typedBy = new Map(typed.rows.map((r) => [r.month, Number(r.cash_sales_gross_minor)]));
  const inputs: CashMonthInput[] = monthly.rows.map((r) => ({
    month: r.month,
    cashMinor: Number(r.cash),
    houseAccountMinor: Number(r.house),
    otherMinor: Number(r.other),
    tillVarianceMinor: variance.get(r.month) ?? null,
    bankOtherCreditsMinor: other.get(r.month) ?? 0,
    typedForVatMinor: typedBy.get(r.month) ?? null,
  }));

  return {
    hasOrders: Number(span.rows[0]?.n ?? 0) > 0,
    firstDay, lastDay,
    lastBankDay: pos.lastBankDay,
    card,
    cash: summariseCash(inputs),
    untimedCardPayments: cardDays.rows.length - timed.length,
  };
}
