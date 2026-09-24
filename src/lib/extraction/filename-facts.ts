/**
 * ما يقوله اسمُ الملفّ — حين يسكت النموذج.
 *
 * رأى أحمد (٢٤ سبتمبر ٢٠٢٦) فاتورةَ أوراق الزيتون «رقم الفاتورة 260391»
 * مطبوعاً واضحاً، والنظامُ يقول «رقم الفاتورة: لم يُقرأ». والاسمُ نفسه
 * «فاتورة - 260391 - مؤسسة ذا بوبليك هاوس.pdf» — كتبه نظامُ المورّد لا
 * نموذجُنا. فإن سكت النموذجُ عن حقلٍ والاسمُ ينطق به، أُخذ من الاسم.
 *
 * ولا يغلب الاسمُ ما قرأه النموذج: هو سدٌّ لفراغ لا تصحيحٌ لقراءة.
 * والأنماطُ مقيَّدةٌ بكلمةٍ تدلّ على الحقل («فاتورة» · «Invoice» · «INV»)
 * أو بموضعٍ معروف (تاريخٌ في أوّل الاسم، «SAR» قبل المبلغ) — فلا يُؤخَذ
 * رقمٌ لأنّه رقمٌ فحسب.
 */

import { normalizeDocumentDate } from "@/lib/document-date";
import { parseRiyals } from "@/lib/money";

export interface FileNameFacts {
  invoiceNumber: string | null;
  date: string | null;
  totalMinor: number | null;
}

export function factsFromFileName(fileName: string | null | undefined): FileNameFacts {
  const name = (fileName ?? "").replace(/\.(pdf|jpe?g|png|webp|heic)$/i, "");

  /* «فاتورة - 260391 -» · «فاتورة285558808» · «Invoice_283872236» · «INV-1234» */
  const number =
    name.match(/فاتورة\s*[-_#:]?\s*(\d{3,})/)?.[1]
    ?? name.match(/invoice[\s_#:-]*([A-Z]*\d[A-Za-z0-9/-]{2,})/i)?.[1]
    ?? name.match(/\bINV[\s_#:-]*(\d{3,})/i)?.[1]
    ?? null;

  /* تاريخٌ في أوّل الاسم — «2026-09-9_WesternRoastery…» — لا تاريخُ طباعةٍ في وسطه */
  const date = normalizeDocumentDate(name.match(/^(\d{4}-\d{1,2}-\d{1,2})(?=[_\s-]|$)/)?.[1] ?? null);

  /* «SAR845.25» */
  const amount = name.match(/SAR\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1];
  const totalMinor = amount ? parseRiyals(amount.replace(/,/g, "")) : null;

  return { invoiceNumber: number, date, totalMinor };
}
