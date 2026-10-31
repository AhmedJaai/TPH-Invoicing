/**
 * أرقامُ جواب المستشار للعرض — تُقطَع من النصّ بسياقها، ويُعرَف مفتاحُ كلٍّ منها، فيُوسَم
 * بما قاله الخادم عنه (`verify.ts`). ملفٌّ بلا وحداتِ خادم: تقرؤه الشاشة.
 *
 * والسياقُ جزءُ الرقم: «25.1٪» نسبةٌ لا تطابق إلّا نسبة، و«132,191 ريال» مبلغٌ لا يطابق نسبة،
 * و«21:00» ساعةٌ و«2026-10-27» تاريخٌ لا يُوسمان أصلاً — وُسمت الساعةُ مرّةً «من دفاترك:
 * تكلفة المبيعات» لأنّ ٢١ قريبٌ من ٢٠٫٧٪.
 */
import { latinDigits } from "@/lib/digits";

export type NumberKind = "pct" | "num";

/** ما لا يُوسَم: أعدادُ العدّ الصغيرة، والسنوات، وآفاقُ الخطّة. */
export function isNeutralNumber(n: number): boolean {
  return (Number.isInteger(n) && n <= 12) || (Number.isInteger(n) && n >= 2020 && n <= 2040) || n === 30 || n === 60 || n === 90;
}

/** مفتاحُ الرقم بنوعه — «pct:25.1» و«num:132191». */
export function numberKey(kind: NumberKind, n: number): string {
  return `${kind}:${n}`;
}

export interface NumberToken {
  /** موضعُه ونصُّه كما كُتب. */
  index: number;
  text: string;
  value: number;
  /** `null` لا يُوسَم: ساعةٌ، تاريخ، جزءُ اسم، أو عددٌ محايد. */
  kind: NumberKind | null;
}

/** الفاصلةُ العشريّة العربيّة — حرفٌ لا نصٌّ يُعرض (حارسُ الأرقام يقرأ القيمَ لا الشيفرة). */
const ARABIC_DECIMAL = String.fromCharCode(0x66b);
const NUMBER = /[\d٠-٩][\d٠-٩,٬]*(?:[.٫][\d٠-٩]+)?/g;

export function numberTokens(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const index = m.index ?? 0;
    const before = text.slice(Math.max(0, index - 2), index);
    const after = text.slice(index + m[0].length, index + m[0].length + 3);
    const value = Number(latinDigits(m[0]).replace(/[,٬]/g, "").replace(ARABIC_DECIMAL, "."));
    /* اسمٌ فيه رقمٌ لاتينيّ («V60») يبقى نصّاً لا رقماً */
    if (/[A-Za-z]$/.test(before) || /^[A-Za-z]/.test(after)) continue;
    /* ساعةٌ («21:00») أو تاريخ («2026-10-27») — قياسٌ للزمن لا للمال */
    const temporal = /^[:\-/]\d/.test(after) || /\d[:\-/]$/.test(before);
    const pct = /^\s?[٪%]/.test(after);
    out.push({ index, text: m[0], value, kind: !Number.isFinite(value) || temporal || (!pct && isNeutralNumber(value)) ? null : pct ? "pct" : "num" });
  }
  return out;
}

/** قطعُ النصّ إلى نصٍّ ورقم — للعرض: كلُّ رقمٍ يُوسَم بما قيل عنه. */
export type InlinePiece = { kind: "text"; text: string } | { kind: "number"; text: string; key: string | null };

export function splitNumbers(text: string): InlinePiece[] {
  const out: InlinePiece[] = [];
  let last = 0;
  for (const t of numberTokens(text)) {
    if (t.index > last) out.push({ kind: "text", text: text.slice(last, t.index) });
    out.push({ kind: "number", text: t.text, key: t.kind ? numberKey(t.kind, t.value) : null });
    last = t.index + t.text.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/**
 * «142192» ← «142,192»: النموذجُ يكتب القيمَ كما أُعطيها بلا فواصل، فتُقرأ بصعوبة. ما كُتب بفاصلٍ
 * أو كسرٍ يبقى، والسنةُ (2020–2040) تبقى، والأرقامُ العربيّة الهنديّة تبقى كما كُتبت.
 */
export function groupThousands(text: string): string {
  if (!/^\d{4,}$/.test(text)) return text;
  const n = Number(text);
  if (n >= 2020 && n <= 2040) return text;
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
