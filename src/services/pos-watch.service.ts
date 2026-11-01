/**
 * تسوياتُ الشبكة من القاعدة — حركاتُ `POS_*` بيوم قيمتها في الرياض، وقراراتُ
 * صاحبها في ما غاب. والحسابُ في `lib/bank/pos-watch.ts` الخالصة.
 */
import { cache } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  feeRose, missingSettlementKey, missingSettlements, monthlyFees, settlementDays,
  type MissingSettlement, type MonthFees, type PosKind, type PosTx, type SettlementDay,
} from "@/lib/bank/pos-watch";
import { silencedKeys } from "@/lib/signal-decisions";
import { todayInRiyadh, isoDay } from "@/lib/riyadh-time";

/** كم يوماً إلى الوراء يُسأل فيه عن تسويةٍ غائبة — ما قبله تاريخٌ لا عمل. */
export const MISSING_LOOKBACK_DAYS = 45;

export interface PosWatch {
  txCount: number;
  lastBankDay: string | null;
  months: MonthFees[];
  days: SettlementDay[];
  missing: MissingSettlement[];
  /** ما أسكته صاحبُه من الأيّام الغائبة — يُعرض مطويّاً ويُعاد. */
  silencedMissing: string[];
  /** آخرُ شهرٍ اكتمل في الكشف ارتفعت نسبتُه عن عادته — `null` إن لم ترتفع أو أُسكتت. */
  feeRise: MonthFees | null;
}

function isPosKind(v: string): v is PosKind {
  return v === "POS_SETTLEMENT" || v === "POS_FEE" || v === "POS_VAT";
}

export function feeRiseKey(month: string): string {
  return `pos-fee-rise:${month}`;
}

/** حركاتُ الشبكة — كلُّها، أو من يومٍ بعينه (لعدّاد القشرة الذي يُحسب مع كلّ صفحة). */
/*
  مخبوءةٌ في الطلب الواحد (`cache`): القشرةُ تسأل عن التسويات الغائبة وعن مقارنة البطاقات
  في رسمٍ واحد، والاثنان يطلبان نافذةَ القشرة نفسَها (`shellPosSince`) فتُجلب مرّةً.
*/
const loadPosRows = cache(async (sinceDay: string | null): Promise<{ rows: PosTx[]; lastBankDay: string | null }> => {
  const since = sinceDay ? sql`and (value_date at time zone 'Asia/Riyadh')::date >= ${sinceDay}::date` : sql.empty();
  const [rows, last] = await Promise.all([
    db.execute<{ id: string; day: string; amount_minor: number; direction: string; category: string; description: string | null; transaction_type: string | null }>(sql`
      select id, to_char(value_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as day,
             amount_minor, direction::text as direction, category::text as category, description, transaction_type
        from bank_transactions
       where category in ('POS_SETTLEMENT', 'POS_FEE', 'POS_VAT') ${since}
       order by value_date
    `),
    db.execute<{ day: string | null }>(sql`
      select to_char(max(value_date at time zone 'Asia/Riyadh'), 'YYYY-MM-DD') as day from bank_transactions
    `),
  ]);
  return {
    rows: rows.rows.flatMap((r) =>
      isPosKind(r.category)
        ? [{
            id: r.id,
            day: r.day,
            amountMinor: Number(r.amount_minor),
            direction: r.direction === "CREDIT" ? ("CREDIT" as const) : ("DEBIT" as const),
            kind: r.category,
            description: r.description,
            transactionType: r.transaction_type,
          }]
        : [],
    ),
    lastBankDay: last.rows[0]?.day ?? null,
  };
});

/**
 * نافذةُ الشبكة في رسم القشرة: أقدمُ يومٍ يُسأل عن تسويته الغائبة وستّون قبله لعادته.
 * وهي أوسعُ من نافذة مقارنة البطاقات، فتكفيهما معاً.
 */
export function shellPosSince(today: string = todayInRiyadh()): string {
  const [y, m, d] = today.split("-").map(Number);
  return isoDay(new Date(Date.UTC(y, m - 1, d - (MISSING_LOOKBACK_DAYS + 60))));
}

