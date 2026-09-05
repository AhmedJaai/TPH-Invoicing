/**
 * يبني ملامح السداد من تاريخ المدفوعات الفعليّ.
 *
 * والمصدر هو التخصيصات لا الحدس: كل دفعةٍ سابقة، وكم فاتورةً حملت،
 * وكم يوماً بين أقدم فواتيرها وتاريخ دفعها. وهذا ما وقع فعلاً، لا ما
 * قيل إنّه يقع.
 *
 * وتُستثنى المردودة والملغاة: ما رُدَّ مالُه لا يصف عادةَ سداد.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  MIN_HISTORY, buildProfile, type PaymentObservation, type SupplierProfile,
} from "@/lib/bank/supplier-profile";

/** أبعدُ ماضٍ يُبنى عليه: سنةٌ — والعادة تتغيّر. */
export const HISTORY_DAYS = 365;

export async function loadSupplierProfiles(): Promise<Map<string, SupplierProfile>> {
  const rows = (
    await db.execute<{
      supplier_id: string; lag_days: number; invoice_count: number; amount_minor: number;
    }>(sql`
      select p.supplier_id,
             extract(day from p.paid_at - min(i.invoice_date))::int as lag_days,
             count(*)::int                                          as invoice_count,
             p.amount_minor
      from payments p
      join payment_allocations pa on pa.payment_id = p.id
      join invoices i on i.id = pa.invoice_id
      where p.supplier_id is not null
        and p.status not in ('REVERSED', 'VOID')
        and p.paid_at >= now() - (${HISTORY_DAYS} || ' days')::interval
      group by p.id, p.supplier_id, p.paid_at, p.amount_minor
    `)
  ).rows;

  const bySupplier = new Map<string, PaymentObservation[]>();
  for (const r of rows) {
    const list = bySupplier.get(r.supplier_id) ?? [];
    list.push({
      lagDays: Number(r.lag_days),
      invoiceCount: Number(r.invoice_count),
      amountMinor: Number(r.amount_minor),
    });
    bySupplier.set(r.supplier_id, list);
  }

  const out = new Map<string, SupplierProfile>();
  for (const [supplierId, history] of bySupplier) {
    if (history.length < MIN_HISTORY) continue;  // المجهول يُترَك مجهولاً
    out.set(supplierId, buildProfile(supplierId, history));
  }
  return out;
}
