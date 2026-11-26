/**
 * دائنُ آخر كشفٍ لكلّ مورّد مقابلَ ما قيّدناه — يجلب الطرفين ويترك الحكمَ للدالّة الخالصة
 * (`lib/statement-payments.ts`). قراءةٌ وحدها.
 *
 * ثلاثةُ استعلاماتٍ للمورّدين كلّهم لا ثلاثةٌ لكلّ مورّد: «يحتاج قرارك» يُحسب مع كلّ صفحة.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { compareSettlements, RECEIPT_AFTER_DAYS, type OurSettlement, type SettlementComparison, type StatementCreditLine } from "@/lib/statement-payments";
import { addDays } from "@/lib/riyadh-time";
import { creditNoteReferenceOf } from "@/lib/credit-notes";
import { knownReversedInvoices } from "./statement-credit.service";
import type { Conn } from "./types";

export interface SupplierSettlements {
  supplierId: string;
  supplierName: string;
  slug: string;
  statementId: string;
  periodFrom: string;
  periodTo: string;
  comparison: SettlementComparison;
}

export async function loadSettlementComparisons(
  only: readonly string[] | null = null,
  conn: Conn = db,
): Promise<SupplierSettlements[]> {
  if (only !== null && only.length === 0) return [];
  const scope = only === null ? sql`true` : sql`st.supplier_id in (${sql.join(only.map((id) => sql`${id}`), sql`, `)})`;
  const latest = (await conn.execute<{ id: string; supplier_id: string; name_ar: string; slug: string; ps: string; pe: string }>(sql`
    select l.id, l.supplier_id, s.name_ar, s.slug, l.ps, l.pe
      from (select distinct on (st.supplier_id) st.id, st.supplier_id,
                   st.period_start::date::text as ps, st.period_end::date::text as pe
              from statements st
             where st.supplier_id is not null and st.period_start is not null and st.period_end is not null
               and ${scope}
               and exists (select 1 from statement_lines sl where sl.statement_id = st.id)
             order by st.supplier_id, st.period_end desc) l
      join suppliers s on s.id = l.supplier_id
  `)).rows;
  if (latest.length === 0) return [];

  const ids = latest.map((l) => l.id);
  const suppliers = latest.map((l) => l.supplier_id);
  const earliest = latest.reduce((m, l) => (l.ps < m ? l.ps : m), latest[0].ps);
  const latestEnd = latest.reduce((m, l) => (l.pe > m ? l.pe : m), latest[0].pe);

  const [credits, payments] = await Promise.all([
    conn.execute<{ id: string; statement_id: string; d: string; ref: string | null; description: string | null; credit: number }>(sql`
      select sl.id, sl.statement_id, (sl.date at time zone 'UTC')::date::text as d, sl.ref, sl.description, sl.credit_minor as credit
        from statement_lines sl
       where sl.statement_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) and sl.credit_minor > 0
    `),
    /* المردودُ والملغى لم يخرج مالُهما — لا يُنتظر لهما سطر */
    conn.execute<{ id: string; supplier_id: string; d: string; amount: number; fee: number; method: string; label: string | null }>(sql`
      select p.id, p.supplier_id, to_char(p.paid_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as d,
             p.amount_minor as amount, p.fee_minor as fee, p.method::text as method, p.beneficiary_name_raw as label
        from payments p
       where p.supplier_id in (${sql.join(suppliers.map((id) => sql`${id}`), sql`, `)})
         and p.status not in ('REVERSED', 'VOID')
         and to_char(p.paid_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD') between ${addDays(earliest, -RECEIPT_AFTER_DAYS)} and ${latestEnd}
    `),
  ]);

  const linesBy = new Map<string, StatementCreditLine[]>();
  for (const c of credits.rows) {
    linesBy.set(c.statement_id, [...(linesBy.get(c.statement_id) ?? []), { id: c.id, day: c.d, ref: c.ref, description: c.description, amountMinor: Number(c.credit) }]);
  }
  const paidBy = new Map<string, OurSettlement[]>();
  for (const p of payments.rows) {
    paidBy.set(p.supplier_id, [...(paidBy.get(p.supplier_id) ?? []), {
      paymentId: p.id, day: p.d, amountMinor: Number(p.amount), feeMinor: Number(p.fee),
      isCreditNote: p.method === "CREDIT_NOTE", method: p.method,
      reference: p.method === "CREDIT_NOTE" ? creditNoteReferenceOf(p.label) : null,
    }]);
  }

  /* الإشعارُ الذي يعكس فاتورةً يُسأل: أهي عندنا؟ */
  const known = await knownReversedInvoices(conn, suppliers, credits.rows);

  return latest.map((l) => ({
    supplierId: l.supplier_id, supplierName: l.name_ar, slug: l.slug, statementId: l.id,
    periodFrom: l.ps, periodTo: l.pe,
    comparison: compareSettlements(
      linesBy.get(l.id) ?? [],
      (paidBy.get(l.supplier_id) ?? []).filter((p) => p.day >= addDays(l.ps, -RECEIPT_AFTER_DAYS) && p.day <= l.pe),
      { from: l.ps, to: l.pe },
      { knownInvoices: known.get(l.supplier_id) ?? new Set() },
    ),
  }));
}
