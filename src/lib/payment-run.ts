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

/**
 * ما يُدخله صاحبُ المال في الدفعة بقراره وهو محجوز (قاعدةُ ٧ أكتوبر ٢٠٢٦: يُنبَّه
 * ولا يُمنَع). أسبابُ الضريبة كلُّها — المالُ مالُه والضريبةُ المعرّضة تُقال له
 * بمبلغها. وما لم يُؤكَّد مستندُه يبقى: مبلغُه قرأه نموذجٌ ولم يره إنسان، وعلاجُه
 * ضغطةُ تأكيدٍ في ملفّه لا تجاوزٌ هنا.
 */
export const OVERRIDABLE_HOLDS: readonly HoldReason[] = ["NOT_TAX_VALID", "NO_VAT_DEDUCTION", "TAX_UNKNOWN"];

export function isOverridableHold(reason: HoldReason): boolean {
  return OVERRIDABLE_HOLDS.includes(reason);
}

/** قرارُ المالك بإدخال فاتورةٍ محجوزة — يُحفَظ بسببه (`payment_hold_overrides`). */
export interface HoldOverride {
  /** ما كتبه صاحبُ القرار سبباً. */
  note: string;
  byName?: string | null;
  at?: Date | null;
}

export interface SupplierPayment {
  supplierId: string;
  supplierName: string;
  invoices: PayableInvoice[];
  /** ما يُحوَّل فعلاً — بعد خصم رصيدٍ لنا عنده. */
  totalMinor: number;
  invoiceCount: number;
  /** رصيدٌ لنا عند المورّد خُصم من هذه الدفعة. */
  creditAppliedMinor: number;
  /**
   * ما كان سيُحوَّل لو دُفع المختارُ كلُّه — يحضر حين اختار صاحبُ الدفعة أن يدفع
   * جزءاً (`applyPartialAmounts`)، فيُقال «X من Y» ولا يُخفى الباقي.
   */
  fullMinor?: number;
}

