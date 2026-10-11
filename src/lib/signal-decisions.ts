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
] as const;

export type SignalPrefix = (typeof SIGNAL_PREFIXES)[number];

export const SIGNAL_LABEL: Record<SignalPrefix, string> = {
  "pos-missing": "تسويةُ شبكةٍ لم تصل",
  "pos-fee-rise": "ارتفاعُ رسوم الشبكة",
  "recurring-suggest": "اقتراحُ مصروفٍ متكرّر",
  "recurring-twice": "خصمٌ تكرّر في الشهر",
  "recurring-rose": "خصمٌ ارتفع عن عادته",
  "recurring-missing": "خصمٌ معتادٌ غاب",
  obligation: "وثيقةٌ تنتهي",
  "cash-floor": "الرصيدُ تحت حدّه",
  "qty-outlier": "كمّيّةٌ على غير العادة",
  "foodics-card": "فرقٌ بين بطاقات فودكس ودفعة البنك",
  "foodics-purchase": "فرقٌ بين مشتريات فودكس وفواتيرنا",
};

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

