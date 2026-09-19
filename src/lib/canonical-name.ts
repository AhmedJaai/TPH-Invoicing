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
  buildInvoiceFileName, buildStatementFileName, looksLikeExtension, parseFileName,
} from "./naming";

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
  if (parsed.ok) return { status: "OK" };

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
