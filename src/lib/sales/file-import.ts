/**
 * أنواعُ استيراد ملفّ المبيعات — مشتركةٌ بين المحوّلات.
 *
 * والمخرَجُ هنا قريبٌ عمداً من `SalesTransaction` في `connector.ts`:
 * فحين تأتي واجهةُ فودكس تُغذّي **المسار نفسه**، ولا يُعاد بناءُ شيء
 * بعد هذه النقطة. الفرقُ الوحيد أنّ الملفّ يحمل ما لا تحمله الواجهة
 * — رقمَ الصفّ، وسببَ الرفض، والصفَّ الخام.
 */
import type { SalesTransaction } from "./connector";

export type ParsedRowStatus = "PARSED" | "SKIPPED" | "ERROR" | "DUPLICATE";

export interface ParsedSaleLine {
  /** فريدٌ داخل البيعة — عليه يقوم منعُ التكرار عند إعادة الاستيراد. */
  externalId: string;
  productExternalId: string;
  name: string;
  category: string | null;
  /** بالمِلّي: ١٠٠ مشروبٍ = ‏١٠٠٬٠٠٠. */
  quantityMilli: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  isRefund: boolean;
  isVoid: boolean;
  isComplimentary: boolean;
  modifiers: string[] | null;
  /** أرقامُ الصفوف التي كوّنته — أثرٌ يُعاد منه إلى الملفّ. */
  rowNumbers: number[];
}

export interface ParsedSale {
  externalId: string;
  businessDate: string;
  soldAt: Date;
  branchLabel: string | null;
  grossMinor: number;
  discountMinor: number;
  refundMinor: number;
  vatMinor: number;
  netMinor: number;
  orderCount: number;
  isVoid: boolean;
  lines: ParsedSaleLine[];
}

export interface ParsedRow {
  rowNumber: number;
  raw: Record<string, string>;
  status: ParsedRowStatus;
  reason: string | null;
  saleExternalId: string | null;
}

export interface ParsedSalesFile {
  adapter: string;
  shape: string;
  sales: ParsedSale[];
  /** **كلُّ** صفّ، بحاله وسببه — ولا صفَّ يُرمى صامتاً. */
  rows: ParsedRow[];
  periodStart: string | null;
  periodEnd: string | null;
  /** حدودُ القراءة وما قُصّ — تُعرَض دائماً لا عند الخطأ. */
  warnings: string[];
  /** أيُّ ترويسةٍ فُهمت وأيُّها لم تُفهَم — فالكشفُ عن العمود قبل الشكوى منه. */
  recognisedColumns: string[];
  unrecognisedColumns: string[];
  /** حين يتعذّر أصلاً: سببٌ يُقرأ، لا خطأٌ تقنيّ. */
  blocked?: string;
}

export interface ParseOptions {
  /**
   * يومُ العمل حين لا يذكره الملفّ.
   *
   * ولا يُخترَع: إن لم يذكره الملفّ ولم يُعطَه المستخدم **تُردّ الصفوف
   * بسببها** — فبيعةٌ في اليوم الخطأ تُحسَب بوصفةٍ أخرى، وهو خطأٌ
   * صامت يتسلّل إلى تقريرٍ يبدو سليماً.
   */
  fallbackBusinessDate?: string;
  branchLabel?: string;
}

/** ما يجب أن يوفّره كلُّ محوّلِ ملفّ مبيعات. */
export interface SalesFileAdapter {
  readonly name: string;
  /** أيعرف هذا الملفّ؟ — بالترويسات لا باسم الملفّ. */
  detect(grid: readonly string[][]): boolean;
  parse(grid: readonly string[][], options: ParseOptions): ParsedSalesFile;
}

/** جسرٌ إلى نوع الموصل — يثبت أنّ الطريقين يلتقيان عند نوعٍ واحد. */
export function toSalesTransactions(file: ParsedSalesFile): SalesTransaction[] {
  return file.sales.map((s) => ({
    externalId: s.externalId,
    soldAt: s.soldAt,
    businessDate: s.businessDate,
    grossMinor: s.grossMinor,
    discountMinor: s.discountMinor,
    refundMinor: s.refundMinor,
    vatMinor: s.vatMinor,
    netMinor: s.netMinor,
    lines: s.lines.map((l) => ({
      externalProductId: l.productExternalId,
      name: l.name,
      category: l.category ?? undefined,
      quantity: l.quantityMilli / 1000,
      unitPriceMinor: l.unitPriceMinor,
      lineTotalMinor: l.lineTotalMinor,
    })),
  }));
}
