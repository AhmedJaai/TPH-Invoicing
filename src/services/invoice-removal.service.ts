/**
 * «حذف القيد» — فاتورةٌ حُذف ملفُّها أو استُبدل، أو دُمجت في أختها، وبقي قيدُها بسداده.
 *
 * أحمد (٢٥ أكتوبر ٢٠٢٦): «إذا حذفت ملف فاتورة في الدرايف أو استبدلته، أو دمجت فاتورتين،
 * والجديدة سُجّلت مدفوعة من حساب المالك أو طوبقت بحوالات — يبقى القيدان القديم والجديد،
 * ثم يظهر أن لي رصيداً عند المورّد». فالمخرجُ قرارُ المالك من صفحة الفاتورة أو من تنبيه
 * «ملفّ لم يعد في الدرايف»، بمعاينةٍ يحسبها الخادم:
 *
 * - **حذف القيد** (`release`): تُحذف الفاتورة، وما خُصّص لها من دفعاتٍ يُفكّ — **والدفعات لا
 *   تُحذف أبداً**: تبقى رصيداً للمورّد، أو يُوزَّع رصيدُها بالأقدم أوّلاً إن اختار.
 * - **انقل سداده** (`move`): ما خُصّص لها ينتقل إلى فاتورةٍ أخرى للمورّد نفسه (بسقف ما بقي
 *   عليها)، ومعه حوالةُ البنك المربوطة بالدفعة، ثمّ يُحذف القيد. وما زاد يبقى رصيداً.
 *
 * - **وسدادٌ بيدٍ لم يسدّد إلّا هذه** (`voidHand`، مع «حذف القيد»): يُلغى (`VOID`) بسببٍ مكتوب
 *   بدل أن يبقى «رصيداً لك» لم يخرج مالُه — مود القهوة وجملة التقنية. والمعاينةُ تقترحه إن
 *   كان للمورّد سدادٌ آخر بالمبلغ نفسه في أيّامه (`findTwin`). وما شهد له البنكُ أو الإيصالُ
 *   لا يُلغى من هنا أبداً.
 *
 * والقواعد: الشهرُ المقفل يُردّ بأسمائه؛ والمتصفّحُ لا يرسل إلّا المعرّفات والاختيار، والخادمُ
 * يعيد الحساب كلَّه داخل معاملةٍ واحدة (`t`)؛ وفاتورةٌ دخلت ضريبتُها إقراراً قُدِّم لا تُحذف —
 * هي دليلُ الخصم. والتخصيصُ بـ`allocate()` و`applySupplierCredit()` وحدهما: لا خوارزميّةَ ثانية.
 * والمعاينةُ هي التنفيذُ نفسُه في معاملةٍ تُلغى — فالرقمُ الذي يراه المالك هو ما سيقع.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions, documents, invoices, issues, paymentAllocations, payments, statementLines, suppliers } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { Conflict, NotFound, Refused } from "@/lib/domain-error";
import { isoDay } from "@/lib/riyadh-time";
import { SETTLED_TOLERANCE_MINOR } from "@/lib/supplier-balances";
import { ISSUE } from "@/lib/issue-codes";
import { allocate, refreshPaymentStatus } from "./payment.service";
import { applySupplierCredit } from "./supplier-credit.service";
import { assertMonthsOpen, closedMonthsAmong } from "./month-guard";
import { loadSupplierBalances } from "./supplier-balance.service";
import { refreshStatementFindings } from "./statement-reconcile.service";
import { STATEMENT_LINE_ORIGIN } from "./invoice.service";
import { handPaymentRows, handPaymentsOnlyFor, voidHandPayment } from "./hand-duplicate.service";
import { findTwin } from "@/lib/hand-duplicate";
import type { Conn, Tx } from "./types";

export type RemovalChoice =
  /** `voidHand`: يُلغى السدادُ بيدٍ الذي لم يسدّد إلّا هذه — الغائبُ يبقيه رصيداً */
  | { mode: "release"; reallocate: boolean; voidHand?: boolean }
  | { mode: "move"; targetId: string };

