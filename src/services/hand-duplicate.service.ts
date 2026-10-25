/**
 * «دفعةٌ قُيّدت مرّتين بيدك» — الوقائعُ من القاعدة، والحكمُ في `lib/hand-duplicate.ts`.
 *
 * ثلاثةُ أبوابٍ يمرّ بها الجواب نفسه:
 *   - «يحتاج قرارك» وصفحةُ المورّد يعرضانه بجانب «رصيد لك عنده» (`loadDuplicateHandPayments`).
 *   - الخصمُ الآليّ يتنحّى عنه (`duplicateHandHeldIds`): كان سيُغلق به أوّلَ فاتورةٍ تصل —
 *     فاتورةٌ لم تُدفع تُسدَّد بمالٍ لم يخرج.
 *   - الفعلُ للمالك: «ألغِ القيد المكرّر» (`VOID` بسببٍ مكتوب) أو «هي دفعةٌ حقيقيّة»
 *     (صفٌّ في `alert_resolutions` بقرار `NOT_DUPLICATE`، فلا يُسأل عنها ثانية).
 *
 * والتحذيرُ لا يُلغي شيئاً وحده (أحمد: «اختيار المالك يغلب التصنيف»).
 */
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { alertResolutions, invoices, paymentAllocations, payments, suppliers } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { Conflict, NotFound } from "@/lib/domain-error";
import {
  duplicateWhy, findDuplicateHandPayments, handDuplicateKey, onlyPaidThis,
  type DuplicateHandPayment, type HandPaymentRow, type ReleaseTrace,
} from "@/lib/hand-duplicate";
import { currentMonthRiyadh } from "@/lib/riyadh-time";
import { assertMonthsOpen, closedMonthsAmong } from "./month-guard";
import { reversePayment } from "./payment.service";
import { loadSupplierBalances } from "./supplier-balance.service";
import type { Conn, Tx } from "./types";

/** كلُّ دفعةٍ قائمة لمورّدٍ يصدر فواتير — بما يكفي للحكم. */
export async function handPaymentRows(conn: Conn, supplierId?: string): Promise<HandPaymentRow[]> {
  const rows = await conn
    .select({
      id: payments.id,
      supplierId: payments.supplierId,
      day: sql<string>`to_char(${payments.paidAt} at time zone 'Asia/Riyadh', 'YYYY-MM-DD')`,
      amountMinor: payments.amountMinor,
      feeMinor: payments.feeMinor,
      method: payments.method,
      status: payments.status,
      isAdvance: payments.isAdvance,
      hasDocument: sql<boolean>`${payments.documentId} is not null`,
      allocatedMinor: sql<number>`coalesce((
        select sum(pa.amount_minor)::bigint from payment_allocations pa where pa.payment_id = ${payments}.id
      ), 0)`,
      hasBankRow: sql<boolean>`exists (
        select 1 from bank_transactions bt where bt.matched_payment_id = ${payments}.id
      )`,
    })
    .from(payments)
    .innerJoin(suppliers, eq(suppliers.id, payments.supplierId))
    .where(and(
      sql`${payments.status} not in ('REVERSED','VOID')`,
      /* مَن لا يصدر فواتير لا «رصيدَ لك عنده»: حوالتُه هي الشراءُ نفسه */
      eq(suppliers.issuesInvoices, true),
      supplierId ? eq(payments.supplierId, supplierId) : undefined,
    ));
  return rows
    .filter((r): r is typeof r & { supplierId: string } => r.supplierId !== null)
    .map((r) => ({
      ...r,
      amountMinor: Number(r.amountMinor),
      feeMinor: Number(r.feeMinor),
      allocatedMinor: Number(r.allocatedMinor),
      hasBankRow: Boolean(r.hasBankRow),
      hasDocument: Boolean(r.hasDocument),
    }));
}

/**
 * ما فكّه دمجُ نسخةٍ مكرّرة أو «حذف القيد» من دفعات — الأحدثُ لكلّ دفعة.
 * يُقرأ من صورة ما قبل الفعل في سجلّ التدقيق: لا عمودَ يكتبه نظامُنا يُبنى عليه.
 */
