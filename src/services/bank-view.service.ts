/**
 * ما تقرؤه صفحةُ «حركة البنك» — قراءةٌ وحدها، لا كتابة.
 *
 * نُقلت الاستعلاماتُ من الصفحة إلى هنا كي تبقى الصفحةُ ترتيباً لما يُعرَض.
 * والشروطُ كما كانت حرفاً بحرف: طابورُ الصفحة يبدأ من `pendingDecision()`
 * نفسِه الذي يعدّ به «يحتاج قرارك»، والتجميعُ بـ`groupByIdentity` نفسِه
 * الذي يتحقّق به الخادمُ قبل الكتابة — فما تراه الشاشةُ مجموعةً يراه
 * الخادمُ مجموعة.
 */
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { alertResolutions, bankTransactions, suppliers } from "@/db/schema";
import { pendingDecision } from "@/lib/bank/pending";
import { toCanonical, type CanonicalTransaction } from "@/lib/bank/canonical";
import { groupByIdentity } from "@/lib/bank/pattern";
import type { TxCategory } from "@/lib/bank/rules";
import { findDoublePaid, partitionDoublePaid, type DoublePaidTx } from "@/lib/bank/double-paid";
import { SETTLED_TOLERANCE_MINOR } from "@/lib/supplier-balances";
import { loadSupplierBalances } from "@/services/supplier-balance.service";
import type { QueueGroup, QueueItem, QueueReason } from "@/components/reconcile-queue";
import type { MatchExplanation } from "@/components/match-explain";

/* ─────────────────────────── التغطية ─────────────────────────── */

export interface BankCoverage {
  txCount: number;
  firstDay: string | null;
  lastDay: string | null;
  /** إيداعاتُ الشبكة — من أين يدخل المال، لا «مبيعات». */
  settledMinor: number;
  /** فواتيرُ مفتوحة — لمدخل «طريقة سداد أخرى» تحت الاستيراد. */
  openInvoices: number;
}

export async function loadBankCoverage(): Promise<BankCoverage> {
  const r = (await db.execute<Record<string, unknown>>(sql`
    select
      (select count(*)::int from bank_transactions)                                as tx,
      (select to_char(min(value_date), 'YYYY-MM-DD') from bank_transactions)       as first_day,
      (select to_char(max(value_date), 'YYYY-MM-DD') from bank_transactions)       as last_day,
      (select coalesce(sum(amount_minor),0)::bigint from bank_transactions
        where direction = 'CREDIT' and category = 'POS_SETTLEMENT')               as settled,
      (select count(*)::int from invoices i
        where i.total_minor > coalesce((select sum(pa.amount_minor)::int
          from payment_allocations pa where pa.invoice_id = i.id), 0) + ${SETTLED_TOLERANCE_MINOR}) as open
  `)).rows[0] ?? {};
  return {
    txCount: Number(r.tx ?? 0),
    firstDay: r.first_day ? String(r.first_day) : null,
    lastDay: r.last_day ? String(r.last_day) : null,
    settledMinor: Number(r.settled ?? 0),
    openInvoices: Number(r.open ?? 0),
  };
}

/* ─────────────────────────── الأدلّة ─────────────────────────── */

/**
 * أدلّةُ المطابقة من عمود JSON — تُقرأ حقلاً حقلاً لا بـ`as`.
 * ما لم يكن بالشكل المتوقَّع يسقط، ولا يُعرَض نصٌّ ليس نصّاً.
 */
export function readEvidence(v: unknown): MatchExplanation["evidence"] {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : undefined);
  return {
    تصنيف: typeof o["تصنيف"] === "string" ? o["تصنيف"] : undefined,
    مستفيد: strings(o["مستفيد"]),
    مطابقة: strings(o["مطابقة"]),
    درجةالمستفيد: typeof o["درجةالمستفيد"] === "number" ? o["درجةالمستفيد"] : undefined,
  };
}

/* ─────────────────────────── الطابور ─────────────────────────── */

export interface BankQueue {
  groups: QueueGroup[];
  /** معرّفاتُ ما في طابور هذه الصفحة — ليقول السجلُّ «في الطابور أعلاه». */
  queuedIds: Set<string>;
  suppliers: { id: string; nameAr: string }[];
}

