/**
 * الاسم القياسيّ للملفّ — مشتقّاً ممّا هو مقيَّد، لا ممّا يُخمَّن.
 *
 * الأرشيف كلّه يتبع صيغةً واحدة: تاريخٌ، فمورّد، فنوعٌ، فإجماليّ. وما
 * يُرفَع باليد يخرج عنها — «فاتورة ٣.pdf» أو «IMG_2041.jpg» — فيصير
 * الأرشيف نصفَ منظَّم: نصفٌ يُقرأ اسمُه ونصفٌ يحتاج فتحَ الملفّ.
 *
 * وهذه الوحدة تقول ما **ينبغي** أن يكون عليه الاسم لمستندٍ مقيَّد،
 * وتقارنه بما هو عليه. ولا تكتب شيئاً: الكتابة فعلُ إنسانٍ في شاشة.
 *
 * **ولا تُقترَح تسميةٌ من فراغ.** الاسم يُبنى من حقولٍ مقيَّدة في
 * القاعدة — المورّد والتاريخ والإجماليّ ورقم الفاتورة. فإن نقص منها
 * ما يُميّز، لا يُقترَح شيء ويُقال «لا يُبنى له اسم». والصمت هنا أصدق
 * من اسمٍ يبدو قياسيّاً ويحمل معلومةً مخترَعة.
 */
import {
  buildInvoiceFileName, buildStatementFileName, looksLikeExtension, parseFileName, type ParsedFileName,
} from "./naming";
import { invoiceNumberKey } from "./invoice-twin";

export interface NamedDocument {
  driveFileId: string;
  fileName: string;
  kind: string;
  /** المورّد كما هو مقيَّد — الاسم المختصر في الأرشيف. */
  slug: string | null;
  /** تاريخ الفاتورة أو الكشف: YYYY-MM-DD */
  date: string | null;
  totalMinor: number | null;
  invoiceNumber: string | null;
  /** نوعُ المحتوى المقيَّد — منه يُعرَف الامتداد حين لا يحمله الاسم. */
  mimeType?: string | null;
  /*
    معرّفا الفاتورة والمستند — لا يدخلان في بناء الاسم، وإنّما يدلّان
    على **موضع إصلاح** ما نقص منه. فالملفّ الذي لا يُبنى له اسم نقصُه
    في بياناته لا في تسميته.
  */
  invoiceId?: string | null;
  documentId?: string | null;
}

export type NameVerdict =
  /** الاسم على الصيغة القياسية — لا شيء يُفعَل. */
  | { status: "OK" }
  /** يُبنى له اسمٌ قياسيّ يخالف اسمَه الحاليّ. */
  | { status: "RENAME"; proposed: string; reason: string }
  /** ينقصه ما يُبنى به الاسم — يُعرَض ولا يُقترَح له شيء. */
  | { status: "CANNOT"; reason: string };

/**
 * الامتداد يبقى كما هو — تغييرُه يكسر فتح الملفّ.
 *
 * وكان يُؤخَذ كلُّ ما بعد آخر نقطة. وأسماءُ الأرشيف تنتهي بالمبلغ —
 * «‏…_SAR996.19» — وكثيرٌ ممّا يصل بلا امتدادٍ أصلاً، فقُرئت «19»
 * امتداداً وأُلحقت باسمٍ مبنيٍّ ينتهي بالمبلغ نفسه: «‏…_SAR996.19.19».
 * وقع ذلك في **أربعة ملفّاتٍ حقيقيّة** في الدرايف يوم ١٤ سبتمبر ٢٠٢٦
 * (سجلّ `DRIVE_FILE_RENAMED`) — فخرجت من الأرشيف بأسماءٍ بلا امتدادٍ
 * يُفتَح به، وهو بعينه ما يمنعه هذا التعليق.
 *
 * فلا يُقرأ امتداداً إلّا ما كان امتداداً معروفاً؛ وإلّا فمن نوع
 * المحتوى المقيَّد، وإلّا `pdf`. والمبلغُ ليس امتداداً.
 */
const EXTENSION_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/webp": "webp",
  "image/tiff": "tif",
  "image/gif": "gif",
};

function extensionOf(fileName: string, mimeType?: string | null): string {
  const dot = fileName.lastIndexOf(".");
  const candidate = dot > 0 ? fileName.slice(dot + 1) : "";
  if (looksLikeExtension(candidate)) return candidate.toLowerCase();
  return EXTENSION_BY_MIME[(mimeType ?? "").toLowerCase()] ?? "pdf";
}

/**
 * ما ينبغي أن يكون عليه اسم هذا المستند.
 *
 * ولا يُمسّ ما لا يُعرَف نوعُه: الإيصالات والنقد لها صيغٌ تحتاج وصفاً
 * أو مستفيداً لا يُقرأ من جدول المستندات، فتُترَك.
 */
const INVOICE_KINDS = new Set(["TAX_INVOICE", "SIMPLIFIED_INVOICE", "INVOICE"]);

