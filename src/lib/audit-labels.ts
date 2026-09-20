/**
 * تسمية القيم الإنجليزيّة في سجلّ التدقيق.
 *
 * كان السجلّ يكتب ما في `jsonb` كما هو: «النوع: MISSING_INVOICES»
 * و«الباب: BANK_FEE». والسجلّ مرجعٌ يُقرأ عند الخلاف — فمن يقرؤه أحمد
 * أو محاسبُه، وكلاهما لا يقرأ أسماء الثوابت في الشيفرة.
 *
 * والقوائم مغلقة، فالتسمية تُؤخذ من مصدرها لا تُكتب ثانيةً: أنواع
 * اقتراحات التحليل من `finding-labels`، وأبواب حركة البنك من `rules`.
 * ومن أضاف نوعاً أو باباً جديداً أوقفه الاختبار حتى يسمّيه.
 */
import { FINDING_LABEL } from "./ai/finding-labels";
import { CATEGORY_LABEL } from "./bank/rules";

/** قيمٌ إنجليزيّة أخرى تظهر في السجلّ ولا تنتمي إلى قائمةٍ مغلقة. */
const OTHER_VALUE_LABEL: Record<string, string> = {
  SPREADSHEET: "جدول (Excel أو CSV)",
  PDF: "ملفّ PDF",
  IMAGE: "صورة",
  TEXT: "نصّ",
  OWNER: "المالك",
  ACCOUNTANT: "المحاسب",
  PURCHASING: "مدير المشتريات",
  DEBIT: "صادر",
  CREDIT: "وارد",
  /* أبوابُ الهدر وحركاتُ المخزون — قوائمُ مغلقة في `036` */
  EXPIRED: "منتهي الصلاحية",
  SPILLED: "مسكوب",
  FAILED_PREP: "تحضيرٌ فاشل",
  CALIBRATION: "معايرة",
  STAFF_DRINK: "مشروب موظَّف",
  DAMAGED: "تالف",
  OTHER: "سببٌ آخر",
  OPENING: "رصيدٌ افتتاحيّ",
  ADJUST_IN: "تسويةٌ بالزيادة",
  ADJUST_OUT: "تسويةٌ بالنقص",
  TRANSFER_IN: "نقلٌ وارد",
  TRANSFER_OUT: "نقلٌ صادر",
};

export const VALUE_LABEL: Record<string, string> = {
  ...FINDING_LABEL,
  ...CATEGORY_LABEL,
  ...OTHER_VALUE_LABEL,
};

/**
 * القيمة كما تُقرأ. وما لا تسمية له يبقى كما هو — فإخفاؤه أسوأ من
 * عرضه بالإنجليزيّة: السجلّ لا يُخفي شيئاً وقع.
 */
export function labelValue(value: unknown): string {
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  const raw = String(value);
  return VALUE_LABEL[raw] ?? raw;
}
