/**
 * «ما وضعي الآن؟» — أربعةُ أرقامٍ من مصادرها القائمة، بلا حسابٍ ثانٍ:
 *
 *   رصيدُ البنك       ← `loadCashPosition` (آخرُ رصيدٍ ختاميّ في كشفٍ مسوّى)
 *   ما أدين به        ← `supplier-balance.service.ts` — المصدرُ الواحد لـ«كم أدين؟»
 *   ضريبةُ الإقرار    ← `loadVatDues` (ما يحسبه إقرارُ الضريبة نفسُه)، وفودكس شاهدٌ بجانبه
 *   النقد             ← ما قبضه فودكس نقداً ولم يدخل البنك، وما عُدّ في الصندوق آخرَ مرّة
 *
 * والنقدُ لا يُقال «في الصندوق»: كم بقي منه لا يُعرَف إلّا من صاحبه — صُرف منه أو أُخذ.
 * فيُقال ما قُبض وما عُدّ، ويُسأل عن الباقي.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { VatDue } from "@/lib/cash-outlook";
import type { BalanceTotals } from "@/lib/supplier-balances";
import { loadCashPosition } from "./briefing.service";
import { loadVatDues } from "./cash-outlook.service";
import { loadBalanceTotals, loadOverdueBalances, type OverdueBalance } from "./supplier-balance.service";

export interface TillRow {
  id: string;
  day: string;
  userName: string | null;
  deviceName: string | null;
  openingMinor: number | null;
  /** ما يتوقّعه فودكس في الدرج، وما عُدّ فيه، والفرق. `null` لم يُقرأ. */
  expectedMinor: number | null;
  countedMinor: number | null;
  varianceMinor: number | null;
  closed: boolean;
}

/** فرقُ صندوقٍ دون هذا «فكّة» لا يُقال. */
export const TILL_SMALL_MINOR = 20_00;

export interface FinancePosition {
  bank: { balanceMinor: number | null; asOf: string | null };
  suppliers: { totals: BalanceTotals; overdue: OverdueBalance[]; top: { supplierId: string; name: string; owedMinor: number }[] };
  vat: VatDue[];
  /** ضريبةُ مبيعات فودكس للربع الجاري — شاهدٌ بجانب رقم الإقرار. */
  cash: {
    /** ما قبضه فودكس نقداً منذ أوّل يوم، وهذا الشهر. */
    totalMinor: number; monthMinor: number; firstDay: string | null;
    /** إيداعاتٌ في الكشف من غير الشبكة — `0` لا إيداع. */
    lastTill: TillRow | null;
    months: { month: string; cashMinor: number; shortMinor: number; overMinor: number; tills: number; uncounted: number }[];
    recent: TillRow[];
  };
}

function tillRow(r: Record<string, unknown>): TillRow {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: String(r.id), day: String(r.business_date),
    userName: r.user_name === null ? null : String(r.user_name), deviceName: r.device_name === null ? null : String(r.device_name),
    openingMinor: n(r.opening_minor), expectedMinor: n(r.estimated_cash_minor), countedMinor: n(r.closing_minor), varianceMinor: n(r.variance_minor),
    closed: r.closed_at !== null,
  };
}

export async function loadTills(limit: number): Promise<TillRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select id, business_date, user_name, device_name, opening_minor, estimated_cash_minor, closing_minor, variance_minor, closed_at
      from foodics_tills order by business_date desc, opened_at desc nulls last limit ${limit}
  `);
  return rows.rows.map(tillRow);
}

export async function loadFinancePosition(): Promise<FinancePosition> {
  const [bank, balances, overdue, vat, cash, tillMonths, recent, names] = await Promise.all([
    loadCashPosition(),
    loadBalanceTotals(),
    loadOverdueBalances(),
    loadVatDues(),
    db.execute<{ month: string; cash: string; first_day: string | null }>(sql`
      select substr(p.business_date, 1, 7) as month, sum(p.amount_minor)::bigint as cash,
             (select min(business_date) from foodics_orders) as first_day
        from foodics_order_payments p join foodics_orders o on o.id = p.order_id
       where o.status in (4, 5) and p.method_type = 1 group by 1 order by 1
    `),
    db.execute<{ month: string; short: string; over: string; tills: number; uncounted: number }>(sql`
      select substr(business_date, 1, 7) as month,
             coalesce(-sum(variance_minor) filter (where variance_minor < 0), 0)::bigint as short,
             coalesce(sum(variance_minor) filter (where variance_minor > 0), 0)::bigint as over,
             count(*)::int as tills,
             /* صندوق أقفل بلا عدّ: المعدود صفر والمتوقّع مال — الفرق هنا «لم يعدّ» لا نقص */
             count(*) filter (where closed_at is not null and closing_minor = 0 and estimated_cash_minor > 0)::int as uncounted
        from foodics_tills group by 1
    `),
    loadTills(30),
    db.execute<{ id: string; name: string }>(sql`select id, name_ar as name from suppliers`),
  ]);
  const nameOf = new Map(names.rows.map((r) => [r.id, r.name]));
  const tillOf = new Map(tillMonths.rows.map((r) => [r.month, r]));
  const months = cash.rows.map((r) => {
    const t = tillOf.get(r.month);
    return { month: r.month, cashMinor: Number(r.cash), shortMinor: Number(t?.short ?? 0), overMinor: Number(t?.over ?? 0), tills: t?.tills ?? 0, uncounted: t?.uncounted ?? 0 };
  });
  return {
    bank: { balanceMinor: bank.balanceMinor, asOf: bank.asOf === null ? null : String(bank.asOf).slice(0, 10) },
    suppliers: {
      totals: balances.totals, overdue,
      top: balances.rows.filter((r) => r.owedMinor > 0).sort((a, b) => b.owedMinor - a.owedMinor).slice(0, 8)
        .map((r) => ({ supplierId: r.supplierId, name: nameOf.get(r.supplierId) ?? "مورّد", owedMinor: r.owedMinor })),
    },
    vat,
    cash: {
      totalMinor: months.reduce((s, m) => s + m.cashMinor, 0),
      monthMinor: months[months.length - 1]?.cashMinor ?? 0,
      firstDay: cash.rows[0]?.first_day ?? null,
      lastTill: recent.find((t) => t.closed) ?? null,
      months, recent,
    },
  };
}
