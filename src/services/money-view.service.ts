/**
 * ما تقرؤه صفحةُ «أين ذهب المال» — قراءةٌ وحدها.
 *
 * السؤالُ: من كلّ ريالٍ خرج من الحساب في هذه الفترة، أين ذهب؟ فيُقسَم
 * **الصادرُ كلُّه** — لا المصروفُ وحده — إلى أبوابٍ يُجمَع مجموعُها إلى
 * الصادر نفسه: مصروفاتٌ تشغيليّة بأبوابها، وسدادُ المورّدين وشراءُ البضاعة
 * (محسوبان في المشتريات)، وسحبُ المالك، والتحويلُ الداخليّ، وما لم يُصنَّف.
 * فلا يختفي مالٌ بين قسمين، ولا يُقرأ المصروفُ صادراً كاملاً.
 *
 * والبابُ يُقرأ بالقاعدة نفسها التي تقيّد بها المصروفات (`isExpenseCategory`
 * و`looksLikeGoodsPurchase`) — كان للرواتب رقمان في شاشتين حين اختلفتا.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { buildCashFlow, type CashFlow, type CashMovement } from "@/lib/cashflow";
import { buildProvenance, type Contribution, type Provenance } from "@/lib/provenance";
import { CATEGORY_LABEL, type TxCategory } from "@/lib/bank/rules";
import { isExpenseCategory, looksLikeGoodsPurchase } from "@/lib/expenses";

export type BucketKind = "expense" | "fees" | "purchases" | "owner" | "internal" | "unknown";

export interface OutBucket {
  key: string;
  kind: BucketKind;
  label: string;
  count: number;
  minor: number;
  href: string;
}

export interface MoneyView {
  /** الأشهر التي في الكشف — أحدثُها أوّلاً. */
  months: string[];
  txCount: number;
  firstDay: string | null;
  lastDay: string | null;
  /** التدفّق شهراً بشهر — للفترة كلّها دائماً، فالمقارنةُ بين الأشهر هي المقصود. */
  flow: CashFlow;
  /** في الفترة المختارة. */
  inMinor: number;
  outMinor: number;
  buckets: OutBucket[];
  unknown: { count: number; minor: number };
  /** «الصادر معروفُ الوجه» وما خارجه — ببيان المصدر. */
  outflow: Provenance;
  vat: { recoverableMinor: number; atRiskMinor: number; unknownInvoices: number };
}

const FEES: readonly TxCategory[] = ["POS_FEE", "POS_VAT", "BANK_FEE", "BANK_VAT"];

