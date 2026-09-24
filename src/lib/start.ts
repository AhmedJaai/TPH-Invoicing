/**
 * أوّلُ يومٍ مع النظام — ما الذي ينقصه ليعرف شيئاً؟
 *
 * كانت الرئيسية على قاعدةٍ فارغة تقول «عليك للمورّدين ٠٫٠٠ — لا مستحقّ
 * على المقهى الآن» و«كلُّ ما يعرفه النظام سليم» بالأخضر. والنظام لا يعرف
 * شيئاً: لا فاتورةَ فيه ولا كشف. **وصفرٌ عن غير علمٍ خبرٌ كاذب** — القيدُ
 * الرابع بعينه — ثمّ لا يُقال لصاحب المقهى من أين يبدأ.
 *
 * فالخطواتُ هنا بترتيب ما يعتمد عليه ما بعدها: المستنداتُ أوّلاً (منها
 * تُعرَف الديون)، ثمّ كشفُ البنك (منه يُعرَف ما خرج وما سُدّد)، ثمّ
 * الكتالوج (وبه وحده يُحسَب الجرد) — والأخيرةُ لا تمنع ما قبلها.
 *
 * دالّةٌ خالصة — تأخذ أعداداً وتُرجع خطوات.
 */

export interface StartFacts {
  documents: number;
  bankTransactions: number;
  recipes: number;
}

export interface StartStep {
  id: "documents" | "bank" | "catalog";
  title: string;
  detail: string;
  href: string;
  action: string;
  done: boolean;
}

export interface StartState {
  steps: StartStep[];
  /** لا مستندَ ولا كشف — فكلُّ رقمٍ في الرئيسية صفرٌ عن غير علم. */
  knowsNothing: boolean;
  /** بقي من الأساسَين (المستندات والكشف) شيء — فتُعرَض الخطوات. */
  incomplete: boolean;
}

export function startState(f: StartFacts): StartState {
  const steps: StartStep[] = [
    {
      id: "documents",
      title: "ارفع فواتيرك أو زامن الدرايف",
      detail: "منها يعرف النظام لمن تدين وكم — ويقرأ كلَّ فاتورة ويعرضها عليك قبل الحفظ.",
      href: "/upload",
      action: "ارفع مستنداً",
      done: f.documents > 0,
    },
    {
      id: "bank",
      title: "استورد كشف البنك",
      detail: "منه يُعرَف ما خرج من الحساب وما سُدّد من الفواتير — ملفّ Excel أو PDF نصّيّ من بنكك.",
      href: "/bank#import",
      action: "استورد الكشف",
      done: f.bankTransactions > 0,
    },
    {
      id: "catalog",
      title: "ارفع كتالوج فودكس (للجرد)",
      detail: "الأصنافُ والوصفات — بها يُحسَب ما كان ينبغي أن يبقى على الرفّ. ليست شرطاً لما قبلها.",
      href: "/inventory/import",
      action: "ارفع الكتالوج",
      done: f.recipes > 0,
    },
  ];
  return {
    steps,
    knowsNothing: f.documents === 0 && f.bankTransactions === 0,
    incomplete: f.documents === 0 || f.bankTransactions === 0,
  };
}
