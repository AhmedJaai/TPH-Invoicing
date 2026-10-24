/**
 * «منذ صباح أمس» — الرقمُ الآن ناقصاً ما حفظته لقطةُ أمس (`daily_figures`)، لا إعادةُ حسابٍ
 * لأمس من دفاترٍ تغيّرت بعده.
 *
 * ولا لقطةَ لأمس (أوّلُ يوم، أو تعثّر التشغيل) أو الرقمُ مجهولٌ في أحد الطرفين: «غير معروف»
 * — لا صفر. صفرٌ هنا يقول «لم يتغيّر شيء» وهو لا يعلم. والجملةُ في `components/since-yesterday.tsx`.
 */
export type SinceYesterday =
  | { known: true; delta: number; day: string }
  | { known: false; day: string; reason: "no-snapshot" | "unknown-value" };

/** `snapshot`: قيمةُ الرقم في لقطة أمس — `undefined` لا لقطة، و`null` كانت مجهولة يومَها. */
export function sinceYesterday(now: number | null, snapshot: number | null | undefined, day: string): SinceYesterday {
  if (snapshot === undefined) return { known: false, day, reason: "no-snapshot" };
  if (snapshot === null || now === null) return { known: false, day, reason: "unknown-value" };
  return { known: true, delta: now - snapshot, day };
}

const get = (o: unknown, k: string): unknown => (typeof o === "object" && o !== null ? Reflect.get(o, k) : undefined);

/** ما يصل في ردّ JSON ← قيمة، وما لا يُقرأ `null` (لا يُعرض شيء ولا يُخترَع صفر). */
export function readSinceYesterday(v: unknown): SinceYesterday | null {
  const day = get(v, "day");
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const delta = get(v, "delta");
  if (get(v, "known") === true) return typeof delta === "number" && Number.isSafeInteger(delta) ? { known: true, delta, day } : null;
  const reason = get(v, "reason");
  return reason === "no-snapshot" || reason === "unknown-value" ? { known: false, day, reason } : null;
}
