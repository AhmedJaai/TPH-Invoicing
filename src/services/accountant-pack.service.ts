/**
 * حزمةُ المحاسب من القاعدة — شهرٌ واحد، أربعةُ استعلامات، ولا حساب هنا.
 *
 * الفواتيرُ بشهرها المحاسبيّ (`period_month`)، والمصروفاتُ كذلك. والدفعاتُ
 * وحركاتُ البنك بيوم وقوعها بتوقيت الرياض — ما خرج في الشهر لا ما خصّه.
 * والبناءُ والملخّصُ في `lib/accountant-pack.ts` الخالصة.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { buildAccountantPack, type PackInput, type Sheet } from "@/lib/accountant-pack";
import type { InputVatStatus, TaxStatus } from "@/lib/validation";
import { formatMonth, todayInRiyadh } from "@/lib/riyadh-time";

const day = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").slice(0, 10));

export async function loadAccountantPack(month: string): Promise<{ sheets: Sheet[]; input: PackInput }> {
  const [invoices, payments, expenses, bank, closed] = await Promise.all([
    db.execute<{
      number: string; date: Date; supplier: string | null; seller_vat: string | null;
      subtotal: number | null; vat: number | null; total: number;
      tax: TaxStatus; input_vat: InputVatStatus; paid: number;
    }>(sql`
      select i.invoice_number as number, i.invoice_date as date, s.name_ar as supplier, i.seller_vat,
             i.subtotal_minor as subtotal, i.vat_minor as vat, i.total_minor as total,
             i.tax_status as tax, i.input_vat_status as input_vat,
             coalesce((select sum(pa.amount_minor) from payment_allocations pa where pa.invoice_id = i.id), 0)::bigint as paid
        from invoices i
        left join suppliers s on s.id = i.supplier_id
       where i.period_month = ${month}
       order by i.invoice_date, i.invoice_number
    `),
    db.execute<{
      date: Date; supplier: string | null; amount: number; fee: number; method: string; status: string;
      invoices: string[] | null; from_bank: boolean;
    }>(sql`
      select p.paid_at as date, s.name_ar as supplier, p.amount_minor as amount, p.fee_minor as fee,
             p.method, p.status,
             (select array_agg(i.invoice_number order by i.invoice_date)
                from payment_allocations pa join invoices i on i.id = pa.invoice_id
               where pa.payment_id = p.id) as invoices,
             exists (select 1 from bank_transactions bt where bt.matched_payment_id = p.id) as from_bank
        from payments p
        left join suppliers s on s.id = p.supplier_id
       where to_char(p.paid_at at time zone 'Asia/Riyadh', 'YYYY-MM') = ${month}
       order by p.paid_at
    `),
    db.execute<{ date: string; category: string; label: string; amount: number; source: string }>(sql`
      select occurred_on as date, category, label, amount_minor as amount, source
        from expenses
       where period_month = ${month}
       order by occurred_on
    `),
    db.execute<{ date: Date; description: string | null; beneficiary: string | null; direction: "DEBIT" | "CREDIT"; amount: number; category: string; matched: boolean }>(sql`
      select value_date as date, description, beneficiary_raw as beneficiary, direction, amount_minor as amount,
             category, (matched_payment_id is not null) as matched
        from bank_transactions
       where to_char(value_date at time zone 'Asia/Riyadh', 'YYYY-MM') = ${month}
       order by value_date
    `),
    db.execute<{ n: number }>(sql`select count(*)::int as n from month_closes where month = ${month} and status = 'CLOSED'`),
  ]);

  const input: PackInput = {
    month,
    monthLabel: formatMonth(month),
    generatedAt: todayInRiyadh(),
    closed: Number(closed.rows[0]?.n ?? 0) > 0,
    invoices: invoices.rows.map((r) => ({
      number: r.number,
      date: day(r.date),
      supplier: r.supplier ?? "غير محدَّد",
      sellerVat: r.seller_vat,
      subtotalMinor: r.subtotal === null ? null : Number(r.subtotal),
      vatMinor: r.vat === null ? null : Number(r.vat),
      totalMinor: Number(r.total),
      taxStatus: r.tax,
      inputVatStatus: r.input_vat,
      paidMinor: Number(r.paid),
    })),
    payments: payments.rows.map((r) => ({
      date: day(r.date),
      supplier: r.supplier,
      amountMinor: Number(r.amount),
      feeMinor: Number(r.fee),
      method: r.method,
      status: r.status,
      invoices: r.invoices ?? [],
      fromBank: Boolean(r.from_bank),
    })),
    expenses: expenses.rows.map((r) => ({
      date: day(r.date),
      category: r.category,
      label: r.label,
      amountMinor: Number(r.amount),
      source: r.source,
    })),
    bank: bank.rows.map((r) => ({
      date: day(r.date),
      description: r.beneficiary || r.description || "—",
      direction: r.direction,
      amountMinor: Number(r.amount),
      category: r.category,
      matched: Boolean(r.matched),
    })),
  };

  return { sheets: buildAccountantPack(input), input };
}
