/**
 * الاستلامُ الواحد لا يُحسَب مرّتين.
 *
 * الفاتورةُ والكمّيّةُ المستلَمة يدوياً قد تصفان **الشاحنةَ نفسَها**:
 * وصل البنُّ يومَ الأربعاء فكتبه صاحبُ المقهى، ثمّ وصلت فاتورتُه يومَ
 * الأحد. ولو جُمعا لصار العشرون أربعين — **وفرقُ الجرد يبتلع العشرين
 * الزائدة فائضاً لا وجودَ له**، أو يُخفي بها نقصاً حقيقيّاً.
 *
 * ── ثلاثُ حالاتٍ تُحفَظ صراحةً ──
 *
 * **مرتبط**: الاستلامُ هو الوجهُ الفعليّ لبندٍ بعينه — فيُحسَب هو ويخرج
 * البند. **منفصلٌ مؤكَّد**: شحنةٌ أخرى — فيُحسَب الاثنان. **لم يُراجَع**:
 * فإن وُجد بندٌ يشبهه فهذا احتمالٌ يُعرَض ولا يُحسَم — لا يُدمَج ولا
 * يُحذَف ولا يُحسَب مرّتين بصمت.
 *
 * ── ومتى يُعدّ البندُ «شبيهاً» ──
 *
 * الصنفُ نفسُه، وبين التاريخين سبعةُ أيّامٍ على الأكثر (نافذةُ
 * المطابقة في المشروع كلِّه)، والبندُ غيرُ مرتبطٍ باستلامٍ آخر، وكمّيّتُه
 * **مساويةٌ أو مجهولة**. والمجهولةُ أوّلُ ما يُشتبَه فيه: بندٌ بلا
 * مواصفةِ عبوة هو بالضبط ما يدفع صاحبَ المقهى إلى كتابة الكمّيّة بيده.
 * أمّا الكمّيّةُ المختلفة (عشرون مقابل ثمانية عشر) فلا تُعدّ تكراراً —
 * والتنبيهُ الذي يصيح في كلّ شحنة يُعلّم صاحبَه ألّا يقرأه.
 */

/** نافذةُ الشَّبَه بالأيّام — هي نافذةُ مطابقة الفاتورة في المشروع. */
export const RECEIPT_MATCH_WINDOW_DAYS = 7;

export interface ReceiptForMatch {
  id: string;
  productId: string;
  receivedOn: string;
  canonicalMilli: number;
}

export interface InvoiceLineForMatch {
  lineId: string;
  invoiceId: string;
  invoiceNumber: string;
  supplierName: string;
  productId: string;
  /** تاريخُ دخوله المعتمَد — الاستلامُ الحقيقيّ أو تاريخُ الفاتورة نائباً. */
  effectiveDate: string;
  /** كمّيّتُه بالمعياريّ، و`null` حين لا تُعرَف. */
  canonicalMilli: number | null;
  lineTotalMinor: number;
}

export interface DuplicateCandidate {
  receiptId: string;
  productId: string;
  invoiceLineId: string;
  invoiceNumber: string;
  supplierName: string;
  effectiveDate: string;
  canonicalMilli: number | null;
  /** مساويةٌ أم مجهولة — يُقال للمستخدم لِمَ اشتُبه. */
  basis: "SAME_QUANTITY" | "UNKNOWN_QUANTITY";
}

/** الفرقُ بالأيّام بين تاريخين `YYYY-MM-DD` — بلا منطقةٍ زمنيّة. */
export function daysApart(a: string, b: string): number {
  const t = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.abs(t(a) - t(b)) / 86_400_000;
}

/**
 * بنودُ الفواتير التي قد تكون الشحنةَ نفسَها.
 *
 * و`linkedLineIds` البنودُ المرتبطةُ باستلامٍ سارٍ — لا تُرشَّح ثانية،
 * فبندٌ واحد لا يمثّل شحنتين.
 */
export function duplicateCandidates(
  receipt: ReceiptForMatch,
  lines: readonly InvoiceLineForMatch[],
  linkedLineIds: ReadonlySet<string>,
): DuplicateCandidate[] {
  const out: DuplicateCandidate[] = [];
  for (const line of lines) {
    if (line.productId !== receipt.productId) continue;
    if (linkedLineIds.has(line.lineId)) continue;
    if (daysApart(line.effectiveDate, receipt.receivedOn) > RECEIPT_MATCH_WINDOW_DAYS) continue;

    let basis: DuplicateCandidate["basis"] | null = null;
    if (line.canonicalMilli === null) basis = "UNKNOWN_QUANTITY";
    else if (line.canonicalMilli === receipt.canonicalMilli) basis = "SAME_QUANTITY";
    if (basis === null) continue;

    out.push({
      receiptId: receipt.id,
      productId: receipt.productId,
      invoiceLineId: line.lineId,
      invoiceNumber: line.invoiceNumber,
      supplierName: line.supplierName,
      effectiveDate: line.effectiveDate,
      canonicalMilli: line.canonicalMilli,
      basis,
    });
  }
  /* الأقربُ تاريخاً أوّلاً — وهو الأرجح أن يكون هو */
  return out.sort((a, b) =>
    daysApart(a.effectiveDate, receipt.receivedOn) - daysApart(b.effectiveDate, receipt.receivedOn)
    || a.invoiceLineId.localeCompare(b.invoiceLineId));
}