export async function loadBankQueue(): Promise<BankQueue> {
  const [supplierRows, balances, pending] = await Promise.all([
    db.select({ id: suppliers.id, nameAr: suppliers.nameAr })
      .from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.nameAr)),

    /*
      ما على كلّ مورّد الآن — ليُعرَض قبل السداد على حسابه لا بعده، ومن
      المصدر الواحد لـ«عليك».
    */
    loadSupplierBalances(db),

    db.select({
      id: bankTransactions.id,
      valueDate: bankTransactions.valueDate,
      amountMinor: bankTransactions.amountMinor,
      direction: bankTransactions.direction,
      description: bankTransactions.description,
      beneficiaryRaw: bankTransactions.beneficiaryRaw,
      matchEvidence: bankTransactions.matchEvidence,
      matchOutcome: bankTransactions.matchOutcome,
      matchDisposition: bankTransactions.matchDisposition,
      supplierId: bankTransactions.supplierId,
      transactionType: bankTransactions.transactionType,
    })
      .from(bankTransactions)
      /*
        الأساسُ مشتركٌ مع «يحتاج قرارك» — `pendingDecision()` — وما بعده
        خاصٌّ بهذه الشاشة: الجهةُ المجهولة، وسدادُ المورّد الذي لم يُعرَف
        مورّدُه أو وقف عند ترجيح. والأساسُ يُستدعى ولا يُنسَخ.
      */
      .where(sql`${pendingDecision()}
        and (
          ${bankTransactions.category} = 'UNKNOWN'
          or (${bankTransactions.category} = 'SUPPLIER' and (
                ${bankTransactions.supplierId} is null
                or ${bankTransactions.matchDisposition} in ('SUGGEST','REVIEW')
             ))
        )`)
      .orderBy(desc(bankTransactions.amountMinor))
      /* الوحدةُ المجموعةُ لا الحركة: ستّون حركةً قد تكون ثماني مجموعات */
      .limit(400),
  ]);

  const supplierName = new Map(supplierRows.map((s) => [s.id, s.nameAr]));
  const outstanding = new Map(balances.filter((b) => b.owedMinor > 0).map((b) => [b.supplierId, b.owedMinor]));

  type Row = (typeof pending)[number];

  /** يترجم ما قرّره المحرّك إلى سببٍ يُقرأ. */
  function reasonOf(t: Row): QueueReason {
    if (t.matchOutcome === "PARTIAL_PAYMENT") return "PARTIAL_PAYMENT";
    if (t.matchOutcome === "OVERPAYMENT") return "OVERPAYMENT";
    if (t.matchOutcome === "AMOUNT_MISMATCH") return "AMOUNT_MISMATCH";
    /* «المورّد معروف ولا فاتورة» سببٌ قائم بذاته لا «مرشّحان متقاربان» */
    if (t.matchOutcome === "KNOWN_SUPPLIER_NO_INVOICE") return "KNOWN_SUPPLIER_NO_INVOICE";
    if (t.matchDisposition === "SUGGEST") return "SUGGESTED";
    if (t.supplierId === null) return "UNKNOWN_ENTITY";
    return "CLOSE_CANDIDATES";
  }

  /*
    الحركة تُحوَّل مرّةً واحدة، ويُقرأ منها العرضُ والتجميع معاً. و`beneficiary_raw`
    ملوَّثٌ في الصفوف القديمة باسم المورّد الذي طابقه نظامُنا — فلا يُعرَض خاماً.
  */
  const canonical = new Map(pending.map((t) => [t.id, canonicalOf(t)]));

  const toItem = (t: Row): QueueItem => {
    const ev = readEvidence(t.matchEvidence);
    return {
      id: t.id,
      date: t.valueDate.toISOString().slice(0, 10),
      amountMinor: t.amountMinor,
      direction: t.direction,
      description: (t.description ?? "").slice(0, 160),
      beneficiaryRaw: canonical.get(t.id)?.beneficiary ?? null,
      reason: reasonOf(t),
      guessName: t.supplierId ? supplierName.get(t.supplierId) ?? null : null,
      guessKind: null,
      why: [ev?.تصنيف, ...(ev?.مستفيد ?? []), ...(ev?.مطابقة ?? [])]
        .filter((x): x is string => Boolean(x))
        .slice(0, 4),
    };
  };

  const { groups: rawGroups, ungrouped } = groupByIdentity(
    pending,
    (t) => canonical.get(t.id)!,
    (t) => t.amountMinor,
  );

  const titleOf = (t: Row) =>
    canonical.get(t.id)?.beneficiary?.trim()
    || (t.description ?? "").trim().slice(0, 70)
    || "بلا وصف";

  const groups: QueueGroup[] = [
    ...rawGroups.map((g) => {
      const items = g.items.map(toItem);
      const supplierIds = new Set(g.items.map((t) => t.supplierId));
      const only = supplierIds.size === 1 ? [...supplierIds][0] : null;
      return {
        key: g.key,
        identityLabel: g.identity.label,
        title: titleOf(g.items[0]),
        totalMinor: g.totalMinor,
        items,
        guessName: only ? supplierName.get(only) ?? null : null,
        why: items[0]?.why ?? [],
        supplierId: only,
        supplierName: only ? supplierName.get(only) ?? null : null,
        outstandingMinor: only ? outstanding.get(only) ?? 0 : undefined,
      };
    }),
    /* ما لا هويّة له يُعرَض على حدة ولا يُدسّ في مجموعة — يُحسَم وحده */
    ...ungrouped.map((t) => ({
      key: `bare:${t.id}`,
      identityLabel: "لا هويّة لها — تُحسم وحدها",
      title: titleOf(t),
      totalMinor: t.amountMinor,
      items: [toItem(t)],
      guessName: t.supplierId ? supplierName.get(t.supplierId) ?? null : null,
      why: [],
    })),
  ];

  return { groups, queuedIds: new Set(pending.map((t) => t.id)), suppliers: supplierRows };
}