async function loadDecisions(prefixes: readonly string[]): Promise<{ key: string; decision: string }[]> {
  const like = sql.join(prefixes.map((p) => sql`key like ${`${p}:%`}`), sql` or `);
  const res = await db.execute<{ key: string; decision: string }>(sql`
    select key, decision from alert_resolutions where ${like}
  `);
  return res.rows;
}

/** آخرُ شهرٍ اكتمل في الكشف — الشهرُ الجاري نسبتُه تتحرّك، فلا يُنبَّه عليها. */
function lastCompleteMonth(months: readonly MonthFees[], lastBankDay: string | null): MonthFees | null {
  if (!lastBankDay) return null;
  return months.find((m) => m.month < lastBankDay.slice(0, 7)) ?? null;
}

export async function loadPosWatch(): Promise<PosWatch> {
  const [{ rows, lastBankDay }, decisions] = await Promise.all([
    loadPosRows(null),
    loadDecisions(["pos-missing", "pos-fee-rise"]),
  ]);
  const silenced = silencedKeys(decisions, todayInRiyadh());
  const months = monthlyFees(rows);
  const complete = lastCompleteMonth(months, lastBankDay);
  const all = missingSettlements(rows, { lastBankDay, lookbackDays: MISSING_LOOKBACK_DAYS });
  return {
    txCount: rows.length,
    lastBankDay,
    months,
    days: settlementDays(rows),
    missing: all.filter((m) => !silenced.has(missingSettlementKey(m.day))),
    silencedMissing: all.filter((m) => silenced.has(missingSettlementKey(m.day))).map((m) => m.day),
    feeRise: complete && feeRose(complete) && !silenced.has(feeRiseKey(complete.month)) ? complete : null,
  };
}

/**
 * أيّامُ التسوية وحدها — لمقارنة بطاقات فودكس بدفعات البنك.
 *
 * ‏`sinceDay` يقصر الجلبَ على تاريخ قيمةٍ منه فصاعداً: التسويةُ لا تصل البنكَ قبل
 * يوم بيعها، فكلُّ دفعةٍ ليوم بيعٍ في النافذة تاريخُ قيمتها في النافذة. كانت
 * المقارنةُ تستدعي `loadPosWatch()` فتجلب حركاتِ الشبكة **منذ البداية** (٣٨٥٠ صفّاً)
 * في كلّ رسمٍ للقشرة، ثمّ ترمي ما قبل النافذة — وهي لا تحتاج رسومَه ولا قراراته.
 */
export async function loadSettlementDays(sinceDay: string | null): Promise<{ days: SettlementDay[]; lastBankDay: string | null }> {
  /* داخل نافذة القشرة تُقرأ نافذتُها نفسُها — فلا يُجلب الكشفُ مرّتين في رسمٍ واحد */
  const shell = shellPosSince();
  const { rows, lastBankDay } = await loadPosRows(sinceDay !== null && sinceDay >= shell ? shell : sinceDay);
  return { days: settlementDays(rows), lastBankDay };
}

/**
 * ما يدخل «يحتاج قرارك» من الشبكة — بنافذةٍ قصيرة: يُحسب مع كلّ صفحة، فلا
 * يُقرأ له تاريخُ السنين. والنافذةُ تكفي الغيابَ (ستّةُ أسابيع عادةً قبل
 * أقدم يومٍ يُسأل عنه)؛ وارتفاعُ الرسم في صفحته لأنّ عادتَه تُقرأ من أشهر.
 */
export async function loadMissingSettlementFacts(): Promise<MissingSettlement[]> {
  const today = todayInRiyadh();
  const [{ rows, lastBankDay }, decisions] = await Promise.all([loadPosRows(shellPosSince(today)), loadDecisions(["pos-missing"])]);
  return missingSettlements(rows, {
    lastBankDay,
    ignored: silencedKeys(decisions, today),
    lookbackDays: MISSING_LOOKBACK_DAYS,
  });
}
