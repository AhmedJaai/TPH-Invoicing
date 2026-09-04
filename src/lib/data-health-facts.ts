/**
 * جمع عدّات صحّة البيانات من القاعدة.
 * مفصولة عن الحساب: الحساب في data-health.ts دالة خالصة تُختبر بلا قاعدة.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { HealthInput } from "./data-health";

export async function gatherHealthFacts(): Promise<HealthInput> {
  const [row] = (
    await db.execute<{
      documents: number; invoices: number; with_lines: number; with_tax: number;
      months_invoices: number; months_bank: number;
      suppliers_invoices: number; suppliers_statements: number;
      bank_tx: number; unclassified: number;
    }>(sql`
      select
        (select count(*)::int from documents where status <> 'REJECTED')                 as documents,
        (select count(*)::int from invoices)                                             as invoices,
        (select count(distinct invoice_id)::int from invoice_lines)                      as with_lines,
        (select count(*)::int from invoices where vat_minor is not null)                 as with_tax,
        (select count(distinct period_month)::int from invoices)                         as months_invoices,
        (select count(distinct to_char(value_date, 'YYYY-MM'))::int from bank_transactions) as months_bank,
        (select count(distinct supplier_id)::int from invoices)                          as suppliers_invoices,
        (select count(distinct supplier_id)::int from statements)                        as suppliers_statements,
        (select count(*)::int from bank_transactions)                                    as bank_tx,
        (select count(*)::int from bank_transactions where category = 'UNKNOWN')         as unclassified
    `)
  ).rows;

  return {
    documents: Number(row?.documents ?? 0),
    invoices: Number(row?.invoices ?? 0),
    invoicesWithLines: Number(row?.with_lines ?? 0),
    invoicesWithTaxDetail: Number(row?.with_tax ?? 0),
    monthsWithInvoices: Number(row?.months_invoices ?? 0),
    monthsWithBank: Number(row?.months_bank ?? 0),
    suppliersWithInvoices: Number(row?.suppliers_invoices ?? 0),
    suppliersWithStatements: Number(row?.suppliers_statements ?? 0),
    unclassifiedBankTx: Number(row?.unclassified ?? 0),
    bankTx: Number(row?.bank_tx ?? 0),
  };
}