/* ─────────────────────────── مالٌ خرج مرّتين ─────────────────────────── */

/** ما لم يُحسَم من «مالٌ خرج مرّتين» — والحسمُ في موضعه الواحد («يحتاج قرارك»). */
export async function countOpenDoublePaid(): Promise<number> {
  const outgoing = await db.select({
    id: bankTransactions.id,
    valueDate: bankTransactions.valueDate,
    amountMinor: bankTransactions.amountMinor,
    description: bankTransactions.description,
    beneficiaryRaw: bankTransactions.beneficiaryRaw,
    category: bankTransactions.category,
    operationRef: bankTransactions.operationRef,
  })
    .from(bankTransactions)
    .where(eq(bankTransactions.direction, "DEBIT"));

  const found = findDoublePaid(outgoing.map((r): DoublePaidTx => ({ ...r, direction: "DEBIT" })));
  if (found.length === 0) return 0;
  const decisions = new Map(
    (await db.select({ key: alertResolutions.key, decision: alertResolutions.decision }).from(alertResolutions))
      .map((r) => [r.key, r.decision] as const),
  );
  const split = partitionDoublePaid(found, decisions);
  return split.open.length + split.claimed.length;
}

/* ─────────────────────────── السجلّ ─────────────────────────── */

/** ألسنةُ السجلّ — في العنوان (`?show=`) فتُحفَظ وتُشارَك. */
export const TX_VIEWS = ["out", "in", "fees", "unknown", "all"] as const;
export type TxView = (typeof TX_VIEWS)[number];

const FEE_CATEGORIES = sql`('POS_FEE','POS_VAT','BANK_FEE','BANK_VAT')`;

function viewWhere(view: TxView): SQL | undefined {
  switch (view) {
    case "out": return sql`${bankTransactions.direction} = 'DEBIT' and ${bankTransactions.category} not in ${FEE_CATEGORIES}`;
    case "in": return sql`${bankTransactions.direction} = 'CREDIT'`;
    case "fees": return sql`${bankTransactions.category} in ${FEE_CATEGORIES}`;
    case "unknown": return sql`${bankTransactions.category} = 'UNKNOWN'`;
    case "all": return undefined;
  }
}

/**
 * كم صفّاً يُرسَم — وما زاد يُقال بعدده ويُضيَّق بالشهر. بلا شهرٍ أحدثُ
 * ستّين وحدها: مئةٌ وعشرون بطاقةً على الجوّال صفحةٌ طولُها ثمانيةٌ وعشرون
 * ألفَ بكسل (قيس)، ومن يبحث عن حركةٍ قديمة يعرف شهرها.
 */
export function txLimit(month: string | null): number {
  return month ? 400 : 60;
}

export interface LedgerRow {
  id: string;
  valueDate: Date;
  description: string | null;
  /** اسمُ الجهة من نصّ البنك — لا من عمودٍ يكتبه نظامُنا. */
  who: string | null;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  category: TxCategory;
  pending: boolean;
  match: MatchExplanation;
}

export interface Ledger {
  rows: LedgerRow[];
  /** كم في هذا اللسان والشهر — قبل القصّ. */
  total: number;
  counts: Record<TxView, number>;
  months: string[];
}

