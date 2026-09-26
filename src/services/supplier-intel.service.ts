/**
 * ذكاءُ المورّد من القاعدة — قراءةٌ وحدها، لا كتابة.
 *
 * يجمع لقائمة الحسابات ولملفّ المورّد ولكشف حسابه المطبوع ما لا يحمله
 * مصدرُ الأرصدة: أعمارَ الفواتير المفتوحة، وتواريخَ اكتمال سدادها،
 * وأسعارَ البنود، وأحداثَ الملفّ. أمّا «عليك» و«لك» فمن
 * `loadSupplierBalances()` وحدها، والاشتقاقُ في `lib/supplier-intel.ts`.
 *
 * والتاريخُ يُقرأ بتوقيت الرياض (`at time zone`) — فاتورةٌ كُتبت ليلاً
 * لا تنتقل إلى اليوم السابق في كشفٍ يُطبَع.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { SETTLED_TOLERANCE_MINOR } from "@/lib/supplier-balances";
import {
  buildLedger,
  paymentReliability,
  priceHistory,
  type Ledger,
  type LedgerEntry,
  type PaymentReliability,
  type ProductPriceHistory,
} from "@/lib/supplier-intel";
import { invoiceHref } from "@/lib/invoice-profile";
import { txHref } from "@/lib/inspector";

const RIYADH_DAY = (col: SQL) => sql`(${col} at time zone 'Asia/Riyadh')::date::text`;

/* ───────────────────────── دليلُ المورّدين ───────────────────────── */

export interface DirectoryRow {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string | null;
  vatNumber: string | null;
  issuesInvoices: boolean;
  contractOnFile: boolean;
  contractRequired: boolean;
  paperInvoices: boolean;
  invoiceCount: number;
  paymentCount: number;
  /** YYYY-MM-DD — `null`: لا تعامل بعد. */
  lastActivity: string | null;
  lastActivityKind: "INVOICE" | "PAYMENT" | null;
  /** أسماؤه البديلة (منها اسمُ المستفيد في البنك) — للبحث وحده. */
  aliases: string;
}

export async function loadSupplierDirectory(): Promise<DirectoryRow[]> {
  const rows = (
    await db.execute<{
      id: string; slug: string; name_ar: string; name_en: string | null; vat_number: string | null;
      issues_invoices: boolean; contract_on_file: boolean; contract_required: boolean; paper_invoices: boolean;
      invoice_count: number; payment_count: number; last_invoice: string | null; last_payment: string | null;
      aliases: string | null;
    }>(sql`
      select s.id, s.slug, s.name_ar, s.name_en, s.vat_number,
             s.issues_invoices, s.contract_on_file, s.contract_required, s.paper_invoices,
             (select count(*)::int from invoices i where i.supplier_id = s.id) as invoice_count,
             (select count(*)::int from payments p
               where p.supplier_id = s.id and p.status not in ('REVERSED','VOID')) as payment_count,
             (select ${RIYADH_DAY(sql`max(i.invoice_date)`)} from invoices i where i.supplier_id = s.id) as last_invoice,
             (select ${RIYADH_DAY(sql`max(p.paid_at)`)} from payments p
               where p.supplier_id = s.id and p.status not in ('REVERSED','VOID')) as last_payment,
             (select string_agg(a.value, ' ') from supplier_aliases a where a.supplier_id = s.id) as aliases
        from suppliers s
       where s.is_active
       order by s.name_ar
    `)
  ).rows;

  return rows.map((r) => {
    const inv = r.last_invoice;
    const pay = r.last_payment;
    const kind = inv && (!pay || inv >= pay) ? "INVOICE" : pay ? "PAYMENT" : null;
    return {
      id: r.id,
      slug: r.slug,
      nameAr: r.name_ar,
      nameEn: r.name_en,
      vatNumber: r.vat_number,
      issuesInvoices: r.issues_invoices,
      contractOnFile: r.contract_on_file,
      contractRequired: r.contract_required,
      paperInvoices: r.paper_invoices,
      invoiceCount: Number(r.invoice_count),
      paymentCount: Number(r.payment_count),
      lastActivity: kind === "INVOICE" ? inv : kind === "PAYMENT" ? pay : null,
      lastActivityKind: kind,
      aliases: r.aliases ?? "",
    };
  });
}

/* ───────────────────────── ملفُّ المورّد ───────────────────────── */

export interface TimelineEvent {
  id: string;
  /** YYYY-MM-DDTHH:mm — للترتيب وحده */
  at: string;
  kind: "INVOICE" | "PAYMENT" | "STATEMENT" | "AUDIT";
  title: string;
  amountMinor: number | null;
  meta: string | null;
  href?: string;
  /** للدفعة: أرُدّت أو أُلغيت؟ */
  cancelled?: boolean;
}

export interface SupplierIntel {
  reliability: PaymentReliability;
  prices: ProductPriceHistory[];
  events: TimelineEvent[];
  lastPayment: { date: string; amountMinor: number } | null;
}