export async function loadMoneyView(month: string | null): Promise<MoneyView> {
  const inPeriod = month ? sql`to_char(value_date, 'YYYY-MM') = ${month}` : sql`true`;

  const [head, movements, debits, credits] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      select
        (select count(*)::int from bank_transactions)                                as tx,
        (select to_char(min(value_date), 'YYYY-MM-DD') from bank_transactions)       as first_day,
        (select to_char(max(value_date), 'YYYY-MM-DD') from bank_transactions)       as last_day,
        (select coalesce(sum(vat_minor),0)::bigint from invoices
           where input_vat_status='ELIGIBLE')                                        as recoverable,
        (select coalesce(sum(vat_minor),0)::bigint from invoices
           where input_vat_status='NOT_ELIGIBLE' and vat_minor > 0)                  as at_risk,
        (select count(*)::int from invoices where input_vat_status='UNKNOWN')        as vat_unknown
    `),
    db.execute<{ month: string; direction: string; category: string; amount: string; n: number }>(sql`
      select to_char(value_date, 'YYYY-MM') as month,
             direction::text as direction,
             category::text as category,
             sum(amount_minor)::bigint as amount,
             count(*)::int as n
        from bank_transactions
       group by 1, 2, 3
    `),
    /* الصادرُ كلُّه في الفترة — والوصفُ لأنّ «شراء بضاعة» يُقرأ منه */
    db.execute<{ category: string; amount_minor: string; description: string | null; beneficiary_raw: string | null }>(sql`
      select category::text as category, amount_minor, description, beneficiary_raw
        from bank_transactions
       where direction = 'DEBIT' and ${inPeriod}
    `),
    db.execute<{ s: string }>(sql`
      select coalesce(sum(amount_minor), 0)::bigint as s
        from bank_transactions
       where direction = 'CREDIT' and ${inPeriod}
    `),
  ]);

  const h = head.rows[0] ?? {};
  const flow = buildCashFlow(
    movements.rows.map<CashMovement>((r) => ({
      month: r.month,
      direction: r.direction === "CREDIT" ? "CREDIT" : "DEBIT",
      category: r.category as TxCategory,
      amountMinor: Number(r.amount),
      count: Number(r.n),
    })),
  );

  const buckets = new Map<string, OutBucket>();
  const add = (key: string, kind: BucketKind, label: string, href: string, minor: number) => {
    const b = buckets.get(key) ?? { key, kind, label, count: 0, minor: 0, href };
    b.count++;
    b.minor += minor;
    buckets.set(key, b);
  };

  let outMinor = 0;
  for (const r of debits.rows) {
    const c = r.category as TxCategory;
    const minor = Number(r.amount_minor);
    outMinor += minor;
    if (c === "UNKNOWN") add("unknown", "unknown", "لم يُصنَّف بعد", "/bank?show=unknown#transactions", minor);
    else if (c === "SUPPLIER") add("purchases", "purchases", "المورّدون — سدادٌ وشراءُ بضاعة", "/suppliers", minor);
    else if (c === "PERSONAL") add("owner", "owner", "سحبُ المالك — تحويلاتٌ شخصيّة", "/bank?show=all#transactions", minor);
    else if (c === "INTERNAL" || c === "POS_SETTLEMENT") add("internal", "internal", "حركةٌ تشغيليّة بين الحسابات", "/bank?show=all#transactions", minor);
    else if (FEES.includes(c)) add("fees", "fees", "رسومُ البنك والشبكة وضرائبُها", "/bank?show=fees#transactions", minor);
    /* الوصفُ الصريح يُقدَّم على التصنيف المستنتَج — «شراء بضاعة» مشترياتٌ لا راتب */
    else if (isExpenseCategory(c) && looksLikeGoodsPurchase(r.description ?? "", r.beneficiary_raw)) {
      add("purchases", "purchases", "المورّدون — سدادٌ وشراءُ بضاعة", "/suppliers", minor);
    } else add(c, "expense", CATEGORY_LABEL[c] ?? c, month ? `/money/expenses?month=${month}` : "/money/expenses", minor);
  }

  const unknownBucket = buckets.get("unknown");
  const unknown = { count: unknownBucket?.count ?? 0, minor: unknownBucket?.minor ?? 0 };

  /*
    بيانُ المصدر للفترة نفسها — كان يُبنى للفترة كلّها وحدها، فمن اختار
    شهراً قرأ رقماً لشهرٍ وبيانَ مصدرٍ لخمسة.
  */
  const contributions: Contribution[] = [{
    id: "bank-known",
    label: "حركات معروفة الوجه",
    count: debits.rows.length - unknown.count,
    amountMinor: outMinor - unknown.minor,
    unit: "حركة",
    included: true,
  }];
  if (unknown.count > 0) {
    contributions.push({
      id: "bank-unknown",
      label: "حركات لم يُعرف وجهها",
      count: unknown.count,
      /* مبلغُها معلوم وإن جُهل وجهُها — فيُذكر */
      amountMinor: unknown.minor,
      unit: "حركة",
      included: false,
      reason: "خارج الرقم حتى تُصنَّف — ومبلغها معلوم",
      href: "/bank?show=unknown#transactions",
    });
  }

  return {
    months: [...flow.months.map((m) => m.month)].reverse(),
    txCount: Number(h.tx ?? 0),
    firstDay: h.first_day ? String(h.first_day) : null,
    lastDay: h.last_day ? String(h.last_day) : null,
    flow,
    inMinor: Number(credits.rows[0]?.s ?? 0),
    outMinor,
    buckets: [...buckets.values()].filter((b) => b.kind !== "unknown").sort((a, b) => b.minor - a.minor),
    unknown,
    outflow: buildProvenance(contributions),
    vat: {
      recoverableMinor: Number(h.recoverable ?? 0),
      atRiskMinor: Number(h.at_risk ?? 0),
      unknownInvoices: Number(h.vat_unknown ?? 0),
    },
  };
}
