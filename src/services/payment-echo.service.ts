/**
 * الصدى: سدادٌ قُيِّد بيدٍ، وحوالةٌ من الكشف هي هو — بالمبلغ نفسه، أو جامعةٌ
 * لأكثر من إقرار، أو حوالتان لإقرارٍ واحد.
 *
 * موضعٌ واحدٌ يُحسَب فيه لطرفين: «راجِع الحسابات» يعرضه ويدمجه بإقرار، وخصمُ
 * الرصيد الآليّ (`applySupplierCredit`) **يتنحّى عنه** — فالحوالةُ التي هي صدى
 * سدادٍ مقيَّدٍ ليست مالاً لنا عند المورّد حتّى يُحسم أمرُها.
 */
import { and, eq, sql } from "drizzle-orm";
import { payments } from "@/db/schema";
import { findCreditEchoes, findPaymentEchoes, type CreditEcho, type EchoPayment } from "@/lib/payment-echo";
import type { Conn } from "./types";

export async function echoRows(conn: Conn, supplierId?: string): Promise<EchoPayment[]> {
  const rows = await conn
    .select({
      id: payments.id,
      supplierId: payments.supplierId,
      day: sql<string>`to_char(${payments.paidAt}, 'YYYY-MM-DD')`,
      amountMinor: payments.amountMinor,
      feeMinor: payments.feeMinor,
      method: payments.method,
      status: payments.status,
      hasDocument: sql<boolean>`${payments.documentId} is not null`,
      allocatedMinor: sql<number>`coalesce((
        select sum(pa.amount_minor)::int from payment_allocations pa where pa.payment_id = ${payments}.id
      ), 0)`,
      hasBankRow: sql<boolean>`exists (
        select 1 from bank_transactions bt where bt.matched_payment_id = ${payments}.id
      )`,
    })
    .from(payments)
    .where(and(
      sql`${payments.supplierId} is not null`,
      sql`${payments.status} not in ('REVERSED','VOID')`,
      supplierId ? eq(payments.supplierId, supplierId) : undefined,
    ));
  return rows
    .filter((r): r is typeof r & { supplierId: string } => r.supplierId !== null)
    .map((r) => ({
      ...r,
      allocatedMinor: Number(r.allocatedMinor),
      hasBankRow: Boolean(r.hasBankRow),
      hasDocument: Boolean(r.hasDocument),
    }));
}

export async function creditEchoesOf(conn: Conn, supplierId?: string): Promise<CreditEcho[]> {
  const rows = await echoRows(conn, supplierId);
  /* ما قابله صدى بالمبلغ نفسه بابُه هناك — لا يُعاد هنا */
  const exact = findPaymentEchoes(rows);
  return findCreditEchoes(rows, [...exact.map((e) => e.manualId), ...exact.map((e) => e.bankId)]);
}

/**
 * حوالاتُ المورّد التي هي صدى سدادٍ مقيَّدٍ بيد — بالمبلغ نفسه أو جامعة.
 *
 * كان رصيدُها «لنا عند المورّد» يُخصَم آلياً من أوّل فاتورةٍ تصل، فتُغلق فاتورةٌ
 * لم تُدفع بمالٍ هو سدادُ فاتورةٍ أخرى. تُحجَز حتّى يدمجها إنسانٌ أو يردّها.
 */
export async function echoHeldPaymentIds(conn: Conn, supplierId: string): Promise<Set<string>> {
  const rows = await echoRows(conn, supplierId);
  const exact = findPaymentEchoes(rows);
  const credit = findCreditEchoes(rows, [...exact.map((e) => e.manualId), ...exact.map((e) => e.bankId)]);
  return new Set([...exact.map((e) => e.bankId), ...credit.flatMap((e) => e.sources.map((x) => x.bankId))]);
}

/**
 * أهذه الدفعةُ إقرارُ صاحب العمل لا حوالةُ الكشف؟ — سؤالُ التراجع عن الربط.
 *
 * التراجعُ يفكّ الحركة؛ فإن كانت الدفعةُ إقرارَه (قُيِّدت قبل الكشف، أو ورثت
 * إقرارَه بدمج الصدى) بقيت على فواتيرها — وإلّا رُدّت. كان يُحكَم بتاريخ الإنشاء
 * وحده، والحوالةُ التي ورثت الإقرارَ أحدثُ من الاستيراد فتُردّ: تعود الفاتورةُ
 * مستحقّةً والإقرارُ ملغى.
 */
export async function isOwnersPayment(conn: Conn, paymentId: string, bankTransactionId: string): Promise<boolean> {
  const [row] = (await conn.execute<{ adopted: boolean }>(sql`
    select (p.created_at < bi.created_at or exists (
             select 1 from audit_logs a
              where a.action = 'PAYMENT_ECHO_MERGED'
                and (a.after->>'الحوالة' = ${paymentId}
                     or a.after->'الحوالات' @> jsonb_build_array(jsonb_build_object('bankId', ${paymentId}::text)))
           )) as adopted
      from payments p, bank_transactions bt
      join bank_imports bi on bi.id = bt.bank_import_id
     where p.id = ${paymentId} and bt.id = ${bankTransactionId}
  `)).rows;
  return Boolean(row?.adopted);
}