export interface HeldInvoice {
  invoice: PayableInvoice;
  reason: HoldReason;
  message: string;
  /** حاضرٌ حين أدخلها المالكُ في الدفعة بقراره. */
  override?: HoldOverride;
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
   * محجوزاتٌ أدخلها المالكُ في الدفعة بقراره — هي في `ready` بمبالغها، وتُسرَد
   * هنا بسبب حجزها وسبب قراره كي يبقى التنبيهُ ظاهراً ويُرَدّ القرارُ إن شاء.
   */
  overridden: HeldInvoice[];
  /**
   * ضريبة مدخلات معرّضة: ما حُجز لأنّ خصمه لا يجوز — **وما أُدخل بقرار المالك
   * كذلك**، فالقرارُ يُدخل الفاتورة ولا يردّ ضريبتَها. وما ليست ضريبتُه مقروءة
   * يُعَدّ في `vatAtRiskUnknown` ولا يُجمَع صفراً.
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
    /** محجوزاتٌ قرّر المالكُ إدخالها — بمعرّف الفاتورة. ما لا يُتجاوَز حجزُه يبقى محجوزاً. */
    overrides?: ReadonlyMap<string, HoldOverride>;
    /** فواتيرُ جاهزةٌ استثناها صاحبُ الدفعة هذه المرّة — لا تُحوَّل ولا يُخصم لها رصيد. */
    excludeInvoiceIds?: ReadonlySet<string>;
  } = {},
): PaymentRun {
  const inScope = invoices.filter((i) => {
    const remaining = i.totalMinor - i.allocatedMinor;
    if (remaining <= SETTLED_TOLERANCE_MINOR) return false; // مسدَّدة (بتسامح هللة تقريب)
    return options.includeOlderUnpaid ? i.periodMonth <= month : i.periodMonth === month;
  });

  const held: HeldInvoice[] = [];
  const overridden: HeldInvoice[] = [];
  const payable: PayableInvoice[] = [];

  for (const inv of inScope) {
    const reason = holdReasonOf(inv);
    if (reason === null) {
      payable.push(inv);
      continue;
    }
    const override = isOverridableHold(reason) ? options.overrides?.get(inv.invoiceId) : undefined;
    if (override) {
      /* قرارُ المالك يُدخلها بمبلغها — والتنبيهُ يبقى معها ولا يُمحى */
      overridden.push({ invoice: inv, reason, message: HOLD_TEXT[reason], override });
      payable.push(inv);
    } else {
      held.push({ invoice: inv, reason, message: HOLD_TEXT[reason] });
    }
  }

  const bySupplier = new Map<string, SupplierPayment>();
  for (const inv of payable) {
    if (options.excludeInvoiceIds?.has(inv.invoiceId)) continue;
    const entry =
      bySupplier.get(inv.supplierId) ??
      { supplierId: inv.supplierId, supplierName: inv.supplierName, invoices: [], totalMinor: 0, invoiceCount: 0, creditAppliedMinor: 0 };
    entry.invoices.push(inv);
    entry.totalMinor += inv.totalMinor - inv.allocatedMinor;
    entry.invoiceCount++;
    bySupplier.set(inv.supplierId, entry);
  }

  for (const entry of bySupplier.values()) {
    const split = transferAfterCredit(entry.totalMinor, options.creditBySupplier?.get(entry.supplierId) ?? 0);
    entry.creditAppliedMinor = split.creditAppliedMinor;
    entry.totalMinor = split.transferMinor;
  }

  const all = [...bySupplier.values()];
  // ما لم يُقرأ أو لم يُؤكَّد لا يُعرَف أنّ ضريبته ضائعة — المعرّض ما لا يُخصم يقيناً
  const atRisk = [...held, ...overridden].filter((h) => h.reason === "NOT_TAX_VALID" || h.reason === "NO_VAT_DEDUCTION");
  const ready = all.filter((s) => s.totalMinor > 0).sort((a, b) => b.totalMinor - a.totalMinor);
  const coveredByCredit = all.filter((s) => s.totalMinor === 0);

  return {
    month,
    ready,
    coveredByCredit,
    readyTotalMinor: ready.reduce((s, r) => s + r.totalMinor, 0),
    held,
    heldTotalMinor: held.reduce((s, h) => s + (h.invoice.totalMinor - h.invoice.allocatedMinor), 0),
    overridden,
    vatAtRiskMinor: atRisk.reduce((s, h) => s + (h.invoice.vatMinor ?? 0), 0),
    vatAtRiskUnknown: atRisk.filter((h) => h.invoice.vatMinor === null).length,
  };
}

/** لِمَ تُحجَز هذه الفاتورة؟ — و`null` إن كانت تُدفَع. القاعدةُ واحدة للبناء ولمسار القرار. */
export function holdReasonOf(inv: Pick<PayableInvoice, "needsReview" | "taxStatus" | "inputVatStatus">): HoldReason | null {
  if (inv.needsReview) return "NEEDS_REVIEW";
  if (inv.taxStatus === "UNKNOWN") return "TAX_UNKNOWN";
  if (inv.taxStatus !== "VALID") return "NOT_TAX_VALID";
  if (inv.inputVatStatus !== "ELIGIBLE") return "NO_VAT_DEDUCTION";
  return null;
}

/**
 * ما يُحوَّل بعد خصم رصيدٍ لنا عند المورّد — أعدادٌ صحيحة بالهللات.
 * مصدرٌ واحد: الخادمُ يبني به الدفعة، والشاشةُ تعرض به أثرَ استثناء فاتورة
 * قبل أن تسأل الخادم (والملفُّ والقيدُ من الخادم دائماً).
 */
export function transferAfterCredit(openMinor: number, creditMinor: number): { transferMinor: number; creditAppliedMinor: number } {
  const open = Math.max(0, openMinor);
  const applied = Math.min(Math.max(0, creditMinor), open);
  return { transferMinor: open - applied, creditAppliedMinor: applied };
}