/**
 * ما يُقرأ لملفّ المورّد فوق حسابه: انتظامُ السداد، وتاريخُ الأسعار،
 * وأحداثُ الملفّ. كلُّه من قيودٍ حقيقيّة، وما قلّ يُقال «غير معروف».
 */
export async function loadSupplierIntel(
  supplierId: string,
  /** فواتيرُه المفتوحة كما يعدّها مصدرُ الأرصدة (`openCount`) — «المسدَّد» ما عداها. */
  openCount: number,
  eventLimit = 16,
): Promise<SupplierIntel> {
  const [counts, settlements, lines, events, lastPay] = await Promise.all([
    db.execute<{ invoice_count: number }>(sql`
      select count(*)::int as invoice_count from invoices where supplier_id = ${supplierId}
    `),
    /*
      يومُ اكتمال السداد = تاريخُ آخر دفعةٍ قائمةٍ خُصّصت على الفاتورة —
      للمسدَّدة وحدها. ومن سُدّدت بلا دفعةٍ معروفة التاريخ لا تدخل العيّنة.
    */
    db.execute<{ d: string; settled_on: string }>(sql`
      with alloc as (
        select pa.invoice_id, sum(pa.amount_minor)::bigint as s, max(p.paid_at) as last_paid
          from payment_allocations pa
          join payments p on p.id = pa.payment_id
         where p.status not in ('REVERSED','VOID')
         group by pa.invoice_id
      )
      select ${RIYADH_DAY(sql`i.invoice_date`)} as d, ${RIYADH_DAY(sql`a.last_paid`)} as settled_on
        from invoices i
        join alloc a on a.invoice_id = i.id
       where i.supplier_id = ${supplierId}
         and i.total_minor - a.s <= ${SETTLED_TOLERANCE_MINOR}
    `),
    db.execute<{
      normalized_description: string; description: string; d: string; unit_price_minor: number;
      invoice_id: string; invoice_number: string;
    }>(sql`
      select l.normalized_description, l.description, ${RIYADH_DAY(sql`i.invoice_date`)} as d,
             l.unit_price_minor, i.id as invoice_id, i.invoice_number
        from invoice_lines l
        join invoices i on i.id = l.invoice_id
       where i.supplier_id = ${supplierId}
         and l.normalized_description <> ''
         and l.unit_price_minor > 0
         /* سطرٌ تعارض ضربُه ولم يُفسَّر لا يُبنى عليه سعر */
         and coalesce(l.pricing_basis, '') <> 'INCONSISTENT'
    `),
    db.execute<{
      id: string; at: string; kind: string; title: string; amount: string | number | null;
      meta: string | null; ref_id: string | null; cancelled: boolean | null;
    }>(sql`
      (select i.id, to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD"T"HH24:MI') as at,
              'INVOICE' as kind, i.invoice_number as title, i.total_minor::bigint as amount,
              null::text as meta, i.id as ref_id, null::boolean as cancelled
         from invoices i where i.supplier_id = ${supplierId}
        order by i.invoice_date desc limit ${eventLimit})
      union all
      (select p.id, to_char(p.paid_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD"T"HH24:MI'),
              'PAYMENT', p.method::text, (p.amount_minor - p.fee_minor)::bigint,
              p.status::text,
              (select bt.id from bank_transactions bt where bt.matched_payment_id = p.id limit 1),
              p.status in ('REVERSED','VOID')
         from payments p where p.supplier_id = ${supplierId}
        order by p.paid_at desc limit ${eventLimit})
      union all
      (select st.id, to_char(st.created_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD"T"HH24:MI'),
              'STATEMENT',
              ${RIYADH_DAY(sql`st.period_start`)} || '|' || ${RIYADH_DAY(sql`st.period_end`)},
              st.closing_balance_minor::bigint, null, null, null
         from statements st where st.supplier_id = ${supplierId}
        order by st.created_at desc limit ${eventLimit})
      union all
      (select al.id, to_char(al.at at time zone 'Asia/Riyadh', 'YYYY-MM-DD"T"HH24:MI'),
              'AUDIT', al.action, null, u.name, al.entity_type, null
         from audit_logs al
         left join users u on u.id = al.actor_id
        where (al.entity_type = 'supplier' and al.entity_id = ${supplierId})
           or (al.entity_type = 'statement' and al.entity_id in
                (select st.id from statements st where st.supplier_id = ${supplierId}))
           or (al.entity_type = 'ai_finding' and al.entity_id in
                (select f.id from ai_findings f where f.supplier_id = ${supplierId}))
        order by al.at desc limit ${eventLimit})
    `),
    db.execute<{ d: string; amount: string | number }>(sql`
      select ${RIYADH_DAY(sql`p.paid_at`)} as d, (p.amount_minor - p.fee_minor)::bigint as amount
        from payments p
       where p.supplier_id = ${supplierId} and p.status not in ('REVERSED','VOID')
       order by p.paid_at desc limit 1
    `),
  ]);

  const c = counts.rows[0];
  const reliability = paymentReliability(
    settlements.rows.map((r) => ({ invoiceDate: r.d, settledOn: r.settled_on })),
    {
      invoiceCount: Number(c?.invoice_count ?? 0),
      settledCount: Math.max(0, Number(c?.invoice_count ?? 0) - openCount),
    },
  );

  const prices = priceHistory(
    lines.rows.map((r) => ({
      normalized: r.normalized_description,
      description: r.description,
      date: r.d,
      unitPriceMinor: Number(r.unit_price_minor),
      invoiceId: r.invoice_id,
      invoiceNumber: r.invoice_number,
    })),
  );

  const merged: TimelineEvent[] = events.rows
    .map((r): TimelineEvent => {
      const kind = r.kind as TimelineEvent["kind"];
      const amount = r.amount === null ? null : Number(r.amount);
      return {
        id: `${kind}:${r.id}`,
        at: r.at,
        kind,
        title: r.title,
        amountMinor: amount,
        meta: r.meta,
        href:
          kind === "INVOICE" ? invoiceHref(r.id)
          : kind === "PAYMENT" && r.ref_id ? txHref(r.ref_id)
          : undefined,
        cancelled: r.cancelled ?? undefined,
      };
    })
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, eventLimit);

  const lp = lastPay.rows[0];
  return {
    reliability,
    prices,
    events: merged,
    lastPayment: lp ? { date: lp.d, amountMinor: Number(lp.amount) } : null,
  };
}