export async function releaseTraces(conn: Conn, paymentIds: readonly string[]): Promise<Map<string, ReleaseTrace>> {
  const out = new Map<string, ReleaseTrace>();
  if (paymentIds.length === 0) return out;
  const { rows } = await conn.execute<{
    payment_id: string; action: ReleaseTrace["action"]; day: string; dropped: string | null; kept: string | null;
  }>(sql`
    select x.payment_id, x.action, x.day, x.dropped, x.kept from (
      select e ->> 'الدفعة' as payment_id, a.action,
             to_char(a.at at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as day,
             a.before -> 'الساقطة' ->> 'الرقم' as dropped,
             a.after -> 'الباقية' ->> 'الرقم' as kept, a.at
        from audit_logs a, jsonb_array_elements(coalesce(a.before -> 'الساقطة' -> 'التخصيصات', '[]'::jsonb)) e
       where a.action = 'INVOICE_MERGED'
      union all
      select e ->> 'الدفعة', a.action,
             to_char(a.at at time zone 'Asia/Riyadh', 'YYYY-MM-DD'),
             a.before -> 'الفاتورة' ->> 'الرقم', null, a.at
        from audit_logs a, jsonb_array_elements(coalesce(a.before -> 'التخصيصات', '[]'::jsonb)) e
       where a.action = 'INVOICE_ENTRY_REMOVED'
    ) x
     where x.payment_id in (${sql.join(paymentIds.map((id) => sql`${id}`), sql`, `)})
     order by x.at
  `);
  for (const r of rows) {
    out.set(r.payment_id, { paymentId: r.payment_id, action: r.action, day: r.day, droppedNumber: r.dropped, keptNumber: r.kept });
  }
  return out;
}

async function acknowledged(conn: Conn): Promise<Set<string>> {
  const rows = await conn.select({ key: alertResolutions.key }).from(alertResolutions)
    .where(and(like(alertResolutions.key, "hand-dup:%"), eq(alertResolutions.decision, "NOT_DUPLICATE")));
  return new Set(rows.map((r) => r.key));
}

/** الحكمُ وحده — بلا أسماء: للخصم الآليّ ولإعادة الاشتقاق لحظةَ الإلغاء. */
export async function findDuplicateHandPaymentsIn(
  conn: Conn,
  supplierId?: string,
): Promise<{ list: DuplicateHandPayment[]; acknowledged: Set<string> }> {
  const rows = await handPaymentRows(conn, supplierId);
  /* سجلُّ التدقيق لا يُسأل إلّا عمّا يظهر رصيداً من سدادٍ بيد */
  const maybe = rows.filter((r) => !r.hasBankRow && !r.hasDocument && r.amountMinor - r.feeMinor - r.allocatedMinor > 0).map((r) => r.id);
  const releases = await releaseTraces(conn, maybe);
  const ack = await acknowledged(conn);
  return { list: findDuplicateHandPayments(rows, releases), acknowledged: ack };
}

/**
 * ما يتنحّى عنه الخصمُ الآليّ لمورّد: سدادٌ بيدٍ يُظنّ مكرّراً ولم يقل فيه المالك شيئاً.
 * وما قال فيه «هي دفعةٌ حقيقيّة» رصيدٌ كغيره.
 */
export async function duplicateHandHeldIds(conn: Conn, supplierId: string): Promise<Set<string>> {
  const { list, acknowledged: ack } = await findDuplicateHandPaymentsIn(conn, supplierId);
  return new Set(list.filter((d) => !ack.has(handDuplicateKey(d.paymentId))).map((d) => d.paymentId));
}

export interface DuplicateHandView extends DuplicateHandPayment {
  key: string;
  supplierName: string;
  supplierSlug: string;
  /** لماذا يُظنّ مكرّراً — بأرقام الفواتير */
  why: string;
  /** فواتيرُ ما زالت هذه الدفعةُ تسدّد منها شيئاً — تعود مفتوحةً بالإلغاء */
  stillPays: { id: string; number: string; amountMinor: number }[];
}

