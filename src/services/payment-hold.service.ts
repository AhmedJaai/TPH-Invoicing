/**
 * قرارُ المالك في المحجوز — «أدخلها في الدفعة» و«أعِدها إلى الحجز».
 *
 * الحجزُ تنبيهٌ لا منع (قاعدةُ ٧ أكتوبر ٢٠٢٦): السدادُ قبل الفاتورة الضريبيّة يُفقد
 * ورقةَ التفاوض وقد يُضيّع ضريبةَ المدخلات — يُقال ذلك بمبلغه، ثمّ القرارُ قرارُ
 * صاحب المال. والخادمُ لا يأخذ من المتصفّح إلّا معرّفاتِ الفواتير والسببَ المكتوب:
 * أمحجوزةٌ هي الآن؟ ولِمَ؟ وكم ضريبتُها؟ — كلُّه يُعاد حسابُه هنا من القيد.
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, invoices, paymentAllocations, paymentHoldOverrides, users } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { holdReasonOf, isOverridableHold, type HoldOverride, type HoldReason } from "@/lib/payment-run";
import { SETTLED_TOLERANCE_MINOR } from "@/lib/supplier-balances";
import { pgErrorCode } from "./guard";
import type { Conn } from "./types";

/** قراراتُ المالك القائمة — بمعرّف الفاتورة. تقرؤها `loadPaymentRun` لكلّ شاشة. */
export async function loadHoldOverrides(conn: Conn = db): Promise<Map<string, HoldOverride>> {
  try {
    return await readHoldOverrides(conn);
  } catch (e) {
    /*
      الجدولُ يُنشأ بهجرةٍ تسبق هذا الكود. وإن سبقها الكودُ (قاعدةُ معاينةٍ لم تُهاجَر)
      فغيابُه «لا قرارات» — لا صفحةُ عطبٍ في «اليوم» و«النقد القادم» و«دفعة الشهر».
      يُكتب في السجلّ ولا يُبتلَع غيرُه: كلُّ خطأٍ آخر يُرمى.
    */
    if (pgErrorCode(e) === "42P01") {
      console.error("[payment-hold] جدول payment_hold_overrides غير موجود — شغّل الهجرات", e);
      return new Map();
    }
    throw e;
  }
}

async function readHoldOverrides(conn: Conn): Promise<Map<string, HoldOverride>> {
  const rows = await conn
    .select({
      invoiceId: paymentHoldOverrides.invoiceId,
      note: paymentHoldOverrides.note,
      at: paymentHoldOverrides.createdAt,
      byName: users.name,
    })
    .from(paymentHoldOverrides)
    .leftJoin(users, eq(users.id, paymentHoldOverrides.createdById));
  return new Map(rows.map((r) => [r.invoiceId, { note: r.note, byName: r.byName, at: r.at }]));
}

export class HoldDecisionError extends Error {
  constructor(message: string, readonly status: 400 | 409 = 409) {
    super(message);
    this.name = "HoldDecisionError";
  }
}

export interface HoldDecisionOutcome {
  invoiceNumbers: string[];
  /** ما يدخل الدفعةَ بهذا القرار — المفتوحُ على الفواتير، بالهللات. */
  openMinor: number;
  /** ضريبةٌ لا تُخصم يقيناً ممّا أُدخل. وما لم تُقرأ ضريبتُه يُعَدّ ولا يُجمَع صفراً. */
  vatAtRiskMinor: number;
  vatAtRiskUnknown: number;
}

/**
 * يُدخل فواتيرَ محجوزةً في الدفعة بقرار المالك — كلُّها أو لا شيء.
 *
 * كلُّ فاتورةٍ تُقرأ بقفلها داخل المعاملة ويُعاد الحكمُ عليها بقاعدة البناء نفسها
 * (`holdReasonOf`): ما سُدّد، أو لم يعد محجوزاً، أو حجزُه ممّا لا يُتجاوَز، يردّ
 * الطلبَ بسببه — ولا يُكتب قرارٌ على حالٍ تغيّرت.
 */
