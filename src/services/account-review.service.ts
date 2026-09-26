/**
 * «راجِع الحسابات» — يُعيد النظرَ في كلّ مورّد: ما أُرشف ولم يُقيَّد، وما
 * قُيِّد مرّتين، وما دُفع ولم يُنسب.
 *
 * قال أحمد (٢٦ سبتمبر ٢٠٢٦): «زرّ أخلّيه يرجع يطابق كامل الفواتير مع
 * الموردين… كوهي وأطلس يقول فيه لهم دفعات بلا فواتير والفواتير موجودة».
 * وكان الواقعُ غيرَ ما يبدو: فواتيرُهما مقيَّدة، لكنّ حوالةً لكلٍّ منهما
 * قُيِّدت مرّتين — من الكشف، ومن «وسم مسدَّدة» — فبقيت الأولى «رصيداً لك»
 * والثانيةُ سدّدت على الورق فاتورةً لم تُسدَّد (`payment-echo.ts`).
 *
 * ثلاثُ خطواتٍ بترتيبها، والمعاينةُ قبلها ولا تكتب:
 *   ١. تُقيَّد فواتيرُ ما أُرشف أو ينتظر، لمورّدٍ معروف، بلا توأمٍ مقيَّد
 *      (`recordFromStoredReadings`) — آليّاً، فهي شروطُ القيد نفسها.
 *   ٢. يُدمج كلُّ صدى **أقرّه الإنسان** في المعاينة: يُلغى الإقرارُ (`VOID`)
 *      وتنتقل تخصيصاتُه إلى حوالة الكشف. الخادمُ يعيد اشتقاق الزوج ولا
 *      يصدّق المتصفّح فيه.
 *   ٣. يُخصم رصيدُ كلّ مورّدٍ من فواتيره (`applyCreditEverywhere`).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices, paymentAllocations, payments, suppliers } from "@/db/schema";
import { echoKey, findPaymentEchoes, type EchoPayment, type PaymentEcho } from "@/lib/payment-echo";
import { recordAudit } from "@/lib/audit";
import { recordFromStoredReadings, type BacklogOutcome } from "@/services/document-backlog.service";
import { applyCreditEverywhere } from "@/services/document-review.service";
import { allocate, reversePayment } from "@/services/payment.service";
import { assertMonthsOpen } from "@/services/month-guard";
import type { Conn, Tx } from "@/services/types";

export interface EchoView extends PaymentEcho {
  key: string;
  supplierName: string;
  supplierSlug: string;
  /** الفواتيرُ التي سدّدها الإقرارُ على الورق — تنتقل إلى الحوالة. */
  invoices: { id: string; number: string; amountMinor: number }[];
}

async function echoRows(conn: Conn, supplierId?: string): Promise<EchoPayment[]> {
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

/** كلُّ صدى قائم، بما يكفي ليُفهم قبل أن يُقَرّ. */
export async function loadPaymentEchoes(conn: Conn = db): Promise<EchoView[]> {
  const echoes = findPaymentEchoes(await echoRows(conn));
  if (echoes.length === 0) return [];

  const names = await conn
    .select({ id: suppliers.id, nameAr: suppliers.nameAr, slug: suppliers.slug })
    .from(suppliers)
    .where(inArray(suppliers.id, [...new Set(echoes.map((e) => e.supplierId))]));
  const allocs = await conn
    .select({
      paymentId: paymentAllocations.paymentId,
      invoiceId: invoices.id,
      number: invoices.invoiceNumber,
      amountMinor: paymentAllocations.amountMinor,
    })
    .from(paymentAllocations)
    .innerJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId))
    .where(inArray(paymentAllocations.paymentId, echoes.map((e) => e.manualId)));

  return echoes.map((e) => {
    const s = names.find((n) => n.id === e.supplierId);
    return {
      ...e,
      key: echoKey(e),
      supplierName: s?.nameAr ?? "مورّد",
      supplierSlug: s?.slug ?? "",
      invoices: allocs
        .filter((a) => a.paymentId === e.manualId)
        .map((a) => ({ id: a.invoiceId, number: a.number ?? "", amountMinor: a.amountMinor })),
    };
  });
}

export class EchoMergeRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EchoMergeRefused";
  }
}

