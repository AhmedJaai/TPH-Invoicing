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
 * دفعاتٌ لا فاتورةَ تفسّرها — **تعريفٌ واحد لكلّ شاشة**.
 *
 * والمقدَّمةُ المعلَنة تخرج (صاحبُها قال ما هي)، والمردودةُ والملغاةُ لم
 * يخرج مالُها.
 *
 * ── ومن لا يصدر فواتير لا يخرج ──
 *
 * كان يُستثنى (SCN-104) بحجّة أنّ سؤاله «عقد التوريد» لا «اطلب
 * الفاتورة». وذلك صحيحٌ في **صياغة الطلب**، غلطٌ في **العدّ**: فصفحة
 * البنك لا تستثنيه فتقول «١٣ دفعة · ٣٥٬٦٤٤٫٩٠»، والتنبيه يستثنيه
 * فيقول «١٠ دفعات · ٣٢٬٦٨٨٫١٥» — رقمان لعبارةٍ واحدة في شاشتين، وثلاثةُ
 * آلافِ ريالٍ تختفي من إحداهما بلا أن يُقال لِمَ.
 *
 * ومالٌ خرج بلا فاتورة هو مالٌ خرج بلا فاتورة، أصدر المورّدُ فواتير أو
 * لم يصدر. فيدخل الكلّ، ويُحمَل `issuesInvoices` مع الصفّ كي تتبعه
 * **صياغةُ الطلب** وحدها.
 */
export async function loadUnbackedPayments(): Promise<UnbackedPayment[]> {
  const rows = (
    await db.execute<{
      id: string; supplier_id: string | null; name_ar: string | null; slug: string | null;
      d: string; amount_minor: number; unbacked: number; tx: string | null; issues: boolean | null;
      drive_file_id: string | null;
    }>(sql`
      select p.id, p.supplier_id, s.name_ar, s.slug, p.paid_at::date::text as d, p.amount_minor,
             coalesce(s.issues_invoices, true) as issues,
             p.amount_minor - p.fee_minor
               - coalesce((select sum(a.amount_minor)::int from payment_allocations a
                            where a.payment_id = p.id), 0) as unbacked,
             (select bt.id from bank_transactions bt
               where bt.matched_payment_id = p.id limit 1) as tx,
             d.drive_file_id
        from payments p
        left join suppliers s on s.id = p.supplier_id
        left join documents d on d.id = p.document_id
       where p.status not in ('REVERSED','VOID','ADVANCE')
         /*
           مورّدٌ أعلن صاحبُ المقهى أنّه لا يصدر فواتير، وعقدُه عندنا أو لا
           يُطلَب منه عقد — دفعاتُه بلا فاتورة حالُه المعلَنة لا عملٌ باقٍ.
           كانت تُعرَض «اطلب الفاتورة» لمن قيل عنه صراحةً إنّه لا يصدرها
           (أحمد: «لافا والفلاتر والبراونيز — حاطّ هذا في ملفّهم»).
         */
         and not coalesce(s.issues_invoices = false and (s.contract_on_file or not s.contract_required), false)
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
    issuesInvoices: r.issues ?? true,
    receiptDriveFileId: r.drive_file_id,
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
       /* من أُعلن أنّه لا يصدر كشوفاً لا يُطلَب منه (044) */
       where s.issues_statements
         and not exists (
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
