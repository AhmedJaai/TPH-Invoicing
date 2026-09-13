/**
 * «كم أدين، ولمن؟» — جوابٌ واحد.
 *
 * كان المستحقّ يُحسَب في سبعة مواضع بطريقتين: مجموعُ ما بقي على كلّ
 * فاتورة. وذلك يُهمل مالاً دُفع للمورّد ولم يُخصم من فاتورة بعينها —
 * فلوريفا حُوِّل لها ٤٬١٥١٫٥٠ وبقي منها ٦٣٢٫٥٠ معلّقاً، وفواتيرها
 * الثلاث تُعدّ كاملةً في «عليك». ومورّدٌ عنده لنا ٢٩ ألفاً (غاناش) لا
 * يُنقص شيئاً ممّا علينا له، ومورّدٌ آخر لا يُرى رصيدُه لنا أصلاً.
 *
 * فالحسابُ هنا بالمورّد لا بالفاتورة (قرار «المورّد محور المستحقّات»):
 *
 *   المفتوح  = ما بقي على فواتيره (فوق هللة التقريب)
 *   رصيدُنا  = ما دفعناه له ولم يُخصم من فاتورة
 *   عليك له  = max(0, المفتوح − رصيدنا)
 *   لك عنده = max(0, رصيدنا − المفتوح)
 *
 * ولا يُخصم رصيدُ مورّدٍ من دَين مورّدٍ آخر: المالُ عند غاناش لا يسدّد
 * الكوب الذهبي.
 */

/** ما دون هللةٍ واحدة تقريبٌ لا دَين — فاتورة ١٥٠٠٫٠١ سُدّدت بـ١٥٠٠٫٠٠. */
export const SETTLED_TOLERANCE_MINOR = 1;

export interface SupplierBalanceInput {
  supplierId: string;
  billedMinor: number;
  /** مجموع ما بقي على فواتيره، والباقي دون الهللة لا يُعدّ. */
  openMinor: number;
  /** عدد فواتيره التي بقي عليها أكثر من هللة. */
  openCount: number;
  /** ما دفعناه له فعلاً: الدفعات القائمة ناقص رسومها. */
  paidNetMinor: number;
  /** ما دفعناه ولم يُخصم من فاتورة. */
  creditMinor: number;
}

export interface SupplierBalance extends SupplierBalanceInput {
  owedMinor: number;
  creditLeftMinor: number;
}

export function supplierBalance(input: SupplierBalanceInput): SupplierBalance {
  const open = Math.max(0, input.openMinor);
  const credit = Math.max(0, input.creditMinor);
  return {
    ...input,
    owedMinor: Math.max(0, open - credit),
    creditLeftMinor: Math.max(0, credit - open),
  };
}

export interface BalanceTotals {
  owedMinor: number;
  /** عدد المورّدين الذين علينا لهم. */
  owedSuppliers: number;
  /** مجموع ما بقي على الفواتير قبل خصم الأرصدة — للمقارنة بالرقم القديم. */
  openInvoicesMinor: number;
  openInvoiceCount: number;
  /** ما خُصم من المفتوح بأرصدةٍ لنا عند أصحابه. */
  offsetMinor: number;
  creditLeftMinor: number;
  creditSuppliers: number;
}

export function totalBalances(rows: readonly SupplierBalance[]): BalanceTotals {
  let owed = 0, owedSuppliers = 0, open = 0, openCount = 0, offset = 0, creditLeft = 0, creditSuppliers = 0;
  for (const r of rows) {
    owed += r.owedMinor;
    if (r.owedMinor > 0) owedSuppliers++;
    open += Math.max(0, r.openMinor);
    openCount += r.openCount;
    offset += Math.min(Math.max(0, r.openMinor), Math.max(0, r.creditMinor));
    creditLeft += r.creditLeftMinor;
    if (r.creditLeftMinor > 0) creditSuppliers++;
  }
  return {
    owedMinor: owed,
    owedSuppliers,
    openInvoicesMinor: open,
    openInvoiceCount: openCount,
    offsetMinor: offset,
    creditLeftMinor: creditLeft,
    creditSuppliers,
  };
}
