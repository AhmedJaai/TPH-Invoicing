/**
 * رصيدُ القراءة الذكيّة عند DeepSeek — قراءةُ ردّ `GET /user/balance` بلا عدد عشريّ.
 *
 * نفدَ الرصيدُ مرّةً فوقفت قراءةُ الفواتير ولم يعلم أحدٌ حتى سقطت أولاها (`NO_BALANCE`).
 * فيُسأل المزوّدُ كلَّ صباح (`/api/cron/daily`) وفي الفحص المفصَّل (`/api/health`)، وإن قلّ
 * عن حدّه صار بنداً في «يحتاج قرارك». والردُّ الذي لا يُقرأ «غير معروف» — لا صفر: صفرٌ كاذب
 * يقول «اشحن» لرصيدٍ ممتلئ، أو يُسكت نفاداً حقيقيّاً.
 *
 * والمبلغُ بالسنت (جزءُ المئة من العملة) عدداً صحيحاً — رصيدُ المزوّد لا ريالاتُ المقهى،
 * فلا يمرّ بالهللات.
 */

/** حدُّ «ينفد» بعملة الرصيد، بالسنت: ٥ دولارات (أو ما يقاربها باليوان لحسابٍ صينيّ). */
export const AI_BALANCE_LOW_CENTS: Readonly<Record<string, number>> = { USD: 5_00, CNY: 35_00 };

export type AiBalance =
  | { known: true; currency: string; cents: number; available: boolean }
  | { known: false; reason: string };

/** «110.00» ← 11000 — نصّاً لا عدداً عائماً. وما زاد على منزلتين أو لم يكن رقماً `null`. */
export function decimalToCents(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(cents)) return null;
  return m[1] === "-" ? -cents : cents;
}

const get = (o: unknown, k: string): unknown => (typeof o === "object" && o !== null ? Reflect.get(o, k) : undefined);

/** ردُّ المزوّد ← رصيد. يُفضَّل الدولار إن وُجد، وإلّا أوّلُ عملة. */
export function parseBalanceReply(data: unknown): AiBalance {
  const infos = get(data, "balance_infos");
  if (!Array.isArray(infos) || infos.length === 0) return { known: false, reason: "ردّ المزوّد بلا رصيد يُقرأ" };
  const usd = infos.find((i) => get(i, "currency") === "USD");
  const info = usd ?? infos[0];
  const currency = get(info, "currency");
  const cents = decimalToCents(get(info, "total_balance"));
  if (typeof currency !== "string" || cents === null) return { known: false, reason: "ردّ المزوّد بلا رصيد يُقرأ" };
  return { known: true, currency, cents, available: get(data, "is_available") !== false };
}

/** أقلَّ من حدّه؟ — والعملةُ التي لا حدَّ لها لا تُنذر: لا يُخمَّن سعرُ صرف. */
export function balanceIsLow(b: AiBalance): boolean {
  if (!b.known) return false;
  if (!b.available) return true;
  const limit = AI_BALANCE_LOW_CENTS[b.currency];
  return limit !== undefined && b.cents < limit;
}

/** «4.20 USD» — والمجهولُ «غير معروف». */
export function formatAiBalance(b: AiBalance): string {
  if (!b.known) return "غير معروف";
  const sign = b.cents < 0 ? "-" : "";
  const abs = Math.abs(b.cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")} ${b.currency}`;
}
