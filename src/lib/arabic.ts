/**
 * تمييز العدد في العربية.
 *
 * «٢ بنداً» خطأ؛ الصواب «بندان». و«١١ بنود» خطأ؛ الصواب «١١ بنداً».
 * والقاعدة: الواحد والاثنان لهما صيغتاهما، ومن ثلاثة إلى عشرة جمعٌ،
 * ومن أحد عشر فصاعداً مفردٌ منصوب — ثمّ تعود الدورة عند المئة.
 */
import { daysSinceRiyadh, todayInRiyadh } from "./riyadh-time";

export interface NounForms {
  /** بند */
  one: string;
  /** بندان */
  two: string;
  /** بنود — من ٣ إلى ١٠ */
  few: string;
  /** بنداً — من ١١ فصاعداً */
  many: string;
  /** لا بنود */
  zero?: string;
}

export function nounForm(n: number, f: NounForms): string {
  const abs = Math.abs(Math.trunc(n));
  if (abs === 0) return f.zero ?? f.many;
  if (abs === 1) return f.one;
  if (abs === 2) return f.two;

  const rest = abs % 100;
  if (rest >= 3 && rest <= 10) return f.few;
  return f.many;
}

/**
 * العدد ومميّزه معاً — ويُحذف العدد مع الواحد والاثنين لأنّ الصيغة
 * تحمله: «بند واحد» لا «١ بند واحد».
 */
export function countNoun(n: number, f: NounForms): string {
  const abs = Math.abs(Math.trunc(n));
  const word = nounForm(abs, f);
  if (abs === 0) return word;
  if (abs === 1 || abs === 2) return word;
  return `${abs} ${word}`;
}

export const ITEM: NounForms = {
  one: "بند واحد",
  two: "بندان",
  few: "بنود",
  many: "بنداً",
  zero: "لا بنود",
};

export const PAGE: NounForms = {
  one: "صفحة واحدة",
  two: "صفحتان",
  few: "صفحات",
  many: "صفحة",
  zero: "لا صفحات",
};

export const TRANSACTION: NounForms = {
  one: "حركة واحدة",
  two: "حركتان",
  few: "حركات",
  many: "حركة",
  zero: "لا حركات",
};

export const TRANSFER: NounForms = {
  one: "حوالة واحدة",
  two: "حوالتان",
  few: "حوالات",
  many: "حوالة",
  zero: "لا حوالات",
};

export const EMPLOYEE: NounForms = {
  one: "موظف واحد",
  two: "موظفان",
  few: "موظفين",
  many: "موظفاً",
  zero: "لا موظفين",
};

export const TIME: NounForms = {
  one: "مرّة واحدة",
  two: "مرّتين",
  few: "مرّات",
  many: "مرّة",
  zero: "لا مرّة",
};

export const INVOICE: NounForms = {
  one: "فاتورة واحدة",
  two: "فاتورتان",
  few: "فواتير",
  many: "فاتورة",
  zero: "لا فواتير",
};

export const DOCUMENT: NounForms = {
  one: "مستند واحد",
  two: "مستندان",
  few: "مستندات",
  many: "مستنداً",
  zero: "لا مستندات",
};

export const MONTH: NounForms = {
  one: "شهر واحد",
  two: "شهران",
  few: "أشهر",
  many: "شهراً",
  zero: "لا أشهر",
};

export const STATEMENT: NounForms = {
  one: "كشف واحد",
  two: "كشفان",
  few: "كشوف",
  many: "كشفاً",
  zero: "لا كشوف",
};

export const PRODUCT: NounForms = {
  one: "صنف واحد",
  two: "صنفان",
  few: "أصناف",
  many: "صنفاً",
  zero: "لا أصناف",
};

export const RECIPE: NounForms = {
  one: "وصفة واحدة",
  two: "وصفتين",
  few: "وصفات",
  many: "وصفة",
  zero: "لا وصفات",
};

export const SUPPLIER: NounForms = {
  one: "مورّد واحد",
  two: "مورّدان",
  few: "مورّدين",
  many: "مورّداً",
  zero: "لا مورّدين",
};

export const WARNING: NounForms = {
  one: "تنبيه واحد",
  two: "تنبيهان",
  few: "تنبيهات",
  many: "تنبيهاً",
  zero: "لا تنبيهات",
};

export const SUGGESTION: NounForms = {
  one: "اقتراح واحد",
  two: "اقتراحان",
  few: "اقتراحات",
  many: "اقتراحاً",
  zero: "لا اقتراحات",
};

/** «وبندان آخران في القائمة» — الصفةُ تتبع العدد كما يتبعه المعدود */
export const OTHER_ITEM: NounForms = {
  one: "بند آخر",
  two: "بندان آخران",
  few: "بنود أخرى",
  many: "بنداً آخر",
  zero: "لا بنود أخرى",
};

/** الفعلُ بعد المعدود: «تنبيه لا يمنع» · «تنبيهان لا يمنعان» · «٥ تنبيهات لا تمنع» */
export function doesNotBlock(n: number): string {
  const abs = Math.abs(Math.trunc(n));
  return abs === 1 ? "لا يمنع" : abs === 2 ? "لا يمنعان" : "لا تمنع";
}

/** «مانع يجب حلّه» · «مانعان يجب حلّهما» · «٣ موانع يجب حلّها» */
export function mustBeResolved(n: number): string {
  const abs = Math.abs(Math.trunc(n));
  return abs === 1 ? "يجب حلّه" : abs === 2 ? "يجب حلّهما" : "يجب حلّها";
}

