/**
 * فاتورةٌ مبدئيّة (Proforma) بلا فاتورتها الضريبيّة.
 *
 * المبدئيّةُ لا تُقيَّد — بحقّ: ليست ديناً ولا تُخصم ضريبتُها. لكنّ ما يُحوَّل للمورّد على
 * أساسها **لا يجد فاتورتَه**، فيُخصَّص بالأقدم أوّلاً على فواتيرَ سابقة له. وقع ذلك في
 * الكوب الذهبي (١١ أكتوبر ٢٠٢٦): حوالتا أغسطس وسبتمبر (‏١٬١٥٠ + ‏٢٠١٫٢٥ = ‏١٬٣٥١٫٢٥، مبلغُ
 * مبدئيّة سبتمبر بالهللة) ذهبتا إلى فاتورة مايو، ولم يُقَل لصاحبه إنّ ما في الدرايف مبدئيّةٌ
 * لا أصل. فتُعرَض المبدئيّةُ اليتيمة بنداً حتى تصل أصليّتُها — برقمها عند المورّد نفسِه.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

export interface OrphanProforma {
  documentId: string;
  supplierName: string;
  supplierSlug: string;
  /** رقمُها كما قُرئ أو كما في اسم ملفّها — `null` لم يُعرَف. */
  number: string | null;
  fileName: string;
  periodMonth: string | null;
}

export async function loadOrphanProformas(): Promise<OrphanProforma[]> {
  const rows = (await db.execute<{ id: string; supplier_name: string; slug: string; number: string | null; file_name: string; period_month: string | null }>(sql`
    with p as (
      select d.id, d.supplier_id, d.file_name, d.period_month,
             nullif(coalesce(nullif(d.extraction_json->>'invoiceNumber', ''), substring(d.file_name from 'ProformaInvoice_(.+)_SAR')), '') as number
        from documents d
       where d.kind = 'PROFORMA' and d.status = 'ARCHIVED' and d.supplier_id is not null
    )
    select p.id, s.name_ar as supplier_name, s.slug, p.number, p.file_name, p.period_month
      from p join suppliers s on s.id = p.supplier_id
     where p.number is null
        or not exists (
          select 1 from invoices i
           where i.supplier_id = p.supplier_id
             and regexp_replace(lower(i.invoice_number), '[^a-z0-9]', '', 'g') = regexp_replace(lower(p.number), '[^a-z0-9]', '', 'g')
        )
     order by p.period_month desc nulls last, p.file_name
  `)).rows;
  return rows.map((r) => ({ documentId: r.id, supplierName: r.supplier_name, supplierSlug: r.slug, number: r.number, fileName: r.file_name, periodMonth: r.period_month }));
}
