/**
 * دفعة أوّل الشهر.
 *
 * تجمع مستحقّات الشهر المنقضي مورّداً مورّداً، وتمنع إدراج أيّ فاتورة غير
 * صالحة ضريبياً — لأنّ السداد قبل الحصول على الفاتورة الصحيحة يفقد ورقة
 * التفاوض الوحيدة: المال الذي لم يُدفع بعد.
 */

import type { InputVatStatus, TaxStatus } from "./validation";

export interface PayableInvoice {
  invoiceId: string;
  supplierId: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: Date;
  periodMonth: string;
  totalMinor: number;
  allocatedMinor: number;
  taxStatus: TaxStatus;
  inputVatStatus: InputVatStatus;
  /** `null` تعني «لم تُقرأ» */
  vatMinor: number | null;
  /** مستندُها قرأه النموذج في المزامنة ولم يُؤكِّده إنسان */
  needsReview?: boolean;
}

export type HoldReason = "NEEDS_REVIEW" | "NOT_TAX_VALID" | "NO_VAT_DEDUCTION" | "TAX_UNKNOWN";

export interface SupplierPayment {
  supplierId: string;
  supplierName: string;
  invoices: PayableInvoice[];
  /** ما يُحوَّل فعلاً — بعد خصم رصيدٍ لنا عنده. */
  totalMinor: number;
  invoiceCount: number;
  /** رصيدٌ لنا عند المورّد خُصم من هذه الدفعة. */
  creditAppliedMinor: number;
}

export interface HeldInvoice {
  invoice: PayableInvoice;
  reason: HoldReason;
  message: string;
}

export interface PaymentRun {
  month: string;
  /** جاهز للاعتماد والتحويل */
  ready: SupplierPayment[];
  /**
   * ما يغطّيه رصيدٌ لنا عند المورّد كلّه — فلا يُحوَّل له شيء.
   *
   * كانت الدفعة تقترح تحويلاً لمورّدٍ عنده لنا مالٌ دُفع ولم يُخصم،
   * فيُدفع الريال مرّتين. والرصيد يُخصم هنا من المورّد نفسه وحده.
   */
  coveredByCredit: SupplierPayment[];
  readyTotalMinor: number;
  /** محجوز حتى تُعالَج المشكلة */
  held: HeldInvoice[];
  heldTotalMinor: number;
  /** ضريبة مدخلات معرّضة داخل المحجوز */
  vatAtRiskMinor: number;
}

const HOLD_TEXT: Record<HoldReason, string> = {
  /*
    ملفُّ التحويلات يُرفع إلى البنك فيُحوَّل به مال — وما قرأه النموذج
    ولم يره إنسان لا يدخله. فاتورةٌ منفوخة حسابُها مستقيم تمرّ كلّ فحص.
  */
  NEEDS_REVIEW: "قرأها النموذج من الدرايف ولم تُؤكَّد — افتح المستند وأكّده قبل السداد",
  NOT_TAX_VALID: "ليست فاتورة ضريبية كاملة — اطلب البديل قبل السداد",
  NO_VAT_DEDUCTION: "لا تصلح لخصم ضريبة المدخلات — اطلب فاتورة ضريبية",
  // المجهول لا يُسدَّد ولا يُطالَب صاحبه: يُقرأ أوّلاً
  TAX_UNKNOWN: "لم يُقرأ تفصيلها الضريبي — اقرأ المستند قبل السداد",
};

/**
 * يبني دفعة الشهر.
 *
 * `month` هو الشهر المُسدَّد عنه (الشهر السابق عادةً)، لا شهر التحويل.
 * الفواتير المسدَّدة كلياً تُستبعد، والمسدَّدة جزئياً يُدرَج باقيها.
 */
