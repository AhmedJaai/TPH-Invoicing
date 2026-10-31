/**
 * قرارُ صاحب المقهى في ملاحظةٍ يحسبها النظام — «أسكِتها» أو «ذكّرني لاحقاً».
 *
 * الملاحظاتُ الجديدة (تسويةٌ لم تصل · خصمٌ ارتفع · وثيقةٌ تنتهي · رصيدٌ ينزل
 * تحت حدّه) تحذيراتٌ لا أحكام: يُسكتها صاحبُها بسببٍ يكتبه أو يؤجّلها، ولا
 * يُمنع بها فعل. والقرارُ يُحفظ في `alert_resolutions` بمفتاحٍ **يُشتقّ من
 * الحدث** (اليوم · الجهة · الشهر): فإن تغيّر الحدث تغيّر المفتاح وعاد السؤال.
 *
 * والتأجيلُ ينتهي من نفسه: `SNOOZED:YYYY-MM-DD` يُقرأ صامتاً حتى يومه وحده.
 */

/** بوادئُ المفاتيح التي يقبلها مسارُ القرار — وما عداها يُردّ. */
export const SIGNAL_PREFIXES = [
  "pos-missing",
  "pos-fee-rise",
  "recurring-suggest",
  "recurring-twice",
  "recurring-rose",
  "recurring-missing",
  "obligation",
  "cash-floor",
  "qty-outlier",
  "foodics-card",
  "foodics-purchase",
  "foodics-till",
  "stock-link",
  "stock-gap",
  "repeat-delivery",
  "price-rise",
  "statement-gap",
  "statement-missing",
  "vat-risk",
  "payroll-tx",
] as const;

export type SignalPrefix = (typeof SIGNAL_PREFIXES)[number];

export const SIGNAL_LABEL: Record<SignalPrefix, string> = {
  "pos-missing": "تسوية الشبكة لم تصل",
  "pos-fee-rise": "ارتفاع رسوم الشبكة",
  "recurring-suggest": "اقتراح مصروف متكرّر",
  "recurring-twice": "خصم تكرر مرتين في الشهر",
  "recurring-rose": "خصم ارتفع عن المعتاد",
  "recurring-missing": "خصم معتاد لم يحدث هذا الشهر",
  obligation: "وثيقة قارب انتهاؤها",
  "cash-floor": "الرصيد تحت حده",
  "qty-outlier": "كمية غير معتادة",
  "foodics-card": "فرق بين بطاقات فودكس ودفعة البنك",
  "foodics-purchase": "فرق بين مشتريات فودكس وفواتيرنا",
  "foodics-till": "فرق بين النقد المعدود في الصندوق والمتوقع",
  "stock-link": "بند فاتورة ليس من المخزون",
  "stock-gap": "فرق متكرر في صنف مخزون",
  "repeat-delivery": "توريد يبدو مسجّلاً مرتين",
  "price-rise": "ارتفاع سعر صنف عند مورّده",
  "statement-gap": "فرق بين كشف المورّد وسجلاتنا",
  "statement-missing": "فاتورة في كشف المورّد ليست عندنا",
  "vat-risk": "ضريبة فاتورة لا تُخصم",
  "payroll-tx": "حوالة راتب ليست لموظف",
};

/*
  «علمتُ، لا تُظهرها» لما يحسبه «يحتاج قرارك» (أحمد، ٢٣ أكتوبر ٢٠٢٦): حليبُ نادك ٩٫١٠ ← ٢٧٫٣٠،
  وكشفُ هنقري مان بثمانين ريالاً. والمفتاحُ يحمل الأرقام: إن ارتفع السعرُ ثانيةً أو تغيّر
  الفرقُ عاد السؤال — فالإسكاتُ لما رآه صاحبه لا لما لم يره.
*/
export function priceRiseKey(supplierId: string, normalizedDescription: string, nowPriceMinor: number): string {
  return `price-rise:${supplierId}:${shortHash(normalizedDescription)}:${nowPriceMinor}`;
}

/** فاتورةٌ في كشفه ليست عندنا — بمرجعها ويومها ومبلغها: إن تغيّر شيءٌ منها عاد السؤال. */
export function statementMissingKey(slug: string, ref: string | null, day: string, amountMinor: number): string {
  return `statement-missing:${encodeURIComponent(slug).slice(0, 80)}:${encodeURIComponent(ref ?? "-").slice(0, 60)}:${day}:${amountMinor}`;
}

export function statementGapKey(slug: string, day: string, theirsMinor: number, oursMinor: number): string {
  return `statement-gap:${encodeURIComponent(slug).slice(0, 80)}:${day}:${theirsMinor}:${oursMinor}`;
}

/**
 * «علمتُ أنّ ضريبة هذه الفاتورة لا تُخصم» — بالفاتورة وضريبتها. لا يغيّر حكمها ولا الإقرار:
 * يُخرجها من «يحتاج قرارك» وحده، وتعود إن تغيّرت ضريبتُها. ويُبنى في SQL بالصيغة نفسها
 * (`vatRiskKeySql` في `attention-facts.ts`) — واختبارٌ يقابلهما.
 */
export function vatRiskKey(invoiceId: string, vatMinor: number): string {
  return `vat-risk:${invoiceId}:${vatMinor}`;
}

/** بصمةٌ قصيرة ثابتة لنصٍّ قد يحوي مسافاتٍ وحروفاً عربيّة — FNV-1a، لا للأمان بل للمفتاح. */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const KEY_RE = /^[a-z-]{3,24}:[^\s]{1,160}$/;

export function signalPrefix(key: string): SignalPrefix | null {
  if (!KEY_RE.test(key)) return null;
  const head = key.slice(0, key.indexOf(":"));
  return SIGNAL_PREFIXES.find((p) => p === head) ?? null;
}

export const DISMISSED = "DISMISSED";

export function snoozedUntil(day: string): string {
  return `SNOOZED:${day}`;
}

/** يومُ انتهاء التأجيل من نصّ القرار — `null` لما ليس تأجيلاً. */
export function snoozeDay(decision: string): string | null {
  const m = /^SNOOZED:(\d{4}-\d{2}-\d{2})$/.exec(decision);
  return m ? m[1] : null;
}

/**
 * أصامتةٌ الملاحظةُ اليوم؟ — المُسكَتةُ دائماً، والمؤجَّلةُ حتى يومها (داخلاً).
 * وقرارٌ لا يُفهم نصُّه لا يُسكت شيئاً: الصمتُ عن غير علمٍ يُخفي تحذيراً.
 */
export function isSilenced(decision: string | null | undefined, today: string): boolean {
  if (!decision) return false;
  if (decision === DISMISSED) return true;
  const until = snoozeDay(decision);
  return until !== null && today <= until;
}

/** المفاتيحُ الصامتةُ اليوم من صفوف القرارات. */
export function silencedKeys(
  rows: readonly { key: string; decision: string }[],
  today: string,
): Set<string> {
  return new Set(rows.filter((r) => isSilenced(r.decision, today)).map((r) => r.key));
}