export function canonicalName(doc: NamedDocument): NameVerdict {
  /*
    ── ما يُقرأ اسمُه لا يُمَسّ ──

    وهذا الشرط أهمّ ما في الوحدة، وقد كاد يسقط: أوّل صياغةٍ كانت
    تقارن الاسم بالمبنيّ حرفاً بحرف، فتقترح على
    «2026-05-31_Ganache-AGK_Statement_May_SAR6371.00.pdf» أن يصير
    «2026-05-31_Ganache_Statement_SAR6371.00.pdf» — فتحذف «AGK» وتحذف
    «May». وذاك اسمٌ صحيحٌ يحمل تفصيلاً لا نعرفه نحن، وإعادةُ بنائه
    **تمحو معلومةً كتبها إنسان**.

    والمطلوب غير ذلك: الملفّ الذي **لا يُقرأ اسمُه** — «فاتورة ٣.pdf»
    و«IMG_2041.jpg» — هو الذي يخرج عن الصيغة. فالشرط أن يعجز القارئ،
    لا أن يختلف المبنيّ.
  */
  const parsed = parseFileName(doc.fileName, []);
  if (parsed.ok) return contradiction(doc, parsed.value);

  if (!INVOICE_KINDS.has(doc.kind) && doc.kind !== "STATEMENT") {
    return { status: "CANNOT", reason: `نوعُه «${doc.kind}» — لا صيغة قياسية له هنا` };
  }
  if (!doc.slug) return { status: "CANNOT", reason: "لا مورّد مقيَّد له" };
  if (!doc.date) return { status: "CANNOT", reason: "لا تاريخ مقيَّد له" };
  if (doc.totalMinor === null) return { status: "CANNOT", reason: "لا إجماليّ مقيَّد له" };

  const extension = extensionOf(doc.fileName, doc.mimeType);
  const shared = { date: doc.date, amountMinor: doc.totalMinor, extension };

  let proposed: string;
  if (doc.kind === "STATEMENT") {
    proposed = buildStatementFileName({ ...shared, slug: doc.slug });
  } else {
    if (!doc.invoiceNumber) return { status: "CANNOT", reason: "لا رقم فاتورة مقيَّد له" };
    proposed = buildInvoiceFileName({
      ...shared, slug: doc.slug, invoiceNumber: doc.invoiceNumber,
    });
  }

  if (proposed === doc.fileName) return { status: "OK" };

  return { status: "RENAME", proposed, reason: "لا يُقرأ اسمُه — خارج الصيغة القياسية" };
}

/**
 * اسمٌ يُقرأ ويخالف المقيَّد — الغلطُ الذي لا يراه شرطُ «لا يُقرأ».
 *
 * كان الاسمُ المقروء لا يُمسّ أبداً، فبقي في الأرشيف «‏…_SI-0034.pdf» بلا مبلغ،
 * و«‏…_V405523_SAR678.10» والفاتورةُ ٦٧٨٫٠٠. والصيغةُ تُقرأ والمعلومةُ خاطئة —
 * وهو أسوأ من اسمٍ لا يُقرأ، لأنّ من يبحث بالاسم يجده ويصدّقه.
 *
 * فللفواتير: المبلغُ الغائب أو المخالف، والتاريخُ المخالف، يُبنيان من القيد —
 * **ويبقى ما كتبه إنسانٌ في الاسم** (اسمُ المورّد كما في الأرشيف، ورقمُ الفاتورة
 * بصيغته، ورقمُ النسخة). ورقمُ فاتورةٍ يخالف المقيَّد في جوهره لا يُحسَم هنا: أيُّهما
 * الصحيح لا يُعرف من الاسم، فيُعلَن ولا يُسمّى.
 */
function contradiction(doc: NamedDocument, p: ParsedFileName): NameVerdict {
  if (!INVOICE_KINDS.has(doc.kind) || p.kind !== "INVOICE") return { status: "OK" };
  if (!doc.date || doc.totalMinor === null || !doc.invoiceNumber) return { status: "OK" };

  if (p.invoiceNumber && invoiceNumberKey(p.invoiceNumber) !== invoiceNumberKey(doc.invoiceNumber)) {
    return { status: "CANNOT", reason: `رقمُ الفاتورة في الاسم «${p.invoiceNumber}» يخالف المقيَّد «${doc.invoiceNumber}» — راجع أيّهما الصحيح` };
  }
  const wrongAmount = p.amountMinor === undefined || p.amountMinor !== doc.totalMinor;
  const wrongDate = p.date !== doc.date;
  /* رمزٌ آليّ مكان المورّد («SUPSL2F0X») وللمورّد اسمٌ يُقرأ اليوم — يُكتب اسمُه */
  const codedSlug = Boolean(p.slug && /^SUP[A-Z0-9]{5,6}$/.test(p.slug) && doc.slug && doc.slug !== p.slug);
  const slashInName = /[\\/]/.test(doc.fileName);
  if (!wrongAmount && !wrongDate && !codedSlug && !slashInName) return { status: "OK" };

  const proposed = buildInvoiceFileName({
    date: doc.date,
    slug: (codedSlug ? doc.slug : p.slug ?? doc.slug) ?? "",
    invoiceNumber: p.invoiceNumber ?? doc.invoiceNumber,
    amountMinor: doc.totalMinor,
    extension: p.extension,
    duplicateIndex: p.duplicateIndex,
  });
  if (!(p.slug ?? doc.slug) || proposed === doc.fileName) return { status: "OK" };
  const why = [
    wrongAmount ? (p.amountMinor === undefined ? "بلا مبلغ" : "المبلغ يخالف الفاتورة") : null,
    wrongDate ? "التاريخ يخالف الفاتورة" : null,
    codedSlug ? "رمزٌ مكان اسم المورّد" : null,
    slashInName ? "«/» في الاسم" : null,
  ].filter(Boolean).join(" · ");
  return { status: "RENAME", proposed, reason: `يُقرأ اسمُه ويخالف المقيَّد: ${why}` };
}