/** سدادٌ بيدٍ لم يسدّد إلّا هذه الفاتورة — يُلغى مع قيدها إن اختار المالك. */
export interface RemovalHandPayment {
  paymentId: string;
  amountMinor: number;
  method: string;
  paidOn: string;
  /** للمورّد سدادٌ آخر بالمبلغ نفسه في أيّامه سدّد فاتورة — فالإلغاءُ مقترَح */
  hasTwin: boolean;
}

export interface RemovalAllocation {
  paymentId: string;
  amountMinor: number;
  paidOn: string;
  method: string;
  /** حوالةُ بنكٍ مربوطةٌ بهذه الدفعة — تنتقل معها */
  bankLinked: boolean;
}

export interface RemovalTarget {
  id: string;
  number: string;
  date: string;
  totalMinor: number;
  /** ما بقي عليها — سقفُ ما ينتقل إليها */
  openMinor: number;
}

export interface RemovalFacts {
  invoice: { id: string; number: string; date: string; totalMinor: number; month: string; fileName: string; virtual: boolean; fileMissing: boolean };
  supplier: { id: string; name: string; slug: string };
  allocations: RemovalAllocation[];
  allocatedMinor: number;
  statementLines: number;
  /** سداداتٌ بيدٍ لم تسدّد إلّا هذه — «ألغِ السداد مع القيد» */
  handOnly: RemovalHandPayment[];
  /** فواتيرُ المورّد الأخرى التي بقي عليها شيء — الأقدمُ أوّلاً، وأوّلُها المقترَح */
  targets: RemovalTarget[];
  /** لماذا لا يُحذف — `null` يُحذف */
  refusal: string | null;
  closedMonths: string[];
}

export interface RemovalOutcome {
  invoiceId: string;
  number: string;
  releasedMinor: number;
  /** ما انتقل إلى الفاتورة الأخرى */
  movedMinor: number;
  /** ما وُزّع بالأقدم أوّلاً بعد الفكّ */
  reappliedMinor: number;
  /** ما بقي رصيداً للمورّد من الدفعات المفكوكة */
  leftAsCreditMinor: number;
  /** سداداتٌ بيدٍ أُلغيت مع القيد */
  voidedMinor: number;
  target: { id: string; number: string } | null;
  balance: { before: BalanceView; after: BalanceView };
}

export interface BalanceView {
  /** عليك له */
  owedMinor: number;
  /** لك عنده */
  creditLeftMinor: number;
}

export class InvoiceRemovalRefused extends Conflict {
  constructor(message: string, months: readonly string[] = []) {
    super(message, months.length > 0 ? { months } : undefined);
    this.name = "InvoiceRemovalRefused";
  }
}

async function balanceOf(conn: Conn, supplierId: string): Promise<BalanceView> {
  const [b] = await loadSupplierBalances(conn, supplierId);
  return { owedMinor: b?.owedMinor ?? 0, creditLeftMinor: b?.creditLeftMinor ?? 0 };
}

/**
 * ضريبتُها دخلت إقراراً قُدِّم (`vat_filings.snapshot.invoices`) — والفاتورةُ دليلُ ذلك الخصم.
 * يُقرأ من اللقطة نفسها لا من شهر الفاتورة: ما لم يُخصم في الإقرار لا يمنع.
 */
async function filedVatPeriod(conn: Conn, invoiceId: string): Promise<string | null> {
  const { rows } = await conn.execute<{ period_key: string }>(sql`
    select f.period_key from vat_filings f, jsonb_array_elements(coalesce(f.snapshot -> 'invoices', '[]'::jsonb)) e
     where f.voided_at is null and e ->> 'id' = ${invoiceId}
       and coalesce((e ->> 'vatMinor')::bigint, 0) > 0
     limit 1`);
  return rows[0]?.period_key ?? null;
}

