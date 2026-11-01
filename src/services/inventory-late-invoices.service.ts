/**
 * فواتيرُ تلت نهايةَ الجرد بأيّامٍ قليلة — ويُقرّر فيها صاحبُ المقهى: أوصلت بضاعتُها قبل نهاية الجرد أم بعده؟
 * (`lib/inventory/received-date.ts`). والقرارُ يُكتب على الفاتورة نفسها (`received_on`) فيسري في كلّ جرد.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { Refused, NotFound } from "@/lib/domain-error";
import { checkReceivedDate } from "@/lib/inventory/received-date";
import { addDays, todayInRiyadh } from "@/lib/riyadh-time";
import { RECEIPT_AMBIGUITY_DAYS } from "./inventory.service";
import type { Conn, Tx } from "./types";

export interface LateInvoice {
  invoiceId: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDay: string;
  totalMinor: number;
  lineCount: number;
  /** `null` لم يُقرَّر فيها — وغيرُه يومُ الوصول الذي كتبه صاحبُ المقهى. */
  receivedOn: string | null;
}

/** فواتيرُ النافذة بعد `periodEnd` — المقرَّرُ فيها وغيرُه، ليُرى القرارُ ويُراجَع. */
export async function loadLateInvoices(periodEnd: string, conn: Conn = db): Promise<LateInvoice[]> {
  const until = addDays(periodEnd, RECEIPT_AMBIGUITY_DAYS);
  const rows = await conn.execute<{ id: string; supplier: string; number: string; day: string; total: number; lines: number; received_on: string | null }>(sql`
    select i.id, su.name_ar as supplier, i.invoice_number as number,
           to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as day,
           i.total_minor as total, i.received_on,
           (select count(*)::int from invoice_lines il where il.invoice_id = i.id) as lines
      from invoices i join suppliers su on su.id = i.supplier_id
     where to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') > ${periodEnd}
       and to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') <= ${until}
     order by day, su.name_ar, i.invoice_number
  `);
  return rows.rows.map((r) => ({
    invoiceId: r.id, supplierName: r.supplier, invoiceNumber: r.number, invoiceDay: r.day,
    totalMinor: Number(r.total), lineCount: Number(r.lines), receivedOn: r.received_on,
  }));
}

/**
 * يكتب يومَ وصول بضاعة فاتورةٍ — أو يمحوه (`null`) فيعود النائبُ ويُسأل عنها ثانيةً.
 * فعلٌ على الفاتورة لا على مبلغها: لا يمسّه قفلُ الشهر (٠٢٨)، ويُكتب أثرُه في المعاملة نفسها.
 */
export async function setInvoiceReceivedOn(
  invoiceId: string,
  receivedOn: string | null,
  actorId: string,
  conn: Conn = db,
): Promise<{ invoiceNumber: string; receivedOn: string | null }> {
  const run = async (t: Tx) => {
    const [inv] = await t.select({
      number: invoices.invoiceNumber, previous: invoices.receivedOn,
      day: sql<string>`to_char(${invoices}.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD')`,
    }).from(invoices).where(eq(invoices.id, invoiceId)).for("update");
    if (!inv) throw new NotFound("هذه الفاتورة لم تعد موجودة. حدّث الصفحة.");
    if (receivedOn !== null) {
      const verdict = checkReceivedDate({ receivedOn, invoiceDay: inv.day, today: todayInRiyadh() });
      if (!verdict.ok) throw new Refused(verdict.error);
    }
    if (inv.previous === receivedOn) return { invoiceNumber: inv.number, receivedOn };
    await t.update(invoices).set({ receivedOn, updatedAt: new Date() }).where(and(eq(invoices.id, invoiceId)));
    await recordAudit({
      actorId, action: "INVENTORY_INVOICE_RECEIVED_SET", entityType: "invoice", entityId: invoiceId,
      before: { "يوم الوصول": inv.previous ?? "لم يُقرَّر" }, after: { "يوم الوصول": receivedOn ?? "لم يُقرَّر", الفاتورة: inv.number },
    }, t);
    return { invoiceNumber: inv.number, receivedOn };
  };
  return "transaction" in conn ? conn.transaction(run) : run(conn as Tx);
}