/**
 * «ادفع كذا فقط» — مبلغٌ جزئيّ لمورّدٍ من الجاهزين.
 *
 * المبلغُ يأتي من المتصفّح، فلا يُصدَّق إلّا بعد فحصه على ما بناه الخادم: عددٌ
 * صحيح بالهللات، فوق الصفر، ولا يزيد على ما سيُحوَّل له. والزائدُ **يُردّ ولا
 * يُقصّ** — المبلغُ المبدَّل بصمتٍ يُقرأ جواباً. ومبلغٌ يساوي الكلّ ليس جزئيّاً.
 */
export function applyPartialAmounts(
  run: PaymentRun,
  partialBySupplier: ReadonlyMap<string, number>,
): { run: PaymentRun; errors: string[] } {
  const errors: string[] = [];
  const known = new Set(run.ready.map((s) => s.supplierId));
  for (const id of partialBySupplier.keys()) {
    if (!known.has(id)) errors.push("مبلغٌ جزئيّ لمورّدٍ ليس بين الجاهزين — حدّث الصفحة");
  }
  const ready = run.ready.map((s) => {
    const partial = partialBySupplier.get(s.supplierId);
    if (partial === undefined) return s;
    if (!Number.isSafeInteger(partial) || partial <= 0) {
      errors.push(`${s.supplierName}: المبلغ الجزئيّ ليس مبلغاً صحيحاً`);
      return s;
    }
    if (partial > s.totalMinor) {
      errors.push(`${s.supplierName}: ${formatRiyals(partial)} أكبر ممّا يُحوَّل له (${formatRiyals(s.totalMinor)})`);
      return s;
    }
    return partial === s.totalMinor ? s : { ...s, totalMinor: partial, fullMinor: s.totalMinor };
  });
  return {
    run: { ...run, ready, readyTotalMinor: ready.reduce((sum, r) => sum + r.totalMinor, 0) },
    errors,
  };
}

/**
 * ما يبقى عليك للمورّد بعد هذه الدفعة — **ولا يُقصّ عند الصفر**.
 *
 * كان السطرُ `Math.max(0, …)`: فمن حوّل أكثر ممّا عليه (رصيدٌ دائن وصل بعد بناء
 * الدفعة، أو فاتورةٌ خارج «عليك») قرأ «يبقى 0.00» والزيادةُ خارجةٌ من ماله.
 */
export type AfterPayment =
  | { state: "unknown" }
  | { state: "remaining"; minor: number }
  | { state: "settled" }
  | { state: "over"; minor: number };

export function afterPayment(owedMinor: number | null, payingMinor: number): AfterPayment {
  if (owedMinor === null) return { state: "unknown" };
  const left = owedMinor - payingMinor;
  if (left > SETTLED_TOLERANCE_MINOR) return { state: "remaining", minor: left };
  if (left < -SETTLED_TOLERANCE_MINOR) return { state: "over", minor: -left };
  return { state: "settled" };
}

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
  /* ما أدخله المالكُ وهو محجوز يُسمّى في صفّ مورّده — إن كان بين فواتير الصفّ */
  const byOwner = new Map<string, string[]>();
  for (const o of run.overridden) {
    const supplier = run.ready.find((s) => s.invoices.some((i) => i.invoiceId === o.invoice.invoiceId));
    if (!supplier) continue;
    byOwner.set(supplier.supplierId, [...(byOwner.get(supplier.supplierId) ?? []), o.invoice.invoiceNumber]);
  }
  const ownerNote = (numbers: string[] | undefined) =>
    numbers && numbers.length > 0 ? `بقرار المالك وهي محجوزة: ${numbers.join(" | ")}` : null;
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
      s.fullMinor === undefined ? `سداد فواتير ${run.month}` : `سداد جزئيّ من فواتير ${run.month}`,
      [
        acc.note,
        /* الجزئيُّ يُقال بمبلغيه: من يرفع الملفَّ يرى أنّ الباقي لم يُنسَ */
        s.fullMinor === undefined ? null : `دفعٌ جزئيّ: ${formatRiyals(s.totalMinor)} من ${formatRiyals(s.fullMinor)}`,
        ownerNote(byOwner.get(s.supplierId)),
      ].filter(Boolean).join(" — "),
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
