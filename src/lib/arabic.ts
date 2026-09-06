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
