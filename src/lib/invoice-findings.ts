/**
 * «لماذا هذه الفاتورة ناقصةُ ركن؟» — السببُ يُشتقّ ولا يُخزَّن.
 *
 * ── العطب الذي يُصلحه هذا الملفّ ──
 *
 * كانت الشاشة تقول «ينقصها ركن» و«لا تصلح لخصم الضريبة» ولا تقول **أيّ
 * ركن**. والسببُ محسوبٌ فعلاً وقتَ الأرشفة في `reviewConfirmed` — ثمّ
 * يُرمى: لا يُكتب في `issues` ولا في عمودٍ على الفاتورة، ولا يبقى منه
 * إلّا حكمٌ من ثلاث كلمات.
 *
 * فيقف صاحب المقهى أمام ثمانٍ وستّين فاتورة «لا تصلح» ولا يعرف أيُطالِب
 * المورّد برقمٍ ضريبيّ، أم بفاتورةٍ بديلة، أم أنّ الخطأ في قراءتنا نحن.
 * **والتشخيصُ الذي لا يُعرَض لا يُعالَج.**
 *
 * ── ولِمَ يُشتقّ ولا يُخزَّن ──
 *
 * لأنّه **دالّةٌ خالصة** من حقول الفاتورة وحالِ مورّدها ورقمِ المنشأة:
 * `validateInvoice` نفسها التي يحكم بها مسارُ الأرشفة. فلو خُزّن لصار
 * له مصدران يفترقان متى تغيّر رقمُ المنشأة أو سياسةُ المورّد أو صُحّح
 * حقلٌ في الفاتورة — ويبقى السببُ القديم معروضاً على حالٍ جديدة.
 *
 * والاشتقاقُ يضمن أنّ ما تقرؤه الشاشةُ اليوم هو ما يحكم به الخادمُ
 * اليوم — وهو قيدُ «الخادم لا يثق بالمتصفّح» مقلوباً: الشاشةُ لا تحفظ
 * حكماً، بل تسأل عنه.
 */
import { validateInvoice, type Finding } from "./validation";
import { ISSUE } from "./issue-codes";

export interface InvoiceForFindings {
  kind: string | null;
  invoiceNumber: string | null;
  sellerVat: string | null;
  buyerVat: string | null;
  subtotalMinor: number | null;
  vatMinor: number | null;
  totalMinor: number | null;
  /** الخصمُ بعد الضريبة المقيَّد — يسدّ فرقَ الحساب */
  discountMinor?: number | null;
  /** الرسومُ بعد الضريبة المقيَّدة */
  chargesMinor?: number | null;
  /** عدد بنودها — صفرٌ عطبٌ بذاته، وهو خارج الفحص الضريبيّ */
  lineCount?: number;
}

export interface SupplierForFindings {
  issuesInvoices: boolean;
  contractOnFile: boolean;
  paperInvoices?: boolean;
}

/** الأركانُ التي تُقرأ — وكلٌّ معه ما يُفعَل. */
export interface InvoiceReason {
  code: string;
  severity: Finding["severity"];
  /** ما الناقص، بعبارةٍ يفهمها صاحب المقهى */
  what: string;
  /** ما يُفعَل به — ومن يُطالَب */
  fix: string;
}

