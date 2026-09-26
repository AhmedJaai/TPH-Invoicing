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
 *   ٣. تُربط حوالاتُ الطابور بسدادٍ مقيَّدٍ بيد (`hand-payment-link.ts`): المطابقُ
 *      مبلغاً آليّاً، والأكبرُ بإقرار.
 *   ٤. يُخصم رصيدُ كلّ مورّدٍ من فواتيره (`applyCreditEverywhere`).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions, decisionHistory, invoices, paymentAllocations, payments, suppliers } from "@/db/schema";
import { linkHandPayments, linkKey, type HandPaymentLink } from "@/lib/hand-payment-link";
import { applySupplierCredit } from "@/services/supplier-credit.service";
import { SETTLEMENT_FORWARD_DAYS } from "@/lib/allocation";
import { echoKey, findPaymentEchoes, type EchoPayment, type PaymentEcho } from "@/lib/payment-echo";
import { recordAudit } from "@/lib/audit";
import { recordFromStoredReadings, type BacklogOutcome } from "@/services/document-backlog.service";
import { applyCreditEverywhere } from "@/services/document-review.service";
import { allocate, claimBankTransaction, refreshPaymentStatus, reversePayment } from "@/services/payment.service";
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

/* ─────────────── حوالةُ الطابور وسدادُها المقيَّد بيد ─────────────── */

export interface HandLinkView extends HandPaymentLink {
  key: string;
  supplierName: string;
  transferDay: string;
  paymentDay: string;
  /** الفواتيرُ التي سدّدتها الدفعةُ اليدويّة — ولها يُصحَّح الإجماليّ إن زادت الحوالة. */
  invoices: { id: string; number: string }[];
}

async function handLinkInputs(conn: Conn, only?: { transferId: string; paymentId: string }) {
  const transfers = (await conn
    .select({
      id: bankTransactions.id,
      supplierId: bankTransactions.supplierId,
      day: sql<string>`to_char(${bankTransactions.valueDate}, 'YYYY-MM-DD')`,
      amountMinor: bankTransactions.amountMinor,
    })
    .from(bankTransactions)
    .where(and(
      eq(bankTransactions.direction, "DEBIT"),
      sql`${bankTransactions.matchedPaymentId} is null`,
      sql`${bankTransactions.supplierId} is not null`,
      sql`${bankTransactions.matchStatus} <> 'IGNORED'`,
      eq(bankTransactions.category, "SUPPLIER"),
      only ? eq(bankTransactions.id, only.transferId) : undefined,
    )))
    .filter((r): r is typeof r & { supplierId: string } => r.supplierId !== null);

  const hand = (await conn
    .select({
      id: payments.id,
      supplierId: payments.supplierId,
      day: sql<string>`to_char(${payments.paidAt}, 'YYYY-MM-DD')`,
      amountMinor: payments.amountMinor,
    })
    .from(payments)
    .where(and(
      sql`${payments.supplierId} is not null`,
      sql`${payments.documentId} is null`,
      eq(payments.method, "BANK_TRANSFER"),
      sql`${payments.status} not in ('REVERSED','VOID')`,
      sql`not exists (select 1 from bank_transactions bt where bt.matched_payment_id = ${payments}.id)`,
      only ? eq(payments.id, only.paymentId) : undefined,
    )))
    .filter((r): r is typeof r & { supplierId: string } => r.supplierId !== null);

  return { transfers, hand };
}

export async function loadHandPaymentLinks(conn: Conn = db): Promise<HandLinkView[]> {
  const { transfers, hand } = await handLinkInputs(conn);
  const links = linkHandPayments(transfers, hand);
  if (links.length === 0) return [];

  const names = await conn.select({ id: suppliers.id, nameAr: suppliers.nameAr }).from(suppliers)
    .where(inArray(suppliers.id, [...new Set(links.map((l) => l.supplierId))]));
  const allocs = await conn
    .select({ paymentId: paymentAllocations.paymentId, invoiceId: invoices.id, number: invoices.invoiceNumber })
    .from(paymentAllocations)
    .innerJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId))
    .where(inArray(paymentAllocations.paymentId, links.map((l) => l.paymentId)));

  return links.map((l) => ({
    ...l,
    key: linkKey(l),
    supplierName: names.find((n) => n.id === l.supplierId)?.nameAr ?? "مورّد",
    transferDay: transfers.find((t) => t.id === l.transferId)?.day ?? "",
    paymentDay: hand.find((p) => p.id === l.paymentId)?.day ?? "",
    invoices: allocs.filter((a) => a.paymentId === l.paymentId).map((a) => ({ id: a.invoiceId, number: a.number ?? "" })),
  }));
}

export class HandLinkRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandLinkRefused";
  }
}

/**
 * يربط الحوالةَ بالدفعة المقيَّدة بيد: الدفعةُ تأخذ مبلغَ الحوالة ويومَها (الكشفُ
 * أصدق)، وتخصيصاتُها باقية، وما زاد رصيدٌ للمورّد يُخصم من فواتيره.
 * والزوجُ يُعاد اشتقاقُه هنا — ما تغيّر منذ المعاينة يُرفض.
 */