export function buildPaymentRun(
  invoices: readonly PayableInvoice[],
  month: string,
  options: {
    includeOlderUnpaid?: boolean;
    /** رصيدٌ لنا عند كلّ مورّد لم يُخصم من فاتورة — يُخصم من دفعته. */
    creditBySupplier?: ReadonlyMap<string, number>;
  } = {},
): PaymentRun {
  const inScope = invoices.filter((i) => {
    const remaining = i.totalMinor - i.allocatedMinor;
    if (remaining <= 1) return false; // مسدَّدة (بتسامح هللة تقريب)
    return options.includeOlderUnpaid ? i.periodMonth <= month : i.periodMonth === month;
  });

  const held: HeldInvoice[] = [];
  const payable: PayableInvoice[] = [];

  for (const inv of inScope) {
    if (inv.needsReview) {
      held.push({ invoice: inv, reason: "NEEDS_REVIEW", message: HOLD_TEXT.NEEDS_REVIEW });
    } else if (inv.taxStatus === "UNKNOWN") {
      held.push({ invoice: inv, reason: "TAX_UNKNOWN", message: HOLD_TEXT.TAX_UNKNOWN });
    } else if (inv.taxStatus !== "VALID") {
      held.push({ invoice: inv, reason: "NOT_TAX_VALID", message: HOLD_TEXT.NOT_TAX_VALID });
    } else if (inv.inputVatStatus !== "ELIGIBLE") {
      held.push({ invoice: inv, reason: "NO_VAT_DEDUCTION", message: HOLD_TEXT.NO_VAT_DEDUCTION });
    } else {
      payable.push(inv);
    }
  }

  const bySupplier = new Map<string, SupplierPayment>();
  for (const inv of payable) {
    const entry =
      bySupplier.get(inv.supplierId) ??
      { supplierId: inv.supplierId, supplierName: inv.supplierName, invoices: [], totalMinor: 0, invoiceCount: 0, creditAppliedMinor: 0 };
    entry.invoices.push(inv);
    entry.totalMinor += inv.totalMinor - inv.allocatedMinor;
    entry.invoiceCount++;
    bySupplier.set(inv.supplierId, entry);
  }

  for (const entry of bySupplier.values()) {
    const credit = Math.max(0, options.creditBySupplier?.get(entry.supplierId) ?? 0);
    const applied = Math.min(credit, entry.totalMinor);
    entry.creditAppliedMinor = applied;
    entry.totalMinor -= applied;
  }

  const all = [...bySupplier.values()];
  const ready = all.filter((s) => s.totalMinor > 0).sort((a, b) => b.totalMinor - a.totalMinor);
  const coveredByCredit = all.filter((s) => s.totalMinor === 0);

  return {
    month,
    ready,
    coveredByCredit,
    readyTotalMinor: ready.reduce((s, r) => s + r.totalMinor, 0),
    held,
    heldTotalMinor: held.reduce((s, h) => s + (h.invoice.totalMinor - h.invoice.allocatedMinor), 0),
    vatAtRiskMinor: held.reduce((s, h) => s + (h.invoice.vatMinor ?? 0), 0),
  };
}

/** ملف تحويلات جماعية بصيغة CSV، بترميز يقرأه إكسل العربي. */
export function toBankTransferCsv(run: PaymentRun): string {
  const rows = [
    ["اسم المستفيد", "المبلغ", "العملة", "عدد الفواتير", "أرقام الفواتير", "البيان"],
    ...run.ready.map((s) => [
      s.supplierName,
      (s.totalMinor / 100).toFixed(2),
      "SAR",
      String(s.invoiceCount),
      s.invoices.map((i) => i.invoiceNumber).join(" | "),
      `سداد فواتير ${run.month}`,
    ]),
  ];
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return "﻿" + rows.map((r) => r.map(escape).join(",")).join("\r\n");
}

/** رسالة واتساب جاهزة للمورّد بأرقام فواتيره المحجوزة. */
export function buildSupplierMessage(supplierName: string, held: readonly HeldInvoice[]): string {
  const lines = held.map(
    (h) => `• فاتورة ${h.invoice.invoiceNumber} بتاريخ ${h.invoice.invoiceDate.toISOString().slice(0, 10)}`,
  );
  return [
    `السلام عليكم ${supplierName}،`,
    ``,
    `الفواتير التالية لا تحمل بيانات الفاتورة الضريبية الكاملة:`,
    ...lines,
    ``,
    `نحتاج فاتورة ضريبية تحمل رقمنا الضريبي 310007971600003 لنتمكّن من السداد.`,
    `شاكرين لكم.`,
  ].join("\n");
}
