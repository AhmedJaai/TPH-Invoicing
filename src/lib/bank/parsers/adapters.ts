/**
 * محوِّلات البنوك.
 *
 * كان في النظام نصفُ معمارية: `detect.ts` يعرف **أيّ بنكٍ** أصدر الملفّ،
 * ثمّ يُرمى الاسم في عمودٍ للعرض ولا يُستعمَل في القراءة. فالقراءة
 * واحدة للجميع: قاموسُ رؤوس أعمدة عامّ، يُصيب في الأهليّ لأنّه المجرَّب،
 * ويُخمّن في غيره.
 *
 * ومعرفةُ البنك بلا استعمالها أسوأ من الجهل به: توحي بأنّ النظام يدعم
 * ستّة بنوك وهو يقرأ واحداً ويحاول في الباقي.
 *
 * فالمحوِّل هنا يحمل ما يخصّ كلّ بنك:
 *   • أسماء أعمدته كما يكتبها هو،
 *   • كيف يعبّر عن الاتّجاه: عمودان (مدين/دائن) أم مبلغٌ بإشارة،
 *   • تقويمه: ميلاديّ أم هجريّ،
 *   • وعِلَلُه المعروفة.
 *
 * **و`verified` ليس زينة.** الأهليّ وحده جُرِّب على ملفّات حقيقية،
 * والبقيّة محوِّلاتٌ معقولة لم تُختبَر على كشفٍ فعليّ. وهذا يُعلَن
 * للمستخدم عند القراءة — لا يُدفَن في تعليق. فمن يستورد كشف الراجحي
 * يجب أن يعرف أنّ النظام يقرؤه على أفضل تقديرٍ لا على تجربة.
 */

export type DirectionStyle =
  /** عمودان منفصلان: مدين ودائن. */
  | "TWO_COLUMNS"
  /** عمودٌ واحد بإشارة: السالب صادر. */
  | "SIGNED_AMOUNT"
  /** عمود مبلغ وعمود نوعٍ نصّيّ يقول مدين أو دائن. */
  | "TYPE_COLUMN";

export interface BankAdapter {
  bankId: string;
  bankName: string;
  /**
   * هل جُرِّب على ملفّ حقيقيّ من هذا البنك؟
   *
   * وما لم يُجرَّب يُقرأ ويُعلَن أنّه لم يُجرَّب — لا يُمنَع. المنع يترك
   * صاحب العمل بلا شيء، والادّعاء يتركه بأرقامٍ لا يعرف صحّتها.
   */
  verified: boolean;
  /** رؤوس أعمدةٍ يزيدها هذا البنك على العامّ. */
  headers: Partial<Record<HeaderKey, readonly string[]>>;
  directionStyle: DirectionStyle;
  calendar: "GREGORIAN" | "HIJRI";
  /** عِلَلٌ معروفة تُعرَض لمن يقرأ الكشف. */
  quirks: readonly string[];
}

export type HeaderKey =
  | "date" | "postingDate" | "type" | "description"
  | "beneficiary" | "debit" | "credit" | "amount" | "balance" | "reference";

/**
 * المحوِّل العامّ — لبنكٍ لم يُعرَف.
 *
 * ولا يُنسَب إلى الأهليّ لأنّه الأكثر: القراءة تمضي على بنية الأعمدة،
 * والنسبةُ بلا دليلٍ تُنتج ثقةً كاذبة.
 */
export const GENERIC_ADAPTER: BankAdapter = {
  bankId: "GENERIC",
  bankName: "بنك غير محدَّد",
  verified: false,
  headers: {},
  directionStyle: "TWO_COLUMNS",
  calendar: "GREGORIAN",
  quirks: [
    "لم يُعرَف البنك من الملفّ — القراءة على بنية الأعمدة وحدها",
  ],
};