export async function linkHandPayment(
  tx: Tx,
  input: { transferId: string; paymentId: string },
  actorId: string,
): Promise<HandPaymentLink> {
  await tx.select({ id: payments.id }).from(payments).where(eq(payments.id, input.paymentId)).for("update");
  await tx.select({ id: bankTransactions.id }).from(bankTransactions).where(eq(bankTransactions.id, input.transferId)).for("update");
  const { transfers, hand } = await handLinkInputs(tx, input);
  const [link] = linkHandPayments(transfers, hand);
  if (!link) throw new HandLinkRefused("تغيّرت الحوالةُ أو الدفعة منذ المعاينة — حدّث المراجعة");

  const [p] = await tx.select({ paidAt: payments.paidAt, appliesToMonth: payments.appliesToMonth })
    .from(payments).where(eq(payments.id, link.paymentId));
  const [t] = await tx.select({
    valueDate: bankTransactions.valueDate, beneficiaryRaw: bankTransactions.beneficiaryRaw, description: bankTransactions.description,
  }).from(bankTransactions).where(eq(bankTransactions.id, link.transferId));
  await assertMonthsOpen(tx, [p.appliesToMonth, p.paidAt.toISOString().slice(0, 7), t.valueDate.toISOString().slice(0, 7)]);

  await tx.update(payments).set({
    amountMinor: link.transferMinor,
    paidAt: t.valueDate,
    beneficiaryNameRaw: sql`coalesce(${payments.beneficiaryNameRaw}, ${(t.beneficiaryRaw ?? t.description ?? "").slice(0, 200)})`,
  }).where(eq(payments.id, link.paymentId));
  await refreshPaymentStatus(tx, link.paymentId);

  await claimBankTransaction(tx, link.transferId, {
    matchedPaymentId: link.paymentId,
    supplierId: link.supplierId,
    category: "SUPPLIER",
    matchStatus: "MATCHED",
    matchDisposition: null,
    matchOutcome: link.extraMinor > 0 ? "SUPPLIER_ON_ACCOUNT" : "SUPPLIER_SETTLED",
    lifecycle: "POSTED",
  });

  const why = link.exact
    ? "الحوالةُ هي السدادُ الذي قُيِّد بيدٍ قبلها — المبلغُ نفسه والمورّدُ نفسه"
    : `الحوالةُ هي السدادُ الذي قُيِّد بيدٍ قبلها، وزادت عليه — والزائدُ رصيدٌ للمورّد`;
  await tx.insert(decisionHistory).values({
    bankTransactionId: link.transferId,
    event: "MATCH_CONFIRMED",
    actor: "HUMAN",
    actorId,
    detail: why,
    payload: { الدفعة: link.paymentId, "كانت بالهللات": link.paymentMinor, "صارت بالهللات": link.transferMinor },
  });
  await recordAudit({
    actorId,
    action: "HAND_PAYMENT_LINKED",
    entityType: "payment",
    entityId: link.paymentId,
    before: { المبلغ_بالهللات: link.paymentMinor, اليوم: p.paidAt.toISOString().slice(0, 10) },
    after: { الحركة: link.transferId, المبلغ_بالهللات: link.transferMinor, السبب: why },
  }, tx);

  if (link.extraMinor > 0) {
    await applySupplierCredit(tx, link.supplierId, { forwardDays: SETTLEMENT_FORWARD_DAYS, paymentIds: [link.paymentId] });
  }
  return link;
}

/** يربط المطابقَ مبلغاً وحده — يُستدعى بعد استيراد الكشف وفي المراجعة. */
export async function linkExactHandPayments(actorId: string, notes: string[]): Promise<number> {
  let linked = 0;
  for (const l of (await loadHandPaymentLinks()).filter((x) => x.exact)) {
    try {
      await db.transaction((t) => linkHandPayment(t, l, actorId));
      linked++;
    } catch (e) {
      notes.push(`${l.supplierName}: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  return linked;
}

export interface AccountReviewPreview {
  invoices: BacklogOutcome;
  echoes: EchoView[];
  links: HandLinkView[];
}

export async function previewAccountReview(actorId: string): Promise<AccountReviewPreview> {
  const [invoicesOutcome, echoes, links] = await Promise.all([
    recordFromStoredReadings(actorId, { dryRun: true, limit: 200 }),
    loadPaymentEchoes(),
    loadHandPaymentLinks(),
  ]);
  return { invoices: invoicesOutcome, echoes, links };
}

export interface AccountReviewResult {
  invoices: BacklogOutcome;
  merged: { key: string; supplierName: string; movedMinor: number }[];
  linked: { key: string; supplierName: string; extraMinor: number }[];
  creditApplied: number;
  notes: string[];
}

export async function runAccountReview(
  actorId: string,
  echoKeys: readonly string[],
  linkKeys: readonly string[] = [],
): Promise<AccountReviewResult> {
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

  /* المطابقُ مبلغاً يُربط آليّاً، والأكبرُ ما أقرّه صاحبُه في المعاينة */
  const linked: AccountReviewResult["linked"] = [];
  const wantedLinks = new Set(linkKeys);
  for (const l of await loadHandPaymentLinks()) {
    if (!l.exact && !wantedLinks.has(l.key)) continue;
    try {
      await db.transaction((t) => linkHandPayment(t, l, actorId));
      linked.push({ key: l.key, supplierName: l.supplierName, extraMinor: l.extraMinor });
    } catch (err) {
      notes.push(`${l.supplierName}: ${(err as Error).message.slice(0, 100)}`);
    }
  }

  const creditApplied = await applyCreditEverywhere(notes);
  return { invoices: invoicesOutcome, merged, linked, creditApplied, notes };
}
