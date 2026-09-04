/**
 * وقائع بيان المصدر — الاستعلام وحده. البناء والحساب في `provenance.ts`
 * كي يُختبرا بلا قاعدة بيانات.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { buildProvenance, type Contribution, type Provenance } from "./provenance";

export interface HomeProvenance {
  purchases: Provenance;
  outstanding: Provenance;
  vat: Provenance;
  /** الشهر الذي بُنيت عليه مشتريات الشهر. */
  month: string | null;
}

interface Row extends Record<string, unknown> {
  month: string | null;
  invoices_in_month: number;
  amount_in_month: number;
  unread_docs: number;
  review_docs: number;
  quarantined_docs: number;
  unpaid_count: number;
  unpaid_amount: number;
  disputed_count: number;
  vat_valid_count: number;
  vat_valid_amount: number;
  vat_unknown_count: number;
  vat_invalid_count: number;
  vat_invalid_amount: number;
}

export async function gatherHomeProvenance(): Promise<HomeProvenance> {
  const [r] = (await db.execute<Row>(sql`
    with latest as (
      select max(period_month) as month from invoices
    )
    select
      (select month from latest)                                             as month,

      (select count(*)::int from invoices where period_month = (select month from latest))
                                                                             as invoices_in_month,
      (select coalesce(sum(total_minor), 0)::int from invoices
        where period_month = (select month from latest))                     as amount_in_month,

      (select count(*)::int from documents where status in ('PENDING', 'EXTRACTED'))
                                                                             as unread_docs,
      (select count(*)::int from documents where status = 'NEEDS_REVIEW')    as review_docs,
      (select count(*)::int from documents where status = 'REJECTED')        as quarantined_docs,

      (select count(*)::int from invoices i
        where i.total_minor > coalesce((select sum(pa.amount_minor)::int
          from payment_allocations pa where pa.invoice_id = i.id), 0))       as unpaid_count,
      (select coalesce(sum(greatest(0, i.total_minor - coalesce((select sum(pa.amount_minor)::int
          from payment_allocations pa where pa.invoice_id = i.id), 0))), 0)::int
        from invoices i)                                                     as unpaid_amount,
      (select count(*)::int from invoices where tax_status = 'NOT_APPLICABLE')
                                                                             as disputed_count,

      (select count(*)::int from invoices where tax_status = 'VALID' and vat_minor is not null)
                                                                             as vat_valid_count,
      (select coalesce(sum(vat_minor), 0)::int from invoices
        where tax_status = 'VALID' and vat_minor is not null)                as vat_valid_amount,
      (select count(*)::int from invoices where tax_status = 'UNKNOWN')      as vat_unknown_count,
      (select count(*)::int from invoices where tax_status = 'INVALID')      as vat_invalid_count,
      (select coalesce(sum(vat_minor), 0)::int from invoices
        where tax_status = 'INVALID' and vat_minor is not null)              as vat_invalid_amount
  `)).rows;

  const month = r?.month ?? null;

  const purchases: Contribution[] = [
    {
      id: "invoices",
      label: `فواتير ${month ?? "الشهر"}`,
      count: Number(r?.invoices_in_month ?? 0),
      amountMinor: Number(r?.amount_in_month ?? 0),
      included: true,
    },
  ];
  if (Number(r?.unread_docs ?? 0) > 0) {
    purchases.push({
      id: "unread",
      label: "مستندات لم تُقرأ بعد",
      unit: "مستند",
      count: Number(r!.unread_docs),
      amountMinor: null,
      included: false,
      reason: "لم يُستخرج مبلغها، فلا تدخل الرقم",
      href: "/documents",
    });
  }
  if (Number(r?.review_docs ?? 0) > 0) {
    purchases.push({
      id: "review",
      label: "مستندات تنتظر مراجعتك",
      unit: "مستند",
      count: Number(r!.review_docs),
      amountMinor: null,
      included: false,
      reason: "قُرئت ولم تُعتمد بعد",
      href: "/documents",
    });
  }
  if (Number(r?.quarantined_docs ?? 0) > 0) {
    purchases.push({
      id: "quarantined",
      label: "مستندات محجورة",
      unit: "مستند",
      count: Number(r!.quarantined_docs),
      amountMinor: null,
      included: false,
      reason: "مرفوضة أو مكرّرة — مستبعَدة عمداً",
      href: "/documents",
    });
  }

  const outstanding: Contribution[] = [
    {
      id: "unpaid",
      label: "فواتير عليها رصيد",
      count: Number(r?.unpaid_count ?? 0),
      amountMinor: Number(r?.unpaid_amount ?? 0),
      included: true,
    },
  ];
  if (Number(r?.disputed_count ?? 0) > 0) {
    outstanding.push({
      id: "not-applicable",
      label: "عروض أسعار ومبدئيات",
      unit: "مستند",
      count: Number(r!.disputed_count),
      amountMinor: null,
      included: false,
      reason: "ليست فواتير تُقيَّد، فلا تُطالَب بها",
      href: "/purchases",
    });
  }

  const vat: Contribution[] = [
    {
      id: "vat-valid",
      label: "فواتير مستوفية الأركان",
      count: Number(r?.vat_valid_count ?? 0),
      amountMinor: Number(r?.vat_valid_amount ?? 0),
      included: true,
    },
  ];
  if (Number(r?.vat_unknown_count ?? 0) > 0) {
    vat.push({
      id: "vat-unknown",
      label: "فواتير لم يُقرأ تفصيلها الضريبي",
      count: Number(r!.vat_unknown_count),
      amountMinor: null,
      included: false,
      reason: "لا يُفترض لها ضريبة",
      href: "/attention",
    });
  }
  if (Number(r?.vat_invalid_count ?? 0) > 0) {
    vat.push({
      id: "vat-invalid",
      label: "فواتير ينقصها ركن",
      count: Number(r!.vat_invalid_count),
      amountMinor: Number(r!.vat_invalid_amount),
      included: false,
      reason: "ضريبتها معرَّضة للرفض — تحتاج فاتورة مصحَّحة",
      href: "/attention",
    });
  }

  return {
    month,
    purchases: buildProvenance(purchases),
    outstanding: buildProvenance(outstanding),
    vat: buildProvenance(vat),
  };
}
