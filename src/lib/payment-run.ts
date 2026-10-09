/**
 * دفعة أوّل الشهر.
 *
 * تجمع مستحقّات الشهر المنقضي مورّداً مورّداً، وتمنع إدراج أيّ فاتورة غير
 * صالحة ضريبياً — لأنّ السداد قبل الحصول على الفاتورة الصحيحة يفقد ورقة
 * التفاوض الوحيدة: المال الذي لم يُدفع بعد.
 */

import type { InputVatStatus, TaxStatus } from "./validation";
import { formatRiyals } from "./money";
import { formatDay } from "./riyadh-time";
import { SETTLED_TOLERANCE_MINOR } from "./supplier-balances";

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
  /**
   * ضريبة مدخلات معرّضة داخل المحجوز: ما حُجز لأنّ خصمه لا يجوز. وما ليست
   * ضريبتُه مقروءة يُعَدّ في `vatAtRiskUnknown` ولا يُجمَع صفراً.
   */
  vatAtRiskMinor: number;
  vatAtRiskUnknown: number;
}

const HOLD_TEXT: Record<HoldReason, string> = {
  /*
    ملفُّ التحويلات يُرفع إلى البنك فيُحوَّل به مال — وما قرأه النموذج
    ولم يره إنسان لا يدخله. فاتورةٌ منفوخة حسابُها مستقيم تمرّ كلّ فحص.
  */
  NEEDS_REVIEW: "مستندُها لم يُؤكَّد بعد — افتح المستند وأكّده قبل السداد",
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
    if (remaining <= SETTLED_TOLERANCE_MINOR) return false; // مسدَّدة (بتسامح هللة تقريب)
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
  // ما لم يُقرأ أو لم يُؤكَّد لا يُعرَف أنّ ضريبته ضائعة — المعرّض ما لا يُخصم يقيناً
  const atRisk = held.filter((h) => h.reason === "NOT_TAX_VALID" || h.reason === "NO_VAT_DEDUCTION");
  const ready = all.filter((s) => s.totalMinor > 0).sort((a, b) => b.totalMinor - a.totalMinor);
  const coveredByCredit = all.filter((s) => s.totalMinor === 0);

  return {
    month,
    ready,
    coveredByCredit,
    readyTotalMinor: ready.reduce((s, r) => s + r.totalMinor, 0),
    held,
    heldTotalMinor: held.reduce((s, h) => s + (h.invoice.totalMinor - h.invoice.allocatedMinor), 0),
    vatAtRiskMinor: atRisk.reduce((s, h) => s + (h.invoice.vatMinor ?? 0), 0),
    vatAtRiskUnknown: atRisk.filter((h) => h.invoice.vatMinor === null).length,
  };
}

/** ملف تحويلات جماعية بصيغة CSV، بترميز يقرأه إكسل العربي. */
/**
 * حسابُ المستفيد — من أدلّة الكشف لا من ذاكرةِ أحد.
 *
 * كان ملفُّ التحويلات اسماً ومبلغاً بلا حساب، والبنكُ لا يحوّل إلى اسم —
 * فيُعاد كتابةُ كلّ آيبان باليد، وهو أخطرُ ما في التحويل خطأً. والنظامُ
 * يعرف حسابَ كلّ مستفيدٍ أكّده إنسانٌ من كشف البنك (`counterparty_evidence`،
 * دليلٌ قاطع). فيُؤخَذ من هناك: آيبانٌ واحد يُكتَب، وآيبانان مختلفان سؤالٌ
 * لا يُحسَم بالحدس — يبقى الحقلُ فارغاً ويُقال لِمَ. ورقمُ الحساب يأتي بعد
 * الآيبان لأنّ البنوك تطلب الآيبان للتحويل المحلّيّ.
 */
export interface PayeeAccount {
  account: string | null;
  note: string | null;
}