/** كلُّ ما لم يُحسم، بأسمائه ودليله — للشاشة. */
export async function loadDuplicateHandPayments(conn: Conn = db, supplierId?: string): Promise<DuplicateHandView[]> {
  const { list: all, acknowledged: ack } = await findDuplicateHandPaymentsIn(conn, supplierId);
  const list = all.filter((d) => !ack.has(handDuplicateKey(d.paymentId)));
  if (list.length === 0) return [];

  const ids = [...new Set([...list.map((d) => d.paymentId), ...list.flatMap((d) => (d.twin ? [d.twin.paymentId] : []))])];
  const names = await conn.select({ id: suppliers.id, nameAr: suppliers.nameAr, slug: suppliers.slug }).from(suppliers)
    .where(inArray(suppliers.id, [...new Set(list.map((d) => d.supplierId))]));
  const allocs = await conn.select({ paymentId: paymentAllocations.paymentId, invoiceId: invoices.id, number: invoices.invoiceNumber, amountMinor: paymentAllocations.amountMinor })
    .from(paymentAllocations).innerJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId))
    .where(inArray(paymentAllocations.paymentId, ids));
  return list.map((d) => {
    const s = names.find((n) => n.id === d.supplierId);
    const twinInvoices = d.twin ? allocs.filter((a) => a.paymentId === d.twin!.paymentId).map((a) => a.number) : [];
    return {
      ...d,
      key: handDuplicateKey(d.paymentId),
      supplierName: s?.nameAr ?? "مورّد",
      supplierSlug: s?.slug ?? "",
      why: duplicateWhy(d, twinInvoices),
      stillPays: allocs.filter((a) => a.paymentId === d.paymentId).map((a) => ({ id: a.invoiceId, number: a.number, amountMinor: a.amountMinor })),
    };
  });
}

/* ─────────────────────────── الفعل ─────────────────────────── */

export interface BalanceView {
  /** عليك له */
  owedMinor: number;
  /** لك عنده */
  creditLeftMinor: number;
}

async function balanceOf(conn: Conn, supplierId: string): Promise<BalanceView> {
  const [b] = await loadSupplierBalances(conn, supplierId);
  return { owedMinor: b?.owedMinor ?? 0, creditLeftMinor: b?.creditLeftMinor ?? 0 };
}

export class HandDuplicateRefused extends Conflict {
  constructor(message: string, months: readonly string[] = []) {
    super(message, months.length > 0 ? { months } : undefined);
    this.name = "HandDuplicateRefused";
  }
}

export interface VoidOutcome {
  paymentId: string;
  supplierName: string;
  amountMinor: number;
  why: string;
  /** فواتيرُ عادت مفتوحةً لأنّ الدفعة كانت تسدّد منها شيئاً */
  reopened: { id: string; number: string; amountMinor: number }[];
  balance: { before: BalanceView; after: BalanceView };
}

/** أشهرُ الدفعة وفواتيرِها المقفلة — يُردّ بها الإلغاءُ بأسمائها. */
async function closedMonthsOf(conn: Conn, paymentId: string): Promise<string[]> {
  const [p] = await conn.select({ paidAt: payments.paidAt, appliesToMonth: payments.appliesToMonth }).from(payments).where(eq(payments.id, paymentId));
  if (!p) return [];
  const invMonths = await conn.select({ m: invoices.periodMonth }).from(paymentAllocations)
    .innerJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId)).where(eq(paymentAllocations.paymentId, paymentId));
  return [...await closedMonthsAmong(conn, [p.appliesToMonth, currentMonthRiyadh(p.paidAt), ...invMonths.map((r) => r.m)])].sort();
}

/**
 * «ألغِ القيد المكرّر» — داخل معاملةٍ قائمة. الحكمُ يُعاد هنا بقفلٍ على الدفعة: ما تغيّر
 * منذ المعاينة (رُبطت بحوالة، أو خُصّصت، أو قال المالك إنّها حقيقيّة) يُردّ.
 */
