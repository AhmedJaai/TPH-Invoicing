/**
 * بوّابة الإنتاج.
 *
 * الغرض منها أن يستحيل قولُ «جاهز» بلا دليل. فليست تقريراً يُكتَب بل
 * **حكماً يُشتقّ** من فحوصٍ تجري فعلاً، وأيُّ `FAIL` يمنع الإعلان.
 *
 * وثلاثةُ أحكامٍ لا اثنان — وهذا هو بيت القصيد:
 *
 *   PASS     فُحص فنجح.
 *   FAIL     فُحص ففشل.
 *   UNKNOWN  **لم يُفحَص.**
 *
 * و`UNKNOWN` تمنع الجاهزية كما تمنعها `FAIL`. لأنّ «لم نتحقّق» ليست
 * «لا بأس»: بوّابةٌ تعدّ غير المفحوص ناجحاً تُصدر شهادةً عن أشياء لم
 * تُنظَر — وهي أخطر من ألّا تكون هناك بوّابة، إذ تُنتج ثقةً بلا سند.
 *
 * ولذلك بندٌ لا يُفحَص آلياً — كتدوير مفتاحٍ بيد إنسان — يبقى `UNKNOWN`
 * حتى يُقِرّ الإنسان صراحةً أنّه فعله. ولا يُكتَب `PASS` بالنيّة.
 */

export type GateStatus = "PASS" | "FAIL" | "UNKNOWN";

export interface GateCheck {
  key: string;
  label: string;
  status: GateStatus;
  /** ما الذي فُحص وماذا وُجد — لا «تمّ». */
  detail: string;
  /** الأمر أو الفعل الذي يُغيّر الحال. */
  remedy?: string;
  /** بيد إنسان لا بيد أمر — فلا يُنتظَر أن يصير `PASS` وحده. */
  manual?: boolean;
}

export interface GateReport {
  checks: GateCheck[];
  ready: boolean;
  failed: number;
  unknown: number;
  verdict: string;
}

/** ترتيب العرض: من الأساس إلى ما فوقه. */
export const GATE_ORDER: readonly string[] = [
  "migration_integrity",
  "database_integrity",
  "financial_invariants",
  "bank_reconciliation",
  "invoice_lifecycle",
  "payment_lifecycle",
  "supplier_statements",
  "month_close",
  "review_workflow",
  "audit_trail",
  "drive_integrity",
  "preview_isolation",
  "security_scan",
  "end_to_end_tests",
  "real_data_verification",
];

export const GATE_LABEL: Record<string, string> = {
  migration_integrity: "سلامة الهجرات",
  database_integrity: "سلامة القاعدة",
  financial_invariants: "الثوابت المالية",
  bank_reconciliation: "تسوية البنك",
  invoice_lifecycle: "دورة حياة الفاتورة",
  payment_lifecycle: "دورة حياة الدفعة",
  supplier_statements: "كشوف المورّدين",
  month_close: "إقفال الشهر",
  review_workflow: "مسار المراجعة",
  audit_trail: "سجلّ التدقيق",
  drive_integrity: "سلامة الأرشيف",
  preview_isolation: "عزل المعاينة عن الإنتاج",
  security_scan: "الفحص الأمنيّ",
  end_to_end_tests: "اختبار الدورة كاملةً",
  real_data_verification: "التحقّق على بيانات حقيقية",
};

/**
 * يبني الحكم.
 *
 * وكلّ بندٍ في `GATE_ORDER` يجب أن يُذكَر — وما لم يُذكَر يُضاف
 * `UNKNOWN` صراحةً. فالبند الساقط سهواً لا يجوز أن يختفي من التقرير:
 * اختفاؤه يجعل البوّابة تبدو أنقى ممّا هي.
 */
export function buildGate(checks: readonly GateCheck[]): GateReport {
  const byKey = new Map(checks.map((c) => [c.key, c]));

  const ordered: GateCheck[] = GATE_ORDER.map(
    (key) =>
      byKey.get(key) ?? {
        key,
        label: GATE_LABEL[key] ?? key,
        status: "UNKNOWN",
        detail: "لم يُفحَص — والبند الساقط لا يجوز أن يختفي من التقرير",
      },
  );

  const failed = ordered.filter((c) => c.status === "FAIL").length;
  const unknown = ordered.filter((c) => c.status === "UNKNOWN").length;
  const ready = failed === 0 && unknown === 0;

  return {
    checks: ordered,
    ready,
    failed,
    unknown,
    verdict: ready
      ? "جاهز للإنتاج — كلّ بندٍ فُحص ونجح."
      : failed > 0
        ? `غير جاهز: ${failed} بنداً فشل${unknown > 0 ? ` و${unknown} لم يُفحَص` : ""}.`
        : `غير جاهز: ${unknown} بنداً لم يُفحَص. و«لم نتحقّق» ليست «لا بأس».`,
  };
}

/** رمزٌ يُطبَع — والمجهول يُميَّز عن الفاشل، فهما حالان لا حال. */
export const GATE_MARK: Record<GateStatus, string> = {
  PASS: "PASS", FAIL: "FAIL", UNKNOWN: "  ? ",
};