export function resolvePayeeAccount(
  evidence: readonly { kind: string; normalized: string }[],
  /**
   * آيبانٌ كتبه صاحبُ المقهى في ملفّ المورّد. **ما كتبه بيده يمضي** — وقد نُبِّه
   * عند حفظه إن خالف الكشوف — ويُقال بجانبه إن خالف، ولا يُبدَّل ولا يُحجَب.
   */
  manualIban?: string | null,
): PayeeAccount {
  const distinct = (kind: string) => [...new Set(evidence.filter((e) => e.kind === kind).map((e) => e.normalized))];
  if (manualIban) {
    const seen = distinct("IBAN");
    const agrees = seen.length === 0 || seen.includes(manualIban);
    return {
      account: manualIban,
      note: seen.length === 0
        ? "آيبانٌ مكتوبٌ بيد — لم يُحوَّل له من قبل، فتحقّق منه قبل أوّل تحويل"
        : agrees ? null : "مكتوبٌ بيد ويخالف الحسابَ الذي حُوِّل له في الكشوف — تأكّد من المورّد قبل التحويل",
    };
  }
  for (const kind of ["IBAN", "ACCOUNT"] as const) {
    const values = distinct(kind);
    if (values.length === 1) return { account: values[0], note: null };
    if (values.length > 1) {
      return { account: null, note: `له ${values.length} حسابات في الكشوف — اختر الصحيح في البنك` };
    }
  }
  return { account: null, note: "الحسابُ غير معروف — أدخله في ملفّ المورّد" };
}

/**
 * خليّةٌ تبدأ بـ= أو + أو - أو @ (أو بمحرف جدولة/سطر) تنفّذها جداولُ البيانات
 * **صيغةً**. واسمُ المورّد ورقمُ الفاتورة نصٌّ قرأه نموذجٌ من ورقة — «-1+2» أو
 * «=HYPERLINK(...)» رقمُ فاتورةٍ ممكن. فتُسبَق بفاصلةٍ عليا: تُقرأ نصّاً.
 */
export function csvSafeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** مورّدو الدفعة الذين لا حسابَ معروفاً لهم — لا يدخلون قسمَ التحويل من الملفّ. */
export function suppliersMissingAccount(
  run: Pick<PaymentRun, "ready">,
  accounts: ReadonlyMap<string, PayeeAccount>,
): SupplierPayment[] {
  return run.ready.filter((s) => !accounts.get(s.supplierId)?.account);
}

export function toBankTransferCsv(
  run: PaymentRun,
  accounts: ReadonlyMap<string, PayeeAccount> = new Map(),
): string {
  const row = (s: SupplierPayment) => {
    const acc = accounts.get(s.supplierId) ?? resolvePayeeAccount([]);
    return [
      s.supplierName,
      acc.account ?? "",
      /* من الهللات نصّاً — لا قسمةَ عشريّة في مبلغٍ يُحوَّل */
      formatRiyals(s.totalMinor),
      "SAR",
      String(s.invoiceCount),
      s.invoices.map((i) => i.invoiceNumber).join(" | "),
      `سداد فواتير ${run.month}`,
      acc.note ?? "",
    ];
  };
  const missing = suppliersMissingAccount(run, accounts);
  const withAccount = run.ready.filter((s) => !missing.includes(s));
  const rows = [
    ["اسم المستفيد", "حساب المستفيد", "المبلغ", "العملة", "عدد الفواتير", "أرقام الفواتير", "البيان", "تنبيه"],
    ...withAccount.map(row),
    /*
      مَن لا حسابَ له خارجَ قسم التحويل: ملفٌّ يُرفع إلى البنك وفيه خانةُ حسابٍ
      فارغة يُردّ كلُّه أو يُكمَل باليد وسط الصفوف — وهو أخطرُ موضعٍ للخطأ.
      فيُفصَلون في آخره بعنوانٍ يقول ما هم، ولا يُسقَطون فيُنسَوا.
    */
    ...(missing.length > 0
      ? [[], ["يحتاج حساباً — ليس في التحويل: احذف هذا القسم قبل الرفع وحوّل لهم بعد إدخال حسابهم"], ...missing.map(row)]
      : []),
  ];
  const escape = (v: string) => {
    const safe = csvSafeCell(v);
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "\ufeff" + rows.map((r) => r.map(escape).join(",")).join("\r\n");
}

/** رسالة واتساب جاهزة للمورّد بأرقام فواتيره المحجوزة. */
export function buildSupplierMessage(
  supplierName: string,
  held: readonly HeldInvoice[],
  /** رقمُنا الضريبيّ من الإعداد (`companyConfig.vatNumber`) — لا يُكتب باليد في نصّ. */
  companyVat: string | null,
): string {
  const lines = held.map(
    (h) => `• فاتورة ${h.invoice.invoiceNumber} بتاريخ ${formatDay(h.invoice.invoiceDate)}`,
  );
  return [
    `السلام عليكم ${supplierName}،`,
    ``,
    `الفواتير التالية لا تحمل بيانات الفاتورة الضريبية الكاملة:`,
    ...lines,
    ``,
    `نحتاج فاتورة ضريبية تحمل رقمنا الضريبي${companyVat ? ` ${companyVat}` : ""} لنتمكّن من السداد.`,
    `شاكرين لكم.`,
  ].join("\n");
}