export const ORDER: NounForms = {
  one: "طلب واحد",
  two: "طلبان",
  few: "طلبات",
  many: "طلباً",
  zero: "لا طلبات",
};

export const CHECK: NounForms = {
  one: "فحص واحد",
  two: "فحصان",
  few: "فحوص",
  many: "فحصاً",
  zero: "لا فحوص",
};

export const BLOCKER: NounForms = {
  one: "مانع واحد",
  two: "مانعان",
  few: "موانع",
  many: "مانعاً",
  zero: "لا موانع",
};

export const PAYMENT: NounForms = {
  one: "سدادٌ واحد",
  two: "سدادان",
  few: "مدفوعات",
  many: "سداداً",
  zero: "لا مدفوعات",
};

export const DAY: NounForms = {
  one: "يوم واحد",
  two: "يومان",
  few: "أيّام",
  many: "يوماً",
  zero: "لا أيّام",
};

/** مدّةُ الانتظار عند زرٍّ يعمل («منذ ١٢ ثانية») — `BusyStatus`. */
export const SECOND: NounForms = {
  one: "ثانية واحدة",
  two: "ثانيتين",
  few: "ثوانٍ",
  many: "ثانية",
  zero: "لحظة",
};

export const ALIAS: NounForms = {
  one: "اسم بديل واحد",
  two: "اسمان بديلان",
  few: "أسماء بديلة",
  many: "اسماً بديلاً",
  zero: "لا أسماء بديلة",
};

export const LINE: NounForms = {
  one: "سطر واحد",
  two: "سطران",
  few: "أسطر",
  many: "سطراً",
  zero: "لا أسطر",
};

export const GROUP: NounForms = {
  one: "مجموعة واحدة",
  two: "مجموعتان",
  few: "مجموعات",
  many: "مجموعة",
  zero: "لا مجموعات",
};

export const FILE: NounForms = {
  one: "ملفّ واحد",
  two: "ملفّان",
  few: "ملفّات",
  many: "ملفّاً",
  zero: "لا ملفّات",
};

/** الدفعة المسجَّلة (سجلٌّ في `payments`) — غيرُ «السداد» فعلاً. */
export const PAYMENT_RECORD: NounForms = {
  one: "دفعة واحدة",
  two: "دفعتان",
  few: "دفعات",
  many: "دفعة",
  zero: "لا دفعات",
};

export const GAP: NounForms = {
  one: "فجوة واحدة",
  two: "فجوتان",
  few: "فجوات",
  many: "فجوة",
  zero: "لا فجوات",
};

export const OPPORTUNITY: NounForms = {
  one: "فرصة واحدة",
  two: "فرصتان",
  few: "فرص",
  many: "فرصة",
  zero: "لا فرص",
};

export const FIELD: NounForms = {
  one: "حقلٌ واحد",
  two: "حقلان",
  few: "حقول",
  many: "حقلاً",
  zero: "لا حقول",
};

export const QUOTATION: NounForms = {
  one: "عرض سعر واحد",
  two: "عرضا سعر",
  few: "عروض أسعار",
  many: "عرض سعر",
  zero: "لا عروض أسعار",
};

/** سببُ نقصٍ في فاتورة — «وسببان غيره». */
export const REASON: NounForms = {
  one: "سببٌ واحد",
  two: "سببان",
  few: "أسباب",
  many: "سبباً",
  zero: "لا أسباب",
};

/* ── الزمنُ النسبيّ في الإشعارات: «قبل ٥ دقائق» لا «قبل 5 د» ── */

export const MINUTE: NounForms = {
  one: "دقيقة",
  two: "دقيقتين",
  few: "دقائق",
  many: "دقيقة",
  zero: "لحظات",
};

export const HOUR: NounForms = {
  one: "ساعة",
  two: "ساعتين",
  few: "ساعات",
  many: "ساعة",
  zero: "لحظات",
};

export const DAY_AGO: NounForms = {
  one: "يوم",
  two: "يومين",
  few: "أيّام",
  many: "يوماً",
  zero: "لحظات",
};

/**
 * «منذ متى» بالعربية: الآن · قبل دقيقة · قبل ٣ ساعات · أمس · قبل ٥ أيّام.
 * والمجرورُ بعد «قبل» يأخذ صيغة المثنّى المجرور («قبل ساعتين»).
 *
 * و«أمس» يومُ التقويم بتوقيت الرياض لا «بين ٢٤ و٤٨ ساعة»: كانت تسميةُ الخميس
 * فجراً تُقرأ «أمس» صباحَ السبت، وبجانبها «الخميس، 24 سبتمبر» — فتناقضا.
 * وما وقع قبل ساعاتٍ قليلة يبقى بساعاته وإن عبر منتصفَ الليل.
 */
export function timeAgo(iso: string | Date, at: Date = new Date()): string {
  const when = new Date(iso);
  const m = Math.floor((at.getTime() - when.getTime()) / 60000);
  if (m < 1) return "الآن";
  if (m < 60) return `قبل ${countNoun(m, MINUTE)}`;
  const h = Math.floor(m / 60);
  const days = daysSinceRiyadh(todayInRiyadh(when), at);
  if (days === 0 || h < 6) return `قبل ${countNoun(h, HOUR)}`;
  if (days === 1) return "أمس";
  return `قبل ${countNoun(days, DAY_AGO)}`;
}