/**
 * يدمج صدىً واحداً: يُلغى الإقرارُ وتنتقل تخصيصاتُه إلى حوالة الكشف.
 * الزوجُ يُعاد اشتقاقُه هنا بقفلٍ على الدفعتين — ما تغيّر منذ المعاينة يُرفض.
 */
export async function mergePaymentEcho(
  tx: Tx,
  input: { manualId: string; bankId: string },
  actorId: string,
): Promise<{ movedMinor: number; invoiceIds: string[] }> {
  const locked = await tx
    .select({ id: payments.id, supplierId: payments.supplierId, paidAt: payments.paidAt, appliesToMonth: payments.appliesToMonth, amountMinor: payments.amountMinor })
    .from(payments)
    .where(inArray(payments.id, [input.manualId, input.bankId]))
    .for("update");
  const manual = locked.find((p) => p.id === input.manualId);
  const bank = locked.find((p) => p.id === input.bankId);
  if (!manual || !bank || !manual.supplierId || manual.supplierId !== bank.supplierId) {
    throw new EchoMergeRefused("لم تُوجد الدفعتان لمورّدٍ واحد — حدّث المراجعة");
  }
  const still = findPaymentEchoes(await echoRows(tx, manual.supplierId))
    .some((e) => e.manualId === input.manualId && e.bankId === input.bankId);
  if (!still) throw new EchoMergeRefused("تغيّرت الدفعتان منذ المعاينة — حدّث المراجعة");

  await assertMonthsOpen(tx, [manual.appliesToMonth, manual.paidAt.toISOString().slice(0, 7)]);

  const reversal = await reversePayment(tx, {
    paymentId: manual.id,
    kind: "VOID",
    reason: "صدى حوالةٍ في الكشف: الواقعةُ نفسها قُيِّدت مرّتين، فانتقل سدادُها إلى الحوالة",
    userId: actorId,
  });
  const moved = await allocate(tx, bank.id, bank.amountMinor, reversal.previousAllocations);
  if (moved.allocatedMinor !== reversal.freedMinor) {
    /* الحوالةُ لم تسع ما فُكّ — فلا نصفَ دمج: تُلغى المعاملة كلّها */
    throw new EchoMergeRefused("الحوالةُ لا تسع ما على الإقرار — لم يُدمج شيء");
  }

  await recordAudit({
    actorId,
    action: "PAYMENT_ECHO_MERGED",
    entityType: "payment",
    entityId: manual.id,
    before: { الإقرار: manual.id, تخصيصاته: reversal.previousAllocations },
    after: {
      الحوالة: bank.id,
      "انتقل بالهللات": moved.allocatedMinor,
      السبب: reversal.reason,
    },
  }, tx);
  return { movedMinor: moved.allocatedMinor, invoiceIds: reversal.freedInvoiceIds };
}

export interface AccountReviewPreview {
  invoices: BacklogOutcome;
  echoes: EchoView[];
}

export async function previewAccountReview(actorId: string): Promise<AccountReviewPreview> {
  const [invoicesOutcome, echoes] = await Promise.all([
    recordFromStoredReadings(actorId, { dryRun: true, limit: 200 }),
    loadPaymentEchoes(),
  ]);
  return { invoices: invoicesOutcome, echoes };
}

export interface AccountReviewResult {
  invoices: BacklogOutcome;
  merged: { key: string; supplierName: string; movedMinor: number }[];
  creditApplied: number;
  notes: string[];
}

export async function runAccountReview(actorId: string, echoKeys: readonly string[]): Promise<AccountReviewResult> {
  const notes: string[] = [];
  const invoicesOutcome = await recordFromStoredReadings(actorId);

  const merged: AccountReviewResult["merged"] = [];
  if (echoKeys.length > 0) {
    const wanted = new Set(echoKeys);
    for (const e of await loadPaymentEchoes()) {
      if (!wanted.has(e.key)) continue;
      try {
        const out = await db.transaction((t) => mergePaymentEcho(t, e, actorId));
        merged.push({ key: e.key, supplierName: e.supplierName, movedMinor: out.movedMinor });
      } catch (err) {
        notes.push(`${e.supplierName}: ${(err as Error).message.slice(0, 100)}`);
      }
    }
  }

  const creditApplied = await applyCreditEverywhere(notes);
  return { invoices: invoicesOutcome, merged, creditApplied, notes };
}