export async function voidDuplicateHandPayment(t: Tx, input: { paymentId: string; actorId: string }): Promise<VoidOutcome> {
  const [locked] = await t.select({ id: payments.id, supplierId: payments.supplierId }).from(payments)
    .where(eq(payments.id, input.paymentId)).for("update");
  if (!locked?.supplierId) throw new NotFound("الدفعة لم تعد في النظام. حدّث الصفحة");
  const [view] = (await loadDuplicateHandPayments(t, locked.supplierId)).filter((d) => d.paymentId === input.paymentId);
  if (!view) throw new HandDuplicateRefused("لم تعد هذه الدفعة تُعدّ مكررة: رُبطت أو خُصّصت أو أُقرّت منذ فتحت الصفحة. حدّثها");

  const closed = await closedMonthsOf(t, input.paymentId);
  if (closed.length > 0) {
    throw new HandDuplicateRefused(`شهر ${closed.join("، ")} مقفل. أعد فتحه أولاً، ثم ألغِ القيد المكرّر.`, closed);
  }

  const before = await balanceOf(t, locked.supplierId);
  const reason = `قيد سداد مكرّر بيد: ${view.why}`;
  const reversal = await reversePayment(t, { paymentId: input.paymentId, kind: "VOID", reason, userId: input.actorId });
  const after = await balanceOf(t, locked.supplierId);

  await recordAudit({
    actorId: input.actorId,
    action: "PAYMENT_VOIDED",
    entityType: "payment",
    entityId: input.paymentId,
    before: {
      الحال: "قائمة",
      المبلغ: view.amountMinor,
      اليوم: view.day,
      الطريقة: view.method,
      تخصيصاتها: reversal.previousAllocations,
      التوأم: view.twin?.paymentId ?? null,
      "فكّها": view.release ? { الفعل: view.release.action, اليوم: view.release.day, الفاتورة: view.release.droppedNumber, الباقية: view.release.keptNumber } : null,
      "عليك قبل (هللة)": before.owedMinor,
      "لك عنده قبل (هللة)": before.creditLeftMinor,
    },
    after: {
      الحال: reversal.status,
      السبب: reversal.reason,
      "عليك بعد (هللة)": after.owedMinor,
      "لك عنده بعد (هللة)": after.creditLeftMinor,
    },
  }, t);

  return {
    paymentId: input.paymentId,
    supplierName: view.supplierName,
    amountMinor: view.amountMinor,
    why: view.why,
    reopened: view.stillPays,
    balance: { before, after },
  };
}

class DryRun extends Error {
  constructor(readonly outcome: VoidOutcome) {
    super("dry-run");
  }
}

/**
 * المعاينة: الإلغاءُ نفسُه في معاملةٍ تُلغى — فـ«عليك» بعده هو ما سيقع. والشهرُ المقفل
 * يُقال بأسمائه قبل أن يُجرَّب.
 */
export async function previewDuplicateVoid(
  paymentId: string,
  actorId: string,
): Promise<{ outcome: VoidOutcome | null; refusal: string | null; months: string[] }> {
  const closed = await closedMonthsOf(db, paymentId);
  if (closed.length > 0) {
    return { outcome: null, refusal: `شهر ${closed.join("، ")} مقفل. أعد فتحه أولاً، ثم ألغِ القيد المكرّر.`, months: closed };
  }
  try {
    await db.transaction(async (t) => {
      throw new DryRun(await voidDuplicateHandPayment(t, { paymentId, actorId }));
    });
  } catch (e) {
    if (e instanceof DryRun) return { outcome: e.outcome, refusal: null, months: [] };
    if (e instanceof HandDuplicateRefused) return { outcome: null, refusal: e.message, months: [] };
    throw e;
  }
  return { outcome: null, refusal: null, months: [] };
}

/**
 * «هي دفعةٌ حقيقيّة — أبقِها رصيداً» (`KEEP`) أو التراجعُ عنه (`OPEN`). لا مالَ يتحرّك:
 * صفٌّ في `alert_resolutions`، والخصمُ الآليّ يعود فيرى رصيدَها.
 */
export async function decideDuplicateHandPayment(
  t: Tx,
  input: { paymentId: string; decision: "KEEP" | "OPEN"; actorId: string; note?: string | null },
): Promise<void> {
  const [p] = await t.select({ id: payments.id, supplierId: payments.supplierId, amountMinor: payments.amountMinor })
    .from(payments).where(eq(payments.id, input.paymentId)).limit(1);
  if (!p?.supplierId) throw new NotFound("الدفعة لم تعد في النظام. حدّث الصفحة");
  const key = handDuplicateKey(p.id);
  if (input.decision === "KEEP") {
    const still = (await findDuplicateHandPaymentsIn(t, p.supplierId)).list.some((d) => d.paymentId === p.id);
    if (!still) throw new HandDuplicateRefused("لم تعد هذه الدفعة تُعدّ مكررة. حدّث الصفحة");
  }
  const [before] = await t.select().from(alertResolutions).where(eq(alertResolutions.key, key)).for("update");
  if (input.decision === "OPEN") {
    await t.delete(alertResolutions).where(eq(alertResolutions.key, key));
  } else {
    await t.insert(alertResolutions)
      .values({ key, decision: "NOT_DUPLICATE", note: input.note ?? null, userId: input.actorId })
      .onConflictDoUpdate({ target: alertResolutions.key, set: { decision: "NOT_DUPLICATE", note: input.note ?? null, userId: input.actorId, at: new Date() } });
  }
  await recordAudit({
    actorId: input.actorId,
    action: "ALERT_RESOLVED",
    entityType: "alert",
    entityId: key,
    before: before ? { القرار: before.decision, الملاحظة: before.note } : null,
    after: {
      القرار: input.decision === "OPEN" ? "أُعيد فتحه" : "دفعة حقيقية، تبقى رصيداً للمورّد",
      الدفعة: p.id,
      المبلغ: p.amountMinor,
    },
  }, t);
}