export const ADAPTERS: readonly BankAdapter[] = [
  {
    bankId: "SNB",
    bankName: "الأهلي (SNB)",
    /* المجرَّب وحده على ملفّات حقيقية — ألفٌ وأربعمئة حركة */
    verified: true,
    headers: {
      description: ["البيان", "تفاصيل العملية"],
      beneficiary: ["اسم المستفيد", "المستفيد", "beneficiary name"],
      type: ["نوع العملية", "نوع العمليه"],
      reference: ["الرقم المرجعي", "رقم العملية"],
    },
    directionStyle: "TWO_COLUMNS",
    calendar: "GREGORIAN",
    quirks: [
      "المرجع في الوصف مرجعُ البنك نفسه لا رقمُ فاتورة المورّد — فعدم تطابقه لا ينفي المطابقة",
      "عمود المستفيد قد يغيب في بعض صيغ التصدير، ويُنبَش الاسم حينئذ من الوصف قبل BEN ID",
      "بعض الصيغ لا تحمل رقم الحساب في الترويسة — فلا يدخل بصمة الحركة",
    ],
  },
  {
    bankId: "RAJHI",
    bankName: "الراجحي",
    verified: false,
    headers: {
      description: ["بيان العملية", "التفاصيل"],
      debit: ["مدين", "debit amount"],
      credit: ["دائن", "credit amount"],
    },
    directionStyle: "TWO_COLUMNS",
    calendar: "GREGORIAN",
    quirks: ["لم يُجرَّب على كشفٍ فعليّ — راجع أوّل استيرادٍ سطراً سطراً"],
  },
  {
    bankId: "RIYAD",
    bankName: "الرياض",
    verified: false,
    headers: { description: ["تفاصيل الحركة"], amount: ["المبلغ", "amount"] },
    directionStyle: "SIGNED_AMOUNT",
    calendar: "GREGORIAN",
    quirks: ["لم يُجرَّب على كشفٍ فعليّ — والمبلغ فيه بإشارة، فالسالب صادر"],
  },
  {
    bankId: "ALINMA",
    bankName: "الإنماء",
    verified: false,
    headers: { description: ["الوصف", "البيان"] },
    directionStyle: "TWO_COLUMNS",
    calendar: "GREGORIAN",
    quirks: ["لم يُجرَّب على كشفٍ فعليّ"],
  },
  {
    bankId: "SAB",
    bankName: "SAB",
    verified: false,
    headers: { description: ["details", "narrative"] },
    directionStyle: "TWO_COLUMNS",
    calendar: "GREGORIAN",
    quirks: ["لم يُجرَّب على كشفٍ فعليّ"],
  },
  {
    bankId: "ANB",
    bankName: "العربي الوطني",
    verified: false,
    headers: { description: ["البيان", "details"] },
    directionStyle: "TWO_COLUMNS",
    calendar: "GREGORIAN",
    quirks: ["لم يُجرَّب على كشفٍ فعليّ"],
  },
];

export function adapterFor(bankId: string | null | undefined): BankAdapter {
  if (!bankId) return GENERIC_ADAPTER;
  return ADAPTERS.find((a) => a.bankId === bankId) ?? GENERIC_ADAPTER;
}

/**
 * ما يجب أن يُعلَم قبل الوثوق بهذه القراءة.
 *
 * وتُعرَض دائماً لا عند الخطأ: العِلّة المعروفة سلفاً ليست خطأً وقع،
 * بل حدٌّ يجب أن يُعرَف. وإخفاؤها حتى يقع الخطأ يجعل من يقع فيه يظنّ
 * أنّ النظام أخطأ، وإنّما هو يعمل ضمن حدّه المعلَن.
 */
export function adapterNotices(adapter: BankAdapter): string[] {
  const out = [...adapter.quirks];
  if (!adapter.verified && adapter.bankId !== "GENERIC") {
    out.unshift(
      `محوِّل ${adapter.bankName} لم يُجرَّب على كشفٍ حقيقيّ — ` +
      "القراءة على أفضل تقدير، فراجع أوّل استيراد بعينك.",
    );
  }
  return out;
}

/** رؤوس الأعمدة كاملةً لهذا البنك: العامّ ثمّ ما يخصّه. */
export function headersFor(
  adapter: BankAdapter,
  base: Record<string, readonly string[]>,
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(base)) merged[key] = [...values];
  for (const [key, values] of Object.entries(adapter.headers)) {
    merged[key] = [...new Set([...(merged[key] ?? []), ...(values ?? [])])];
  }
  return merged;
}