/*
  لكلّ ركنٍ ناقصٍ فعلُه. والعبارةُ تقول **من** يُطالَب: المورّدُ برقمه
  الضريبيّ، أو نحن بإعادة القراءة. وكان النصّ يقول ما وقع ولا يقول
  ما يُفعَل — وهو نصفُ الخبر.
*/
const FIX: Record<string, { what: string; fix: string }> = {
  [ISSUE.MISSING_SELLER_VAT]: {
    what: "لا رقم ضريبيّ للبائع على الفاتورة",
    fix: "اطلب من المورّد فاتورةً تحمل رقمه الضريبيّ — أو أعد قراءة المستند إن كان الرقم فيه ولم يُقرأ.",
  },
  [ISSUE.MISSING_BUYER_VAT]: {
    what: "لا رقم ضريبيّ للمشتري — وهو رقمُ منشأتك",
    fix: "اطلب من المورّد فاتورةً ضريبيّة باسم المنشأة ورقمها. والمبسّطةُ لا تصلح لخصم المدخلات.",
  },
  [ISSUE.BUYER_VAT_MISMATCH]: {
    what: "رقم المشتري على الفاتورة لا يطابق رقم منشأتك",
    fix: "راجع الرقم: إمّا أنّ المورّد كتبه خطأً فيُطلَب تصحيحُه، وإمّا أنّ القراءة أخطأت فيُعاد قراءةُ المستند.",
  },
  [ISSUE.ZERO_VAT]: {
    what: "لا ضريبة عليها — الضريبةُ المقروءة صفر",
    fix: "إن كانت السلعُ خاضعةً فاطلب من المورّد فاتورةً ضريبيّة. وإن قُرئت الضريبةُ صفراً خطأً فأعد قراءة المستند أو صحّح المبلغ.",
  },
  [ISSUE.MISSING_INVOICE_NUMBER]: {
    what: "لا رقم فاتورة",
    fix: "اكتبه بيدك من صورة الفاتورة، أو أعد قراءة المستند — ولا يُخترَع رقمٌ من عند النظام.",
  },
  [ISSUE.VAT_MATH_MISMATCH]: {
    what: "الصافي + الضريبة لا يساوي الإجمالي",
    fix: "صحّح المبلغ الذي أُخطئ في قراءته — والمطبوعُ على الورقة هو الملزِم. وإن كان عليها خصمٌ أو رسومُ توصيلٍ بعد الضريبة فاكتبها في حقلها.",
  },
  [ISSUE.NOT_A_TAX_INVOICE]: {
    what: "عرضُ سعرٍ أو فاتورةٌ مبدئيّة — لا تُقيَّد فاتورةً",
    fix: "اطلب الفاتورة النهائية من المورّد بعد التسليم.",
  },
  [ISSUE.TAX_STATUS_UNKNOWN]: {
    what: "لم يُقرأ التفصيل الضريبيّ بعد — الحالة مجهولة لا غير صالحة",
    fix: "أعد قراءة المستند. ولا تُطالِب المورّد قبل ذلك: قد تكون الفاتورة سليمةً ولم تُقرأ.",
  },
  [ISSUE.POSSIBLE_FIXED_ASSET]: {
    what: "فوق حدّ الرسملة — أصلٌ ثابتٌ محتمَل",
    fix: "راجعها مع المحاسب: صرفُها دفعةً واحدة يشوّه ربح الشهر.",
  },
  [ISSUE.SUPPLIER_WITHOUT_CONTRACT]: {
    what: "مورّدٌ لا يصدر فواتير ضريبية وبلا عقد توريد",
    fix: "وقّع عقد توريد — أو أعلِن في ملفّه أنّه لا يُطلَب منه عقد.",
  },
};

/** صورُ العطب التي يحملها رمزٌ واحد — والمفتاح `رمز:صورة`. */
const VARIANT_FIX: Record<string, { what: string; fix: string }> = {
  [`${ISSUE.VAT_MATH_MISMATCH}:ROUNDING`]: {
    what: "المورّد قرّب الإجماليّ بأقلّ من ريال",
    fix: "لا شيء يُفعَل: المطبوعُ على الفاتورة هو الملزِم، والفرقُ تقريب.",
  },
  [`${ISSUE.VAT_MATH_MISMATCH}:RATE`]: {
    what: "الضريبة أقلّ أو أكثر من ١٥٪ من الصافي — والجمعُ يستقيم",
    fix: "غالباً في الفاتورة بنودٌ معفاة أو صفريّة. قارن بالورقة، ولا تُطالِب المورّد إلّا إن كانت البنود كلّها خاضعة.",
  },
  [`${ISSUE.MISSING_BUYER_VAT}:UNREADABLE`]: {
    what: "رقمُ المنشأة على الفاتورة لم يُقرأ سليماً — ليس ١٥ خانة",
    fix: "قارنه بالورقة: إن كان رقمَ المنشأة فصحّحه في «صحّح الحقول» فتكتمل أركانُها، وإن طُبع خطأً فاطلب من المورّد تصحيحه.",
  },
  [`${ISSUE.VAT_MATH_MISMATCH}:CHARGES`]: {
    what: "عليها رسومٌ بعد الضريبة (توصيل أو شحن) — والمستحقُّ أكثر من الصافي والضريبة",
    fix: "لا شيء يُفعَل: الرسومُ تسدّ الفرقَ كاملاً، والضريبةُ كما طُبعت فتُخصم كاملة.",
  },
  [`${ISSUE.VAT_MATH_MISMATCH}:DISCOUNT`]: {
    what: "عليها خصمٌ بعد الضريبة — والمستحقُّ أقلّ من الصافي والضريبة",
    fix: "لا شيء يُفعَل: الخصمُ يسدّ الفرقَ كاملاً، والضريبةُ كما طُبعت. والمستحقُّ للمورّد هو الإجماليّ بعد الخصم.",
  },
};

