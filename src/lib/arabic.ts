/**
 * تمييز العدد في العربية.
 *
 * «٢ بنداً» خطأ؛ الصواب «بندان». و«١١ بنود» خطأ؛ الصواب «١١ بنداً».
 * والقاعدة: الواحد والاثنان لهما صيغتاهما، ومن ثلاثة إلى عشرة جمعٌ،
 * ومن أحد عشر فصاعداً مفردٌ منصوب — ثمّ تعود الدورة عند المئة.
 */

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

export const TRANSACTION: NounForms = {
  one: "حركة واحدة",
  two: "حركتان",
  few: "حركات",
  many: "حركة",
  zero: "لا حركات",
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

export const IMPORT: NounForms = {
  one: "عملية استيراد واحدة",
  two: "عمليّتا استيراد",
  few: "عمليات استيراد",
  many: "عملية استيراد",
  zero: "لا عمليات استيراد",
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