export async function loadLedger(view: TxView, month: string | null): Promise<Ledger> {
  const inMonth = month ? sql`to_char(${bankTransactions.valueDate}, 'YYYY-MM') = ${month}` : undefined;
  const where = and(viewWhere(view), inMonth);

  const [rows, countRows, monthRows] = await Promise.all([
    db.select({
      id: bankTransactions.id,
      valueDate: bankTransactions.valueDate,
      description: bankTransactions.description,
      beneficiaryRaw: bankTransactions.beneficiaryRaw,
      transactionType: bankTransactions.transactionType,
      amountMinor: bankTransactions.amountMinor,
      direction: bankTransactions.direction,
      category: bankTransactions.category,
      matchedPaymentId: bankTransactions.matchedPaymentId,
      matchDisposition: bankTransactions.matchDisposition,
      matchScore: bankTransactions.matchScore,
      matchOutcome: bankTransactions.matchOutcome,
      matchEvidence: bankTransactions.matchEvidence,
      matchStatus: bankTransactions.matchStatus,
      lifecycle: bankTransactions.lifecycle,
      pending: sql<boolean>`(${pendingDecision()})`,
    })
      .from(bankTransactions)
      .where(where)
      .orderBy(desc(bankTransactions.valueDate), desc(bankTransactions.amountMinor))
      .limit(txLimit(month)),

    db.execute<Record<TxView, number>>(sql`
      select
        count(*) filter (where direction = 'DEBIT' and category not in ${FEE_CATEGORIES})::int as out,
        count(*) filter (where direction = 'CREDIT')::int                                   as in,
        count(*) filter (where category in ${FEE_CATEGORIES})::int                          as fees,
        count(*) filter (where category = 'UNKNOWN')::int                                   as unknown,
        count(*)::int                                                                       as all
        from bank_transactions
       where ${month ? sql`to_char(value_date, 'YYYY-MM') = ${month}` : sql`true`}
    `),

    db.execute<{ m: string }>(sql`
      select distinct to_char(value_date, 'YYYY-MM') as m from bank_transactions order by 1 desc
    `),
  ]);

  const c = countRows.rows[0];
  const counts: Record<TxView, number> = {
    out: Number(c?.out ?? 0),
    in: Number(c?.in ?? 0),
    fees: Number(c?.fees ?? 0),
    unknown: Number(c?.unknown ?? 0),
    all: Number(c?.all ?? 0),
  };

  return {
    rows: rows.map((t) => ({
      id: t.id,
      valueDate: t.valueDate,
      description: t.description,
      who: canonicalOf(t).beneficiary ?? null,
      amountMinor: t.amountMinor,
      direction: t.direction,
      category: t.category,
      pending: Boolean(t.pending),
      match: {
        transactionId: t.id,
        disposition: t.matchDisposition,
        score: t.matchScore,
        outcome: t.matchOutcome,
        amountMinor: t.amountMinor,
        matched: t.matchedPaymentId !== null,
        status: t.matchStatus,
        lifecycle: t.lifecycle,
        evidence: readEvidence(t.matchEvidence),
      },
    })),
    total: counts[view],
    counts,
    months: monthRows.rows.map((r) => r.m),
  };
}

/* ─────────────────────────── الحركة المطلوبة ─────────────────────────── */

export interface FocusedTx {
  id: string;
  valueDate: Date;
  description: string | null;
  who: string | null;
  transactionType: string | null;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  category: TxCategory;
  match: MatchExplanation;
}

export async function loadFocusedTx(id: string): Promise<FocusedTx | null> {
  const [t] = await db.select({
    id: bankTransactions.id,
    valueDate: bankTransactions.valueDate,
    description: bankTransactions.description,
    beneficiaryRaw: bankTransactions.beneficiaryRaw,
    transactionType: bankTransactions.transactionType,
    amountMinor: bankTransactions.amountMinor,
    direction: bankTransactions.direction,
    category: bankTransactions.category,
    matchedPaymentId: bankTransactions.matchedPaymentId,
    matchDisposition: bankTransactions.matchDisposition,
    matchScore: bankTransactions.matchScore,
    matchOutcome: bankTransactions.matchOutcome,
    matchEvidence: bankTransactions.matchEvidence,
    matchStatus: bankTransactions.matchStatus,
    lifecycle: bankTransactions.lifecycle,
  })
    .from(bankTransactions)
    .where(eq(bankTransactions.id, id))
    .limit(1);
  if (!t) return null;
  return {
    id: t.id,
    valueDate: t.valueDate,
    description: t.description,
    who: canonicalOf(t).beneficiary ?? null,
    transactionType: t.transactionType,
    amountMinor: t.amountMinor,
    direction: t.direction,
    category: t.category,
    match: {
      transactionId: t.id,
      disposition: t.matchDisposition,
      score: t.matchScore,
      outcome: t.matchOutcome,
      amountMinor: t.amountMinor,
      matched: t.matchedPaymentId !== null,
      status: t.matchStatus,
      lifecycle: t.lifecycle,
      evidence: readEvidence(t.matchEvidence),
    },
  };
}

function canonicalOf(t: {
  valueDate: Date;
  description: string | null;
  beneficiaryRaw: string | null;
  transactionType: string | null;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
}): CanonicalTransaction {
  return toCanonical({
    valueDate: t.valueDate,
    description: t.description,
    beneficiaryRaw: t.beneficiaryRaw,
    transactionType: t.transactionType,
    amountMinor: t.amountMinor,
    direction: t.direction,
  });
}
