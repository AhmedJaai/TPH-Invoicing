/**
 * عكس الدفعة.
 *
 *   ٤ سبتمبر  −٤٬٢٥٠
 *   ٦ سبتمبر  +٤٬٢٥٠
 *
 * هذه حوالةٌ رُدّت، لا إيرادٌ ولا تحويلٌ داخليّ. وتسميتها إيراداً تُضخّم
 * الدخل، وتسميتها تحويلاً داخلياً تُخفيها — وكلاهما يترك الفاتورة
 * تبدو مسدَّدةً وهي ليست كذلك.
 *
 * والكشف يحتاج ثلاثة معاً: نفس المبلغ، واتجاهان متضادّان، وقربٌ في
 * الزمن. والمبلغ وحده لا يكفي — مقهىً يبيع ويشتري بمبالغ تتكرّر.
 */

export interface ReversalInput {
  id: string;
  valueDate: Date;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  /** ما يُقارَن به عند التساوي — المستفيد أو الوصف. */
  party: string | null;
}

export interface Reversal {
  outgoing: ReversalInput;
  incoming: ReversalInput;
  daysApart: number;
  /** هل تطابق الطرف أيضاً؟ دليلٌ أقوى. */
  samePartyEvidence: boolean;
}

/** أقصى أيامٍ بين الخصم وردّه. */
export const REVERSAL_WINDOW_DAYS = 14;

const DAY = 86_400_000;

/**
 * يكشف ما رُدّ.
 *
 * ويُقرَن كل خصمٍ بردٍّ واحد لا أكثر: خصمان بنفس المبلغ وردٌّ واحد
 * يعني أنّ أحدهما رُدّ، لا كلاهما. والقرن الجشع هنا آمن لأنّ الأقرب
 * زمناً هو الأرجح.
 */
export function findReversals(rows: readonly ReversalInput[]): Reversal[] {
  const debits = rows.filter((r) => r.direction === "DEBIT");
  const credits = rows.filter((r) => r.direction === "CREDIT");

  const used = new Set<string>();
  const found: Reversal[] = [];

  for (const out of [...debits].sort((a, b) => a.valueDate.getTime() - b.valueDate.getTime())) {
    const back = credits
      .filter((c) => !used.has(c.id))
      .filter((c) => c.amountMinor === out.amountMinor)
      .filter((c) => {
        const gap = c.valueDate.getTime() - out.valueDate.getTime();
        // الردّ يأتي **بعد** الخصم لا قبله
        return gap > 0 && gap <= REVERSAL_WINDOW_DAYS * DAY;
      })
      .sort((a, b) => a.valueDate.getTime() - b.valueDate.getTime())[0];

    if (!back) continue;

    used.add(back.id);
    found.push({
      outgoing: out,
      incoming: back,
      daysApart: Math.round((back.valueDate.getTime() - out.valueDate.getTime()) / DAY),
      samePartyEvidence: sameParty(out.party, back.party),
    });
  }

  return found;
}

function sameParty(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const x = norm(a);
  const y = norm(b);
  if (x.length < 4 || y.length < 4) return false;
  return x.includes(y) || y.includes(x);
}

/**
 * جملةٌ تصف ما وُجد.
 *
 * وتُذكر قوّة الدليل: تطابقُ الطرف يرفعها، وغيابه يُبقيها ترجيحاً —
 * فقد يكون المبلغان متساويين بالمصادفة.
 */
export function describeReversal(r: Reversal): string {
  const amount = (r.outgoing.amountMinor / 100).toFixed(2);
  const base =
    `خرج ${amount} في ${r.outgoing.valueDate.toISOString().slice(0, 10)} ` +
    `وعاد بعد ${r.daysApart} ${r.daysApart === 1 ? "يوم" : "أيام"}`;

  return r.samePartyEvidence
    ? `${base} — ومن الطرف نفسه، فهو ردٌّ لا إيراد.`
    : `${base} — والطرف لم يتطابق، فهو ترجيحٌ يحتاج نظرك.`;
}
