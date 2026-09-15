/**
 * ما يُتابَع مع المورّدين — مصدرٌ واحد للتنبيه وللصفحة التي يفتحها.
 *
 * كان «13 دفعة بلا فاتورة» يُحسَب في `attention-facts` ويفتح `/suppliers`
 * التي لا تحسبه، و«13 مورّداً لم يصل كشفه» يفتح `/statements` التي تعرض
 * ما وصل لا ما غاب. فالعدد في التنبيه لا يُبلَغ من أيّ مكان. والاستعلام
 * هنا مرّةً واحدة، يقرؤه الاثنان — فلا يفترق العدّان.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { UnbackedPayment } from "@/lib/supplier-requests";

/** ما دون الريال بقيّةُ تقريبٍ لا دفعةٌ بلا فاتورة. */
export const UNBACKED_FLOOR_MINOR = 100;

/**
 * دفعاتٌ لا فاتورةَ تفسّرها.
 *
 * والمقدَّمةُ المعلَنة تخرج (صاحبُها قال ما هي)، والمردودةُ والملغاةُ لم
 * يخرج مالُها. ومورّدٌ أُعلن أنّه لا يصدر فواتير يخرج كذلك: سؤاله «عقد
 * التوريد» لا «اطلب الفاتورة» (SCN-104).
 */
export async function loadUnbackedPayments(): Promise<UnbackedPayment[]> {
  const rows = (
    await db.execute<{
      id: string; supplier_id: string | null; name_ar: string | null; slug: string | null;
      d: string; amount_minor: number; unbacked: number; tx: string | null;
    }>(sql`
      select p.id, p.supplier_id, s.name_ar, s.slug, p.paid_at::date::text as d, p.amount_minor,
             p.amount_minor - p.fee_minor
               - coalesce((select sum(a.amount_minor)::int from payment_allocations a
                            where a.payment_id = p.id), 0) as unbacked,
             (select bt.id from bank_transactions bt
               where bt.matched_payment_id = p.id limit 1) as tx
        from payments p
        left join suppliers s on s.id = p.supplier_id
       where p.status not in ('REVERSED','VOID','ADVANCE')
         and coalesce(s.issues_invoices, true)
         and p.amount_minor - p.fee_minor
             - coalesce((select sum(a.amount_minor)::int from payment_allocations a
                          where a.payment_id = p.id), 0) > ${UNBACKED_FLOOR_MINOR}
       order by unbacked desc
    `)
  ).rows;

  return rows.map((r) => ({
    paymentId: r.id,
    supplierId: r.supplier_id,
    supplierName: r.name_ar,
    supplierSlug: r.slug,
    paidOn: String(r.d).slice(0, 10),
    amountMinor: Number(r.amount_minor),
    unbackedMinor: Number(r.unbacked),
    bankTransactionId: r.tx,
  }));
}

export interface MissingStatementSupplier {
  id: string;
  nameAr: string;
  slug: string;
  invoiceCount: number;
  lastInvoiceDate: string | null;
}

/** مورّدون لهم فواتير عندنا ولا كشف منهم ينتهي في الشهر المطلوب. */
export async function loadMissingStatementSuppliers(month: string): Promise<MissingStatementSupplier[]> {
  const rows = (
    await db.execute<{ id: string; name_ar: string; slug: string; invoices: number; last_invoice: string | null }>(sql`
      select s.id, s.name_ar, s.slug, count(i.id)::int as invoices,
             to_char(max(i.invoice_date), 'YYYY-MM-DD') as last_invoice
        from invoices i
        join suppliers s on s.id = i.supplier_id
       where not exists (
         select 1 from statements st
          where st.supplier_id = i.supplier_id
            and to_char(st.period_end, 'YYYY-MM') = ${month}
       )
       group by s.id, s.name_ar, s.slug
       order by count(i.id) desc, s.name_ar
    `)
  ).rows;

  return rows.map((r) => ({
    id: r.id,
    nameAr: r.name_ar,
    slug: r.slug,
    invoiceCount: Number(r.invoices),
    lastInvoiceDate: r.last_invoice,
  }));
}