/** كلُّ ما يُعرض قبل القرار — قراءةٌ بلا كتابة. */
export async function loadRemovalFacts(invoiceId: string, conn: Conn = db): Promise<RemovalFacts> {
  const [inv] = await conn.select({
    id: invoices.id, number: invoices.invoiceNumber, date: invoices.invoiceDate, total: invoices.totalMinor,
    month: invoices.periodMonth, supplierId: invoices.supplierId, documentId: invoices.documentId,
    fileName: documents.fileName, origin: documents.origin, supplierName: suppliers.nameAr, slug: suppliers.slug,
  }).from(invoices)
    .innerJoin(documents, eq(documents.id, invoices.documentId))
    .innerJoin(suppliers, eq(suppliers.id, invoices.supplierId))
    .where(eq(invoices.id, invoiceId)).limit(1);
  if (!inv) throw new NotFound("الفاتورة لم تعد في النظام. حدّث الصفحة");

  const allocs = (await conn.execute<{ payment_id: string; amount_minor: number; paid_at: Date | string; method: string; bank: boolean }>(sql`
    select pa.payment_id, pa.amount_minor, p.paid_at, p.method::text as method,
           exists (select 1 from bank_transactions b where b.matched_payment_id = p.id) as bank
      from payment_allocations pa join payments p on p.id = pa.payment_id
     where pa.invoice_id = ${invoiceId}
     order by p.paid_at, p.id`)).rows.map((r) => ({
    paymentId: r.payment_id, amountMinor: Number(r.amount_minor), paidOn: isoDay(new Date(r.paid_at)), method: r.method, bankLinked: Boolean(r.bank),
  }));

  const [{ n: lineCount }] = (await conn.execute<{ n: number }>(sql`
    select count(*)::int as n from statement_lines where matched_invoice_id = ${invoiceId}`)).rows;

  const targets = (await conn.execute<{ id: string; number: string; d: string; total: number; open: number }>(sql`
    select i.id, i.invoice_number as number, i.invoice_date::date::text as d, i.total_minor as total,
           (i.total_minor - coalesce((select sum(x.amount_minor) from payment_allocations x where x.invoice_id = i.id), 0))::bigint as open
      from invoices i join documents d on d.id = i.document_id
     where i.supplier_id = ${inv.supplierId} and i.id <> ${invoiceId} and d.status <> 'REJECTED'
     order by i.invoice_date, i.id`)).rows
    .map((r) => ({ id: r.id, number: r.number, date: r.d, totalMinor: Number(r.total), openMinor: Number(r.open) }))
    .filter((r) => r.openMinor > SETTLED_TOLERANCE_MINOR);

  const [missing] = await conn.select({ id: issues.id }).from(issues).where(and(
    eq(issues.code, ISSUE.FILE_MISSING_IN_DRIVE), eq(issues.status, "OPEN"), eq(issues.entityId, inv.documentId),
  )).limit(1);

  const onlyThis = await handPaymentsOnlyFor(conn, invoiceId);
  const supplierRows = onlyThis.length > 0 ? await handPaymentRows(conn, inv.supplierId) : [];
  const handOnly = onlyThis.map((h) => {
    const row = supplierRows.find((r) => r.id === h.paymentId);
    /* التوأمُ يُسأل عنها لو كانت رصيداً — فتُعدّ هنا بلا تخصيص */
    const twin = row ? findTwin({ ...row, allocatedMinor: 0 }, supplierRows.filter((r) => r.id !== row.id)) : null;
    return { paymentId: h.paymentId, amountMinor: h.amountMinor, method: h.method, paidOn: h.day, hasTwin: Boolean(twin) };
  });

  const closed = [...await closedMonthsAmong(conn, [inv.month])];
  const vat = await filedVatPeriod(conn, invoiceId);
  const refusal = closed.length > 0
    ? `شهر ${closed.join("، ")} مقفل. أعد فتحه أولاً، ثم احذف القيد.`
    : vat
      ? `ضريبة هذه الفاتورة خُصمت في إقرار ${vat} الذي قُدّم، وهي دليل ذلك الخصم، فلا يُحذف قيدها. إن كان الإقرار خطأً فتراجع عن تسجيل تقديمه أولاً.`
      : null;

  return {
    invoice: {
      id: inv.id, number: inv.number, date: isoDay(inv.date), totalMinor: inv.total, month: inv.month,
      fileName: inv.fileName, virtual: inv.origin === STATEMENT_LINE_ORIGIN, fileMissing: Boolean(missing),
    },
    supplier: { id: inv.supplierId, name: inv.supplierName, slug: inv.slug },
    allocations: allocs,
    allocatedMinor: allocs.reduce((s, a) => s + a.amountMinor, 0),
    statementLines: Number(lineCount),
    handOnly,
    targets,
    refusal,
    closedMonths: closed,
  };
}

