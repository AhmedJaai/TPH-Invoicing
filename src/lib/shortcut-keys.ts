/**
 * أيُّ اختصارٍ ضُغط — بالمفتاح الفيزيائيّ حين لا يكون الحرفُ لاتينيّاً.
 *
 * كانت الاختصاراتُ تُقارَن بـ`e.key`، وصاحبُ المقهى يكتب بالعربيّة: المفتاحُ
 * الذي عليه G يصل «ل»، وJ «ت»، وK «ن»، وعلامةُ الاستفهام «؟» — فلا يعمل
 * منها شيء حتّى يبدّل اللغة. فصار الحكمُ هكذا:
 *
 * - الحرفُ اللاتينيّ يُؤخذ كما وصل (`e.key`) — فتخطيطٌ لاتينيٌّ غير QWERTY
 *   (Dvorak · AZERTY) يبقى على حروفه المطبوعة.
 * - وما سواه (عربيّ وغيره) يُقرأ من موضع المفتاح (`e.code`): `KeyG` هو G
 *   أينما كُتب عليه.
 * - «؟» العربيّة و«?» سواء، و«/» بحرفه أو بموضعه.
 *
 * دالّةٌ خالصة — لا متصفّح — فتُختبَر.
 */
export interface KeyLike {
  key: string;
  code?: string;
  shiftKey?: boolean;
}

/** الحرفُ اللاتينيّ الصغير، أو "/" أو "?"، أو `null` لما ليس اختصاراً. */
export function shortcutKey(e: KeyLike): string | null {
  const key = e.key ?? "";
  if (/^[a-zA-Z]$/.test(key)) return key.toLowerCase();
  if (key === "?" || key === "؟") return "?";
  if (key === "/") return "/";
  /* مفاتيحُ التحكّم (Enter · Escape · الأسهم) ليست حروفاً — لا تُترجَم من موضعها */
  if (key.length !== 1) return null;
  const code = e.code ?? "";
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1].toLowerCase();
  if (code === "Slash") return e.shiftKey ? "?" : "/";
  return null;
}