/* ─────────────── عند الدمج و«حذف القيد»: لا يُصنع الرصيدُ أصلاً ─────────────── */

export interface HandOnlyPayment {
  paymentId: string;
  amountMinor: number;
  method: string;
  /** YYYY-MM-DD */
  day: string;
}

/**
 * سداداتٌ بيدٍ لم تسدّد إلّا هذه الفاتورة، بمبلغها كلّه (`onlyPaidThis`) — إن فُكّت عنها
 * لم يبقَ لها ما تسدّده. وما شهد له البنكُ أو الإيصالُ لا يدخل أبداً.
 */
export async function handPaymentsOnlyFor(conn: Conn, invoiceId: string): Promise<HandOnlyPayment[]> {
  const { rows } = await conn.execute<{
    id: string; day: string; amount_minor: number; fee_minor: number; method: string; status: string;
    is_advance: boolean; has_document: boolean; has_bank: boolean; allocs: { invoiceId: string; amountMinor: number }[];
  }>(sql`
    select p.id, to_char(p.paid_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as day, p.amount_minor, p.fee_minor,
           p.method::text as method, p.status::text as status, p.is_advance,
           p.document_id is not null as has_document,
           exists (select 1 from bank_transactions bt where bt.matched_payment_id = p.id) as has_bank,
           (select jsonb_agg(jsonb_build_object('invoiceId', x.invoice_id, 'amountMinor', x.amount_minor))
              from payment_allocations x where x.payment_id = p.id) as allocs
      from payments p
     where p.id in (select pa.payment_id from payment_allocations pa where pa.invoice_id = ${invoiceId})
     order by p.paid_at, p.id
  `);
  return rows
    .filter((r) => onlyPaidThis({
      status: r.status, hasBankRow: Boolean(r.has_bank), hasDocument: Boolean(r.has_document), method: r.method,
      isAdvance: Boolean(r.is_advance), amountMinor: Number(r.amount_minor), feeMinor: Number(r.fee_minor),
    }, (r.allocs ?? []).map((a) => ({ invoiceId: a.invoiceId, amountMinor: Number(a.amountMinor) })), invoiceId))
    .map((r) => ({ paymentId: r.id, amountMinor: Number(r.amount_minor), method: r.method, day: r.day }));
}

/** يُلغي سداداً بيدٍ مكرّراً بسببٍ مكتوب، وأثرُه على الدفعة نفسها في سجلّ التدقيق. */
export async function voidHandPayment(
  t: Tx,
  input: { paymentId: string; reason: string; actorId: string; context: Record<string, unknown> },
): Promise<number> {
  const [p] = await t.select({ amountMinor: payments.amountMinor, status: payments.status, paidAt: payments.paidAt, appliesToMonth: payments.appliesToMonth })
    .from(payments).where(eq(payments.id, input.paymentId)).for("update");
  if (!p) throw new NotFound("الدفعة لم تعد في النظام. حدّث الصفحة");
  await assertMonthsOpen(t, [p.appliesToMonth, currentMonthRiyadh(p.paidAt)]);
  const reversal = await reversePayment(t, { paymentId: input.paymentId, kind: "VOID", reason: input.reason, userId: input.actorId });
  if (reversal.alreadyReversed) return 0;
  await recordAudit({
    actorId: input.actorId,
    action: "PAYMENT_VOIDED",
    entityType: "payment",
    entityId: input.paymentId,
    before: { الحال: p.status, المبلغ: p.amountMinor, تخصيصاتها: reversal.previousAllocations },
    after: { الحال: reversal.status, السبب: reversal.reason, ...input.context },
  }, t);
  return p.amountMinor;
}