/** التنفيذ — داخل معاملةٍ قائمة، وكلُّ رقمٍ من القاعدة. */
export async function removeInvoiceEntry(
  t: Tx,
  input: { invoiceId: string; choice: RemovalChoice; actorId: string },
): Promise<RemovalOutcome> {
  const [inv] = await t.select({
    id: invoices.id, number: invoices.invoiceNumber, supplierId: invoices.supplierId, total: invoices.totalMinor,
    date: invoices.invoiceDate, month: invoices.periodMonth, documentId: invoices.documentId,
  }).from(invoices).where(eq(invoices.id, input.invoiceId)).for("update");
  if (!inv) throw new NotFound("الفاتورة لم تعد في النظام. حدّث الصفحة");

  let target: { id: string; number: string; month: string; total: number } | null = null;
  if (input.choice.mode === "move") {
    if (input.choice.targetId === inv.id) throw new Refused("اختر فاتورة أخرى غير التي تحذف قيدها");
    const [tg] = await t.select({ id: invoices.id, number: invoices.invoiceNumber, supplierId: invoices.supplierId, month: invoices.periodMonth, total: invoices.totalMinor })
      .from(invoices).where(eq(invoices.id, input.choice.targetId)).for("update");
    if (!tg) throw new NotFound("الفاتورة التي اخترتها لم تعد في النظام. حدّث الصفحة");
    if (tg.supplierId !== inv.supplierId) throw new Refused("الفاتورة التي اخترتها لمورّد آخر، والسداد لا ينتقل بين المورّدين");
    target = { id: tg.id, number: tg.number, month: tg.month, total: tg.total };
  }

  const months = [inv.month, ...(target ? [target.month] : [])];
  const closed = [...await closedMonthsAmong(t, months)];
  if (closed.length > 0) throw new InvoiceRemovalRefused(`شهر ${closed.join("، ")} مقفل. أعد فتحه أولاً، ثم احذف القيد.`, closed);
  await assertMonthsOpen(t, months);
  const vat = await filedVatPeriod(t, inv.id);
  if (vat) throw new InvoiceRemovalRefused(`ضريبة هذه الفاتورة خُصمت في إقرار ${vat} الذي قُدّم، وهي دليل ذلك الخصم، فلا يُحذف قيدها.`);

  const before = await balanceOf(t, inv.supplierId);
  const [doc] = await t.select({ id: documents.id, fileName: documents.fileName, origin: documents.origin, status: documents.status })
    .from(documents).where(eq(documents.id, inv.documentId)).limit(1);

  /* ── التخصيصات: تُفكّ، والدفعاتُ باقية — إلّا سداداً بيدٍ لم يسدّد غيرها واختار المالكُ إلغاءه ── */
  const allAllocs = await t.select({ id: paymentAllocations.id, paymentId: paymentAllocations.paymentId, amountMinor: paymentAllocations.amountMinor, paidAt: payments.paidAt })
    .from(paymentAllocations).innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(eq(paymentAllocations.invoiceId, inv.id))
    .orderBy(payments.paidAt, payments.id);
  const voids = input.choice.mode === "release" && input.choice.voidHand ? await handPaymentsOnlyFor(t, inv.id) : [];
  let voidedMinor = 0;
  for (const v of voids) {
    voidedMinor += await voidHandPayment(t, {
      paymentId: v.paymentId,
      actorId: input.actorId,
      reason: `قيد سداد بيد لم يسدّد إلا ${inv.number}، وقد حُذف قيدها، فأُلغي معها ولم يبقَ رصيداً للمورّد`,
      context: { حذف_القيد: { الفاتورة: inv.number } },
    });
  }
  const voidedIds = new Set(voids.map((v) => v.paymentId));
  const allocs = allAllocs.filter((a) => !voidedIds.has(a.paymentId));
  const releasedMinor = allocs.reduce((s, a) => s + a.amountMinor, 0);
  if (allocs.length > 0) await t.delete(paymentAllocations).where(eq(paymentAllocations.invoiceId, inv.id));
  const paymentIds = [...new Set(allocs.map((a) => a.paymentId))];
  for (const p of paymentIds) await refreshPaymentStatus(t, p);
  const bankLinked = paymentIds.length === 0 ? [] : (await t.select({ id: bankTransactions.id, paymentId: bankTransactions.matchedPaymentId })
    .from(bankTransactions).where(inArray(bankTransactions.matchedPaymentId, paymentIds)));

  /* ── سطورُ كشف المورّد ── */
  const lines = await t.select({ id: statementLines.id, statementId: statementLines.statementId })
    .from(statementLines).where(eq(statementLines.matchedInvoiceId, inv.id));
  const targetIn = target
    ? new Set((await t.select({ s: statementLines.statementId }).from(statementLines).where(eq(statementLines.matchedInvoiceId, target.id))).map((r) => r.s))
    : new Set<string>();
  for (const l of lines) {
    /* في «انقل سداده» يتبع السطرُ سدادَه إن لم يكن للأخرى سطرٌ في كشفه — كما في الدمج */
    if (target && !targetIn.has(l.statementId)) {
      await t.update(statementLines).set({ matchedInvoiceId: target.id }).where(eq(statementLines.id, l.id));
      targetIn.add(l.statementId);
    } else {
      await t.update(statementLines).set({ matchedInvoiceId: null, matchStatus: "UNMATCHED" }).where(eq(statementLines.id, l.id));
    }
  }

  /* ── القيدُ نفسُه ومستندُه ── */
  await t.delete(invoices).where(eq(invoices.id, inv.id));
  const virtual = doc?.origin === STATEMENT_LINE_ORIGIN;
  if (doc && virtual) {
    /* سطرُ كشفٍ بلا ملفّ — لا ورقةَ تبقى (057) */
    await t.delete(documents).where(and(eq(documents.id, doc.id), eq(documents.origin, STATEMENT_LINE_ORIGIN)));
  } else if (doc) {
    /* يُرفض ولا يُحذف: ملفُّه في الدرايف (إن بقي) لا يُمسّ، والمزامنةُ لا تُدخله ثانية */
    await t.update(documents).set({ status: "REJECTED" }).where(and(eq(documents.id, doc.id), sql`${documents.status} <> 'REJECTED'`));
  }
  await t.update(issues).set({ status: "RESOLVED", resolvedAt: new Date() }).where(and(
    eq(issues.status, "OPEN"),
    sql`((${issues.entityType} = 'document' and ${issues.entityId} = ${inv.documentId}) or (${issues.entityType} = 'invoice' and ${issues.entityId} = ${inv.id}))`,
  ));

  /* ── أين يذهب ما فُكّ ── */
  let movedMinor = 0;
  let reappliedMinor = 0;
  const moved: { الدفعة: string; بالهللات: number }[] = [];
  if (target) {
    const [{ open }] = (await t.execute<{ open: number }>(sql`
      select (${target.total} - coalesce((select sum(amount_minor) from payment_allocations where invoice_id = ${target.id}), 0))::bigint as open`)).rows;
    let room = Math.max(0, Number(open));
    for (const a of allocs) {
      if (room <= 0) break;
      const amount = Math.min(room, a.amountMinor);
      const outcome = await allocate(t, a.paymentId, [{ invoiceId: target.id, amountMinor: amount }]);
      movedMinor += outcome.allocatedMinor;
      room -= outcome.allocatedMinor;
      if (outcome.allocatedMinor > 0) moved.push({ الدفعة: a.paymentId, بالهللات: outcome.allocatedMinor });
    }
  } else if (input.choice.mode === "release" && input.choice.reallocate && paymentIds.length > 0) {
    /* قرارُ إنسان: بالأقدم أوّلاً بلا نافذة، ومن هذه الدفعات وحدها */
    reappliedMinor = (await applySupplierCredit(t, inv.supplierId, { forwardDays: null, paymentIds })).appliedMinor;
  }
  for (const s of new Set(lines.map((l) => l.statementId))) await refreshStatementFindings(t, s);

  const after = await balanceOf(t, inv.supplierId);
  const leftAsCreditMinor = Math.max(0, releasedMinor - movedMinor - reappliedMinor);

  await recordAudit({
    actorId: input.actorId,
    action: "INVOICE_ENTRY_REMOVED",
    entityType: "invoice",
    entityId: inv.id,
    before: {
      الفاتورة: {
        المعرّف: inv.id, الرقم: inv.number, الإجمالي: inv.total, التاريخ: isoDay(inv.date), الشهر: inv.month,
        المستند: inv.documentId, الملف: doc?.fileName ?? null,
      },
      التخصيصات: allAllocs.map((a) => ({ الدفعة: a.paymentId, المبلغ: a.amountMinor })),
      حوالات_البنك: bankLinked.map((b) => ({ الحركة: b.id, الدفعة: b.paymentId })),
      سطور_الكشف: lines.map((l) => l.id),
      "عليك قبل (هللة)": before.owedMinor,
      "لك عنده قبل (هللة)": before.creditLeftMinor,
    },
    after: {
      الاختيار: input.choice.mode === "move" ? "نقل السداد إلى فاتورة أخرى" : input.choice.reallocate ? "حذف القيد وتوزيع الرصيد بالأقدم أولاً" : "حذف القيد وإبقاء السداد رصيداً",
      أُلغي_مكرّراً: voids.map((v) => ({ الدفعة: v.paymentId, المبلغ: v.amountMinor })),
      الفاتورة_الأخرى: target ? { المعرّف: target.id, الرقم: target.number } : null,
      انتقل: moved,
      "فُكّ (هللة)": releasedMinor,
      "انتقل (هللة)": movedMinor,
      "وُزّع (هللة)": reappliedMinor,
      "بقي رصيداً (هللة)": leftAsCreditMinor,
      المستند: virtual ? "سطر كشف بلا ملف — حُذف" : "رُفض، وملفه في الدرايف لا يُمسّ",
      "عليك بعد (هللة)": after.owedMinor,
      "لك عنده بعد (هللة)": after.creditLeftMinor,
    },
  }, t);

  return {
    invoiceId: inv.id, number: inv.number, releasedMinor, movedMinor, reappliedMinor, leftAsCreditMinor, voidedMinor,
    target: target ? { id: target.id, number: target.number } : null,
    balance: { before, after },
  };
}

