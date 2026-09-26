/**
 * «لعلّه هذا المورّد» — اقتراحٌ من نصّ البنك لمن يُسأل «أيّ مورّد؟».
 *
 * كانت القائمةُ كلُّ المورّدين بترتيب الحروف، والاسمُ في نصّ الحوالة
 * («…GOLDEN CUP TRADING») لا يُقرأ منه شيء. فيُقارَن نصُّ الحركة بما نعرفه
 * عن كلّ مورّد (اسمُه، ورمزُه اللاتينيّ، واسمُ مجلّده) كلمةً كلمة، ويُعرض
 * أقربُ ثلاثة. **اقتراحٌ لا قرار:** لا يُكتب شيءٌ حتى يختار إنسان، والخادمُ
 * يعيد التحقّق عند الحفظ كما كان.
 *
 * دالّةٌ خالصة — تُختبَر.
 */
import { normalizeArabic, normalizeDigits } from "./search";

export interface SuggestibleSupplier {
  id: string;
  nameAr: string;
  /** الرمزُ اللاتينيّ (`GoldenCup`) — كثيراً ما يطابق نصَّ البنك الإنجليزيّ. */
  slug?: string | null;
  /** اسمُ مجلّده في الدرايف — اسمٌ ثالث يكتبه الناس. */
  folder?: string | null;
}

/** كلماتٌ لا تميّز أحداً: صيغُ الشركات وأدواتُ التعريف وكلماتُ البنك. */
const NOISE = new Set([
  "شركه", "مؤسسه", "مؤسسة", "شركة", "للتجاره", "التجاريه", "لتجاره", "تجاره", "المحدوده", "محدوده", "ذات",
  "co", "company", "est", "establishment", "trading", "trade", "ltd", "llc", "the", "and", "for",
  "حوالات", "حواله", "تحت", "الطلب", "transfer", "sar", "ksa", "sa", "bank", "ncb", "anb", "rajhi",
]);

/** الرمزُ اللاتينيّ يُقسَم عند الحروف الكبيرة: `GoldenCup` ← golden · cup. */
function splitCamel(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function tokens(s: string): string[] {
  const text = normalizeArabic(normalizeDigits(splitCamel(s)).toLowerCase())
    .replace(/[^\p{L}\p{N}]+/gu, " ");
  return [...new Set(
    text.split(" ")
      /* «ال» التعريف لا يفرّق «الكوب» من «كوب» */
      .map((w) => w.replace(/^ال(?=\p{L}{3,})/u, ""))
      .filter((w) => w.length >= 3 && !NOISE.has(w) && !/^\d+$/.test(w)),
  )];
}

export function suggestSuppliers<T extends SuggestibleSupplier>(
  text: string,
  suppliers: readonly T[],
  limit = 3,
): T[] {
  const want = new Set(tokens(text));
  if (want.size === 0) return [];
  return suppliers
    .map((s) => {
      const have = tokens([s.nameAr, s.slug ?? "", s.folder ?? ""].join(" "));
      const score = have.filter((w) => want.has(w)).reduce((n, w) => n + w.length, 0);
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.nameAr.localeCompare(b.s.nameAr, "ar"))
    .slice(0, limit)
    .map((x) => x.s);
}
