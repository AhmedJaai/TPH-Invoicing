/**
 * متى يُؤرشَف ما قرأه النموذج بلا مراجعة؟
 *
 * كان كلُّ ما قرأه النموذج من ملفٍّ لا يُفهم اسمُه «ينتظر المراجعة» — لأنّ
 * القراءة قد تُخطئ في رقمٍ وتبقى متّسقةً حسابياً. فسأل أحمد (٢٤ سبتمبر
 * ٢٠٢٦): «ليش ما دخلها أوتوماتيك؟»، ووافق على أن يدخل وحده ما اجتمعت فيه
 * أربعةُ شروط، **كلُّ واحدٍ منها يسدّ باباً للخطأ لا يسدّه غيره**:
 *
 *   ١. **قُرئ من نصٍّ مكتوب في الملفّ** — الرقمُ فيه منقولٌ لا مقروءٌ ظنّاً.
 *      والصورةُ الممسوحة تُقرأ بالعين الآليّة، وهناك يقع الخطأ الواثق.
 *   ٢. **الرقمُ الضريبيّ للبائع يطابق المورّد المسجَّل** — فالفاتورةُ من
 *      المورّد الذي نظنّ، لا من اسمٍ يشبهه.
 *   ٣. **الحسابُ مستقيم**: قبل الضريبة + الضريبة = الإجمالي (بتسامح ريالٍ
 *      كما في القاعدة). والمجهولُ هنا ليس استقامة.
 *   ٤. **المورّدُ معروفٌ عندنا.**
 *
 * وما لم يجتمع فيه الأربعة يبقى للإنسان، **ويُقال له أيُّها لم يتحقّق** —
 * فالمراجعةُ تُوجَّه إلى موضع الشكّ لا إلى المستند كلِّه.
 *
 * دالّةٌ خالصة: تُستدعى في المزامنة لتقرّر، وفي لوح المراجعة لتشرح —
 * فلا يفترق القرارُ عن تفسيره.
 */

import { TOTAL_ROUNDING_TOLERANCE_MINOR } from "@/lib/money";

export interface AutoArchiveFacts {
  /** نوعُ المستند كما قرأه النموذج — والآليّ للفواتير وحدها. */
  kind: string | null;
  /** أقُيّدت له فاتورة؟ — ما لم يُقيَّد لا يُؤرشَف آلياً. */
  invoiceRecorded: boolean;
  textSource: string | null;
  supplierKnown: boolean;
  sellerVat: string | null;
  supplierVat: string | null;
  subtotalMinor: number | null;
  vatMinor: number | null;
  totalMinor: number | null;
  /** عُرف المورّدُ من مجلّده في الدرايف — اسمٌ كتبه إنسان، لا تخمينٌ من النموذج. */
  supplierByFolder?: boolean;
  /** الرقمُ الضريبيّ المقروء مسجَّلٌ لمورّدٍ آخر؟ */
  vatTakenByOther?: boolean;
}

export type AutoArchiveGap =
  | "NOT_INVOICE"
  | "NOT_RECORDED"
  | "NOT_TEXT"
  | "SUPPLIER_UNKNOWN"
  | "VAT_MISMATCH"
  | "VAT_UNKNOWN"
  | "ARITHMETIC";

export interface AutoArchiveVerdict {
  auto: boolean;
  gaps: AutoArchiveGap[];
  /**
   * رقمٌ ضريبيّ يُسجَّل للمورّد لأوّل مرّة — حين لا رقمَ له عندنا.
   *
   * «كلّها فيها المعلومات» (أحمد، ٢٤ سبتمبر): وأكثرُ المورّدين لا رقمَ
   * ضريبيّاً مسجَّلاً لهم، فكان الشرطُ الثاني يُسقط فواتيرهم كلَّها ولو
   * طُبع الرقمُ عليها. فيُتعلَّم الرقمُ مرّةً بثلاثة أدلّة معاً: قُرئ من
   * نصٍّ مكتوب لا من صورة، وصيغتُه صيغةُ الهيئة (١٥ رقماً تبدأ بـ٣ وتنتهي
   * بـ٣)، والمورّدُ عُرف من مجلّده لا من تخمين النموذج — ولا يحمله مورّدٌ
   * آخر. ثمّ تُقابَل به فواتيرُه كلُّها بعدها.
   */
  learnVat: string | null;
}

/** ما يُقال لصاحب المقهى عن كلّ شرطٍ لم يتحقّق — ومعه ما يقارنه بالورقة. */
export const GAP_TEXT: Record<AutoArchiveGap, string> = {
  NOT_INVOICE: "ليس فاتورة — الإيصالاتُ والكشوفُ تُعتمَد بيد",
  NOT_RECORDED: "لم تكفِ القراءةُ لقيد فاتورة — مورّدٌ أو مبلغٌ أو تاريخٌ لم يُعرَف",
  NOT_TEXT: "قُرئ من صورةٍ ممسوحة — قارن الأرقامَ بالورقة",
  SUPPLIER_UNKNOWN: "المورّدُ لم يُعرَف — تحقّق من اسمه",
  VAT_MISMATCH: "الرقمُ الضريبيّ لا يطابق المورّد المسجَّل — تحقّق من المورّد",
  VAT_UNKNOWN: "لا رقمَ ضريبيّاً يُقارَن — مقروءاً أو مسجَّلاً عند المورّد",
  ARITHMETIC: "الحسابُ لا يستقيم أو ينقصه رقم — قارن الإجمالي والضريبة بالورقة",
};

/** الضريبيّةُ والمبسّطة — والمبسّطةُ مستحقّةٌ الدفعَ وإن لم يُخصم مدخلُها. */
const INVOICE_KINDS = new Set(["TAX_INVOICE", "SIMPLIFIED_INVOICE"]);

/** صيغةُ الرقم الضريبيّ عند الهيئة: خمسةَ عشر رقماً، أوّلُها ٣ وآخرُها ٣. */
const ZATCA_VAT = /^3\d{13}3$/;

/** يُسقط الفراغ وما ليس رقماً — «3100 0797 16» و«310007971600003» رقمٌ واحد. */
function digits(value: string | null): string {
  return (value ?? "").replace(/\D/g, "");
}

export function autoArchive(f: AutoArchiveFacts): AutoArchiveVerdict {
  const gaps: AutoArchiveGap[] = [];

  if (!INVOICE_KINDS.has(f.kind ?? "")) gaps.push("NOT_INVOICE");
  else if (!f.invoiceRecorded) gaps.push("NOT_RECORDED");

  if (f.textSource !== "TEXT") gaps.push("NOT_TEXT");
  if (!f.supplierKnown) gaps.push("SUPPLIER_UNKNOWN");

  const seller = digits(f.sellerVat);
  const registered = digits(f.supplierVat);
  let learnVat: string | null = null;
  if (f.vatTakenByOther && seller && seller !== registered) gaps.push("VAT_MISMATCH");
  else if (!registered && seller && f.textSource === "TEXT" && f.supplierByFolder && ZATCA_VAT.test(seller)) {
    learnVat = seller;
  } else if (!seller || !registered) gaps.push("VAT_UNKNOWN");
  else if (seller !== registered) gaps.push("VAT_MISMATCH");

  if (
    f.subtotalMinor === null || f.vatMinor === null || f.totalMinor === null
    || Math.abs(f.subtotalMinor + f.vatMinor - f.totalMinor) > TOTAL_ROUNDING_TOLERANCE_MINOR
  ) {
    gaps.push("ARITHMETIC");
  }

  return { auto: gaps.length === 0, gaps, learnVat: gaps.length === 0 ? learnVat : null };
}