/* ───────────────────────── كشفُ الحساب المطبوع ───────────────────────── */

/**
 * كشفُ حساب المورّد من قيودنا بين يومين (بتوقيت الرياض، شاملين).
 *
 * الافتتاحيّ = فواتيرُ ما قبل البداية − ما وصله قبلها. والدفعةُ بما وصل
 * المورّد (المبلغ ناقص رسم التحويل) — كما يحسبها مصدرُ الأرصدة، والمردودةُ
 * والملغاةُ لم يخرج مالُها فلا تدخل.
 */
export async function loadStatementLedger(
  supplierId: string,
  from: string,
  to: string,
): Promise<Ledger> {
  const [opening, entries] = await Promise.all([
    db.execute<{ billed: string | number; paid: string | number }>(sql`
      select
        (select coalesce(sum(total_minor), 0)::bigint from invoices
          where supplier_id = ${supplierId}
            and (invoice_date at time zone 'Asia/Riyadh')::date < ${from}::date) as billed,
        (select coalesce(sum(amount_minor - fee_minor), 0)::bigint from payments
          where supplier_id = ${supplierId} and status not in ('REVERSED','VOID')
            and (paid_at at time zone 'Asia/Riyadh')::date < ${from}::date) as paid
    `),
    db.execute<{ id: string; d: string; kind: string; ref: string; amount: string | number; tx: string | null }>(sql`
      select i.id, ${RIYADH_DAY(sql`i.invoice_date`)} as d, 'INVOICE' as kind,
             i.invoice_number as ref, i.total_minor::bigint as amount, null::text as tx
        from invoices i
       where i.supplier_id = ${supplierId}
         and (i.invoice_date at time zone 'Asia/Riyadh')::date between ${from}::date and ${to}::date
      union all
      select p.id, ${RIYADH_DAY(sql`p.paid_at`)}, 'PAYMENT', p.method::text,
             (p.amount_minor - p.fee_minor)::bigint,
             (select bt.id from bank_transactions bt where bt.matched_payment_id = p.id limit 1)
        from payments p
       where p.supplier_id = ${supplierId} and p.status not in ('REVERSED','VOID')
         and (p.paid_at at time zone 'Asia/Riyadh')::date between ${from}::date and ${to}::date
    `),
  ]);

  const o = opening.rows[0];
  const ledger = buildLedger(
    Number(o?.billed ?? 0) - Number(o?.paid ?? 0),
    entries.rows.map((r): LedgerEntry => ({
      id: r.id,
      date: r.d,
      kind: r.kind === "INVOICE" ? "INVOICE" : "PAYMENT",
      reference: r.ref,
      amountMinor: Number(r.amount),
      href: r.kind === "INVOICE" ? invoiceHref(r.id) : r.tx ? txHref(r.tx) : undefined,
    })),
  );
  return ledger;
}

/** أوّلُ يومٍ تعاملتَ فيه مع المورّد — بدايةُ «كلّ التعامل» في كشفه. */
export async function loadFirstActivity(supplierId: string): Promise<string | null> {
  const r = await db.execute<{ d: string | null }>(sql`
    select least(
      (select ${RIYADH_DAY(sql`min(invoice_date)`)} from invoices where supplier_id = ${supplierId}),
      (select ${RIYADH_DAY(sql`min(paid_at)`)} from payments
        where supplier_id = ${supplierId} and status not in ('REVERSED','VOID'))
    ) as d
  `);
  return r.rows[0]?.d ?? null;
}
