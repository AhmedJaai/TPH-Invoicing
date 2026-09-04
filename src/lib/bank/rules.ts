/**
 * تصنيف الحركات البنكية.
 *
 * كشف الحساب ليس كلّه مورّدين. فيه رواتب وإيجار وزكاة وكهرباء وتحويلات
 * شخصية للمالك — وعرضها «مدفوعات مجهولة» يغرق النافع في الضجيج، ويجعل
 * صاحب العمل يتخطّى القائمة كلّها بدل أن يقرأها.
 *
 * ولا يُستنتج ذلك من الوصف استنتاجاً موثوقاً: «سابع جار» يبدو اسم مورّد
 * وهو إيجار، و«أحمد الجعيدي» يبدو مستفيداً وهو المالك نفسه. فالاقتراح
 * وحده يُبنى على الكلمات، والقرار للمالك — ويصير قاعدةً تسري بعده.
 */
import { normalizeName } from "@/lib/suppliers-seed";
import { distinctiveTokens } from "./match";

export type TxCategory =
  | "SUPPLIER" | "SALARY" | "RENT" | "ZAKAT" | "UTILITY"
  | "GOVERNMENT" | "PERSONAL" | "INTERNAL" | "OTHER" | "UNKNOWN";

export const CATEGORY_LABEL: Record<TxCategory, string> = {
  SUPPLIER: "سداد مورّد",
  SALARY: "راتب أو أجر",
  RENT: "إيجار",
  ZAKAT: "زكاة أو صدقة",
  UTILITY: "كهرباء · مياه · اتصالات",
  GOVERNMENT: "حكومي · تأمينات · ضريبة",
  PERSONAL: "تحويل شخصي",
  INTERNAL: "حركة تشغيلية",
  OTHER: "أخرى",
  UNKNOWN: "غير مصنَّفة",
};

/** التصنيفات التي لا تدخل حساب مستحقّات المورّدين. */
export const NON_SUPPLIER_CATEGORIES: readonly TxCategory[] = [
  "SALARY", "RENT", "ZAKAT", "UTILITY", "GOVERNMENT", "PERSONAL", "INTERNAL", "OTHER",
];

export interface BankRule {
  id: string;
  /** النمط بعد التطبيع */
  normalized: string;
  category: TxCategory;
  supplierId?: string | null;
}

/**
 * تطابق القاعدة: كل كلمة مميِّزة في النمط موجودة في الوصف.
 *
 * ليس الاحتواء النصّي، لأنّ وصف البنك يُقطع ويُبعثر: «شركة انس غالب حمزه
 * خاشقجي  التجارية المحد ودة». والاشتراط على الكلمات المميِّزة وحدها يتجاوز
 * القطع ولا يتساهل حتى يطابق الجميع.
 */
export function ruleMatches(rule: BankRule, description: string): boolean {
  const haystack = normalizeName(description);
  if (!haystack) return false;
  if (haystack.includes(rule.normalized)) return true;

  const tokens = distinctiveTokens(rule.normalized);
  if (tokens.length === 0) return false;
  return tokens.every((t) => haystack.includes(t));
}

/** أوّل قاعدة تنطبق، والأطول نمطاً أولى — فالأخصّ يسبق الأعمّ. */
export function findRule(
  description: string,
  rules: readonly BankRule[],
): BankRule | undefined {
  return [...rules]
    .sort((a, b) => b.normalized.length - a.normalized.length)
    .find((r) => ruleMatches(r, description));
}

/**
 * كلمات تقترح تصنيفاً — اقتراحٌ يُعرض لا حكمٌ يُنفَّذ.
 *
 * الترتيب مقصود: الأخصّ قبل الأعمّ. «هيئة الزكاة والضريبة والجمارك» جهة
 * حكومية تُسدَّد لها الضريبة، وليست زكاةً تُخرَج — فتسبق قاعدتها قاعدة
 * الزكاة العامّة، وإلّا صُنّف سداد الضريبة صدقةً.
 *
 * والوصف يأتي بالعربية والإنجليزية معاً في كشف الأهلي، فالكلمات باللغتين.
 */
const HINTS: { category: TxCategory; words: string[] }[] = [
  {
    category: "GOVERNMENT",
    words: [
      "zakat tax and customs", "zakat, tax and customs", "zatca", "زاتكا",
      "هيئة الزكاة والضريبة", "الزكاه والضريبه",
      "ministry of municipal", "municipal and rural", "امانه", "بلديه",
      "التامينات", "تامينات", "gosi", "general organization for social",
      "رسوم حكوميه", "جوازات", "مقيم", "ministry of",
    ],
  },
  {
    category: "UTILITY",
    words: [
      "saudi energy", "saudi electricity", "الشركه السعوديه للكهرباء", "كهرباء", "الكهرباء",
      "saudi telecom", "stc", "mobily", "موبايلي", "zain", "زين",
      "national water", "المياه الوطنيه", "مياه", "المياه",
      "اتصالات", "انترنت", "internet",
    ],
  },
  {
    category: "SALARY",
    words: [
      "monthly salary", "salary", "payroll", "wages",
      "راتب", "رواتب", "مسير", "اجور", "مكافاه",
    ],
  },
  { category: "RENT", words: ["ايجار", "الايجار", "rent", "lease"] },
  { category: "ZAKAT", words: ["زكاه", "صدقه", "تبرع", "charity", "donation"] },
  { category: "INTERNAL", words: ["نقاط بيع", "رسوم", "ضريبه عمليه", "دفع الكتروني", "digital channel"] },
];

/**
 * تصنيف مقترح من نصّ الحركة.
 *
 * يُستعمل لتهيئة القائمة المنسدلة لا لاتخاذ القرار. الكلمة قد تخدع:
 * «مؤسسة الإيجار للتجارة» مورّد لا إيجار.
 */
export function suggestCategory(description: string): TxCategory {
  const t = normalizeName(description);
  if (!t) return "UNKNOWN";
  for (const hint of HINTS) {
    if (hint.words.some((w) => t.includes(normalizeName(w)))) return hint.category;
  }
  return "UNKNOWN";
}