export async function overrideHolds(
  input: { invoiceIds: readonly string[]; note: string; actorId: string; month: string },
): Promise<HoldDecisionOutcome> {
  const ids = [...new Set(input.invoiceIds)];
  return db.transaction(async (t) => {
    const rows = await t
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        periodMonth: invoices.periodMonth,
        totalMinor: invoices.totalMinor,
        vatMinor: invoices.vatMinor,
        taxStatus: invoices.taxStatus,
        inputVatStatus: invoices.inputVatStatus,
        documentId: invoices.documentId,
      })
      .from(invoices)
      .where(inArray(invoices.id, ids))
      .orderBy(invoices.invoiceDate, invoices.id)
      .for("update");
    if (rows.length !== ids.length) throw new HoldDecisionError("فاتورةٌ ممّا اخترته غير موجودة — حدّث الصفحة", 400);

    const allocated = new Map(
      (await t
        .select({ invoiceId: paymentAllocations.invoiceId, sum: sql<string>`coalesce(sum(${paymentAllocations.amountMinor}), 0)::bigint` })
        .from(paymentAllocations)
        .where(inArray(paymentAllocations.invoiceId, ids))
        .groupBy(paymentAllocations.invoiceId)
      ).map((r) => [r.invoiceId, Number(r.sum)]),
    );
    const docIds = rows.flatMap((r) => (r.documentId ? [r.documentId] : []));
    const unconfirmed = new Set(
      docIds.length === 0 ? [] : (await t
        .select({ id: documents.id })
        .from(documents)
        .where(and(inArray(documents.id, docIds), ne(documents.status, "ARCHIVED")))
      ).map((d) => d.id),
    );

    const decided: { id: string; invoiceNumber: string; reason: HoldReason; openMinor: number; vatMinor: number | null }[] = [];
    for (const r of rows) {
      const openMinor = r.totalMinor - (allocated.get(r.id) ?? 0);
      if (openMinor <= SETTLED_TOLERANCE_MINOR) {
        throw new HoldDecisionError(`فاتورة ${r.invoiceNumber} سُدّدت — لا شيء يُدخَل. حدّث الصفحة`);
      }
      if (r.periodMonth > input.month) {
        throw new HoldDecisionError(`فاتورة ${r.invoiceNumber} ليست من مستحقّات هذه الدفعة`, 400);
      }
      const reason = holdReasonOf({
        needsReview: r.documentId !== null && unconfirmed.has(r.documentId),
        taxStatus: r.taxStatus,
        inputVatStatus: r.inputVatStatus,
      });
      if (reason === null) {
        throw new HoldDecisionError(`فاتورة ${r.invoiceNumber} لم تعد محجوزة — هي في الجاهز. حدّث الصفحة`);
      }
      if (!isOverridableHold(reason)) {
        throw new HoldDecisionError(`فاتورة ${r.invoiceNumber} مستندُها لم يُؤكَّد — افتحه وأكّده، فمبلغُها لم يره إنسانٌ بعد`);
      }
      decided.push({ id: r.id, invoiceNumber: r.invoiceNumber, reason, openMinor, vatMinor: r.vatMinor });
    }

    await t
      .insert(paymentHoldOverrides)
      .values(decided.map((d) => ({ invoiceId: d.id, holdReason: d.reason, note: input.note, createdById: input.actorId })))
      .onConflictDoUpdate({
        target: paymentHoldOverrides.invoiceId,
        set: { holdReason: sql`excluded.hold_reason`, note: sql`excluded.note`, createdById: sql`excluded.created_by_id`, createdAt: sql`now()` },
      });

    /* المعرّضُ ما لا يُخصم يقيناً — وما لم يُقرأ تفصيلُه لا يُعرف أنّ ضريبته ضائعة */
    const atRisk = decided.filter((d) => d.reason === "NOT_TAX_VALID" || d.reason === "NO_VAT_DEDUCTION");
    const outcome: HoldDecisionOutcome = {
      invoiceNumbers: decided.map((d) => d.invoiceNumber),
      openMinor: decided.reduce((s, d) => s + d.openMinor, 0),
      vatAtRiskMinor: atRisk.reduce((s, d) => s + (d.vatMinor ?? 0), 0),
      vatAtRiskUnknown: atRisk.filter((d) => d.vatMinor === null).length,
    };
    await recordAudit({
      actorId: input.actorId,
      action: "PAYMENT_HOLD_OVERRIDDEN",
      entityType: "payment_run",
      entityId: input.month,
      after: {
        الفواتير: outcome.invoiceNumbers,
        أسباب_الحجز: [...new Set(decided.map((d) => d.reason))],
        سبب_القرار: input.note,
        يدخل_الدفعة_بالهللات: outcome.openMinor,
        ضريبة_معرّضة_بالهللات: outcome.vatAtRiskMinor,
        بلا_ضريبة_مقروءة: outcome.vatAtRiskUnknown,
      },
    }, t);
    return outcome;
  });
}

/** «أعِدها إلى الحجز» — يُحذف القرارُ لا مال، ويُقيَّد أثرُه. يُعيد أرقامَ ما أُعيد. */
export async function restoreHolds(input: { invoiceIds: readonly string[]; actorId: string; month: string }): Promise<string[]> {
  const ids = [...new Set(input.invoiceIds)];
  return db.transaction(async (t) => {
    const removed = await t
      .delete(paymentHoldOverrides)
      .where(inArray(paymentHoldOverrides.invoiceId, ids))
      .returning({ invoiceId: paymentHoldOverrides.invoiceId, note: paymentHoldOverrides.note });
    if (removed.length === 0) return [];
    const numbers = (await t
      .select({ invoiceNumber: invoices.invoiceNumber })
      .from(invoices)
      .where(inArray(invoices.id, removed.map((r) => r.invoiceId)))
    ).map((r) => r.invoiceNumber);
    await recordAudit({
      actorId: input.actorId,
      action: "PAYMENT_HOLD_RESTORED",
      entityType: "payment_run",
      entityId: input.month,
      before: { سبب_القرار: [...new Set(removed.map((r) => r.note))] },
      after: { الفواتير: numbers, الحال: "أُعيدت إلى الحجز" },
    }, t);
    return numbers;
  });
}