/** بندٌ خاصّ: فاتورةٌ بلا بنود — ليس ركناً ضريبياً، وهو عطبٌ مع ذلك. */
export const NO_LINES: InvoiceReason = {
  code: "NO_LINES",
  severity: "WARN",
  what: "لا بنود مقروءة — الإجماليّ معروف ولا يُعرَف ممّ تكوّن",
  fix: "أعد قراءة المستند لتُستخرَج بنودُه. وبلا بنودٍ لا تدخل في مقارنة الأسعار ولا في تحليل الأصناف.",
};

/**
 * أسبابُ حال الفاتورة الضريبيّة، مرتّبةً بالأهمّ.
 *
 * والمانعُ قبل التحذير: من يقرأ سطرين يقرأ ما يمنع القيد أوّلاً.
 */
export function invoiceReasons(
  invoice: InvoiceForFindings,
  supplier: SupplierForFindings | null,
  companyVat: string,
): InvoiceReason[] {
  return evaluateInvoice(invoice, supplier, companyVat).reasons;
}

/** الركنُ الناقص باسمه القصير — ليُقال بجانب «غير صالحة» لا تحتها بصفحة. */
const PILLAR_SHORT: Record<string, string> = {
  [ISSUE.MISSING_INVOICE_NUMBER]: "رقم الفاتورة",
  [ISSUE.MISSING_SELLER_VAT]: "الرقم الضريبيّ للبائع",
  [ISSUE.MISSING_BUYER_VAT]: "رقم المنشأة الضريبيّ",
  [ISSUE.BUYER_VAT_MISMATCH]: "رقم المنشأة (لا يطابق)",
  [ISSUE.ZERO_VAT]: "مبلغ الضريبة",
  [ISSUE.TAX_STATUS_UNKNOWN]: "التفصيل الضريبيّ لم يُقرأ",
};

export function missingPillars(reasons: readonly Pick<InvoiceReason, "code">[]): string[] {
  return reasons.map((r) => PILLAR_SHORT[r.code]).filter((x): x is string => Boolean(x));
}

/**
 * الحكمُ اليوم على حقول الفاتورة — الأسبابُ والحالُ معاً من حسابٍ واحد.
 *
 * الحالُ مخزَّنةٌ (يُبنى عليها الإقرار) والأسبابُ تُشتقّ؛ فإن افترقا قالت الشاشةُ
 * «غير صالحة» ولم تجد ما ينقص. فتُقارن الشاشةُ المخزَّنَ بهذا وتقول إنّه قديم.
 */
export function evaluateInvoice(
  invoice: InvoiceForFindings,
  supplier: SupplierForFindings | null,
  companyVat: string,
): { reasons: InvoiceReason[]; taxStatus: string; inputVatStatus: string } {
  const kind = invoice.kind;
  const result = validateInvoice(
    {
      kind:
        kind === "TAX_INVOICE" || kind === "SIMPLIFIED_INVOICE" ||
        kind === "QUOTATION" || kind === "PROFORMA" || kind === "STATEMENT"
          ? kind
          : "UNKNOWN",
      invoiceNumber: invoice.invoiceNumber,
      sellerVat: invoice.sellerVat,
      buyerVat: invoice.buyerVat,
      subtotalMinor: invoice.subtotalMinor ?? undefined,
      vatMinor: invoice.vatMinor ?? undefined,
      totalMinor: invoice.totalMinor ?? undefined,
      discountMinor: invoice.discountMinor ?? null,
      chargesMinor: invoice.chargesMinor ?? null,
    },
    {
      companyVat,
      supplierIssuesInvoices: supplier?.issuesInvoices,
      supplierContractOnFile: supplier?.contractOnFile,
    },
  );

  const out: InvoiceReason[] = result.findings.map((f) => {
    const copy = (f.variant && VARIANT_FIX[`${f.code}:${f.variant}`]) || FIX[f.code];
    return {
      code: f.code,
      severity: f.severity,
      what: copy?.what ?? f.message,
      /* ما لا نصَّ له يُقال صراحةً أنّه بلا فعلٍ معروف، ولا يُخترَع له */
      fix: copy?.fix ?? "راجع المستند نفسه — لا خطوةَ محفوظة لهذا البند.",
    };
  });

  if (invoice.lineCount === 0) out.push(NO_LINES);

  const rank = { BLOCKER: 0, WARN: 1, INFO: 2 } as const;
  return {
    reasons: out.sort((a, b) => rank[a.severity] - rank[b.severity]),
    taxStatus: result.taxStatus,
    inputVatStatus: result.inputVatStatus,
  };
}
