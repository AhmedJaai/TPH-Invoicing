/**
 * الخصوماتُ المتكرّرة من القاعدة — صادرُ البنك بيومه في الرياض، والمتكرّرُ
 * المسجَّل، وقراراتُ صاحبها. والكشفُ في `lib/recurring-detect.ts` الخالصة.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { recurringExpenses } from "@/db/schema";
import { isTxCategory } from "@/lib/bank/rules";
import { asCadence } from "@/lib/cash-outlook";
import { monthlyShare } from "@/lib/expenses";
import {
  detectRecurring, noteKey, registeredFor, suggestionKey,
  type DebitTx, type RecurringSeries, type RegisteredRecurring, type SeriesNote,
} from "@/lib/recurring-detect";
import { silencedKeys } from "@/lib/signal-decisions";
import { todayInRiyadh } from "@/lib/riyadh-time";

/** كم شهراً من الكشف يُقرأ — سنةٌ تكفي لتُرى السلسلة وعادتُها. */
const WINDOW_MONTHS = 13;
/** ولعدّاد القشرة (يُحسب مع كلّ صفحة) ستّةُ أشهر. */
const WATCH_WINDOW_MONTHS = 6;

export interface SeriesView extends RecurringSeries {
  /** المتكرّرُ المسجَّل الذي يقابلها — `null` لم يُسجَّل. */
  registered: RegisteredRecurring | null;
  /** أسكت صاحبُها اقتراحَ تسجيلها. */
  suggestionSilenced: boolean;
  /** الملاحظاتُ التي لم تُسكَت، بمفاتيحها. */
  openNotes: { key: string; note: SeriesNote }[];
}

export interface RecurringWatch {
  lastBankDay: string | null;
  series: SeriesView[];
  /** مجموعُ عادات السلاسل × ١٢ — تقديرٌ سنويّ. */
  annualMinor: number;
}

async function loadDebits(months: number): Promise<{ rows: DebitTx[]; lastBankDay: string | null }> {
  const [rows, last] = await Promise.all([
    db.execute<{ id: string; day: string; amount_minor: number; category: string; description: string | null; beneficiary_raw: string | null }>(sql`
      select id, to_char(value_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as day,
             amount_minor, category::text as category, description, beneficiary_raw
        from bank_transactions
       where direction = 'DEBIT'
         and category not in ('SUPPLIER', 'INTERNAL', 'PERSONAL', 'UNKNOWN', 'BANK_FEE', 'BANK_VAT', 'POS_FEE', 'POS_VAT', 'POS_SETTLEMENT')
         and value_date >= (now() - make_interval(months => ${months}))
       order by value_date
    `),
    db.execute<{ day: string | null }>(sql`
      select to_char(max(value_date at time zone 'Asia/Riyadh'), 'YYYY-MM-DD') as day from bank_transactions
    `),
  ]);
  return {
    rows: rows.rows.flatMap((r) =>
      isTxCategory(r.category)
        ? [{ id: r.id, day: r.day, amountMinor: Number(r.amount_minor), category: r.category, description: r.description, beneficiaryRaw: r.beneficiary_raw }]
        : [],
    ),
    lastBankDay: last.rows[0]?.day ?? null,
  };
}

async function loadRegistered(): Promise<RegisteredRecurring[]> {
  const rows = await db.select().from(recurringExpenses).where(eq(recurringExpenses.isActive, true));
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    category: r.category,
    monthlyMinor: monthlyShare({ amountMinor: r.amountMinor, cadence: asCadence(r.cadence) }),
  }));
}

async function loadSilenced(): Promise<Set<string>> {
  const res = await db.execute<{ key: string; decision: string }>(sql`
    select key, decision from alert_resolutions where key like 'recurring-%'
  `);
  return silencedKeys(res.rows, todayInRiyadh());
}

function view(series: RecurringSeries[], registered: readonly RegisteredRecurring[], silenced: ReadonlySet<string>): SeriesView[] {
  return series.map((s) => ({
    ...s,
    registered: registeredFor(s, registered),
    suggestionSilenced: silenced.has(suggestionKey(s)),
    openNotes: s.notes.map((note) => ({ key: noteKey(s, note), note })).filter((n) => !silenced.has(n.key)),
  }));
}

export async function loadRecurringWatch(): Promise<RecurringWatch> {
  const [{ rows, lastBankDay }, registered, silenced] = await Promise.all([
    loadDebits(WINDOW_MONTHS), loadRegistered(), loadSilenced(),
  ]);
  const series = view(detectRecurring(rows, lastBankDay), registered, silenced);
  return { lastBankDay, series, annualMinor: series.reduce((s, x) => s + x.annualMinor, 0) };
}

export interface RecurringAnomaly {
  key: string;
  label: string;
  kind: "TWICE" | "ROSE";
  /** الزائدُ: الخصمُ الثاني، أو فرقُ الارتفاع. */
  amountMinor: number;
  day: string;
}

/** ما يدخل «يحتاج قرارك»: خصمٌ تكرّر في شهره أو ارتفع — والغيابُ في صفحته (قد يكون إلغاءً مقصوداً). */
export async function loadRecurringAnomalies(): Promise<RecurringAnomaly[]> {
  const [{ rows, lastBankDay }, silenced] = await Promise.all([loadDebits(WATCH_WINDOW_MONTHS), loadSilenced()]);
  const out: RecurringAnomaly[] = [];
  for (const s of detectRecurring(rows, lastBankDay)) {
    for (const note of s.notes) {
      const key = noteKey(s, note);
      if (silenced.has(key)) continue;
      if (note.kind === "TWICE") out.push({ key, label: s.label, kind: "TWICE", amountMinor: note.excessMinor, day: note.extra[0]?.day ?? s.lastDay });
      if (note.kind === "ROSE") out.push({ key, label: s.label, kind: "ROSE", amountMinor: note.diffMinor, day: note.day });
    }
  }
  return out.sort((a, b) => b.amountMinor - a.amountMinor);
}
