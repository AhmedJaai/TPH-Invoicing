import { decimalToMilli } from "./units";

/**
 * أهما الكمّيّةُ نفسُها؟ «1.600» و«1.6» و«١٫٦» واحد.
 *
 * كان «غير المحفوظ» يُقاس بالنصّ: يكتب صاحبُ العدّ «1.600» والخادمُ يحفظ الرقمَ ويعيده «1.6»، فإن لم يتغيّر
 * ما خُزّن (هو نفسُه) لم تُعِد الصفحةُ مزامنةَ ما كُتب، وبقي الصنفُ «لم يُحفظ بعد» مهما ضُغط «احفظ العدّ»
 * (أحمد، ١ نوفمبر ٢٠٢٦: «قاعد أضغط حفظ لكن مو راضي يتغيّر»). فالمقارنةُ بالمِلّي، ولا يُخمَّن ما فيه فاصلةٌ
 * ملتبسة («1,600»): تُقارَن نصّاً وحده، فيردّها الخادمُ بجملته.
 */
/** فاصلةُ الآلاف اللاتينيّة والعربيّة (U+066C) — بالرمز لا بالحرف: حارسُ الأرقام يقرأ حروفَ النصّ الثابت. */
const AMBIGUOUS_SEPARATOR = new RegExp(`[,${String.fromCharCode(0x66c)}]`);

export function sameQuantity(a: string, b: string): boolean {
  const x = a.trim();
  const y = b.trim();
  if (x === y) return true;
  if (x === "" || y === "" || AMBIGUOUS_SEPARATOR.test(x) || AMBIGUOUS_SEPARATOR.test(y)) return false;
  const mx = decimalToMilli(x);
  const my = decimalToMilli(y);
  return mx !== null && my !== null && mx === my;
}