class DryRun extends Error {
  constructor(readonly outcome: RemovalOutcome) {
    super("dry-run");
  }
}

/**
 * المعاينة: التنفيذُ نفسُه في معاملةٍ تُلغى — فـ«عليك» بعده هو ما سيقع بالضبط، لا تقديرٌ
 * بقاعدةٍ ثانية. والرفضُ (شهرٌ مقفل · إقرارٌ قُدِّم) يُقال في الحقائق قبل أن يُجرَّب.
 */
export async function previewInvoiceRemoval(
  invoiceId: string,
  requested: RemovalChoice,
  actorId: string,
): Promise<{ facts: RemovalFacts; outcome: RemovalOutcome | null; choice: RemovalChoice }> {
  const facts = await loadRemovalFacts(invoiceId);
  /*
    لم يُسأل بعد عن السداد بيد (`voidHand` غائب): إن كان له توأمٌ فهو مكرّر، فالإلغاءُ مقترَح —
    والاختيارُ الفعليّ يعود مع المعاينة، فما تراه الشاشةُ محسوبٌ به.
  */
  const choice: RemovalChoice = requested.mode === "release" && requested.voidHand === undefined
    ? { ...requested, voidHand: facts.handOnly.some((h) => h.hasTwin) }
    : requested;
  if (facts.refusal) return { facts, outcome: null, choice };
  try {
    await db.transaction(async (t) => {
      throw new DryRun(await removeInvoiceEntry(t, { invoiceId, choice, actorId }));
    });
  } catch (e) {
    if (e instanceof DryRun) return { facts, outcome: e.outcome, choice };
    throw e;
  }
  return { facts, outcome: null, choice };
}
