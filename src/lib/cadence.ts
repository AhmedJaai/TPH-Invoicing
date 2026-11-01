/**
 * دورةُ المصروف المتكرّر — وحدةٌ واحدة.
 *
 * كانت الدورةُ تُكتب نصّاً في خمسة مواضع (الواجهة · الطلب · الإسقاط · الحصّة الشهرية مرّتين)، فإضافةُ دورةٍ تعني
 * خمسةَ تعديلات يُنسى أحدُها فيُقرأ «نصف السنوي» شهرياً. وهنا الأشهرُ بين دفعتين، ومنها الحصّةُ وموضعُ الاستحقاق.
 * والإيجارُ في هذا المقهى نصفُ سنوي (٤٧٬٥٠٠ كلَّ ستّة أشهر).
 */
export const CADENCES = ["MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"] as const;
export type Cadence = (typeof CADENCES)[number];

/** الأشهرُ بين دفعةٍ وأخرى. */
export const CADENCE_MONTHS: Record<Cadence, number> = { MONTHLY: 1, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12 };

/** دورةُ المصروف من نصّ القاعدة — وما لا يُعرف شهريّ، كما يكتبه النموذجُ أو يبقى من قبل أن تُضاف الدورة. */
export function asCadence(v: string): Cadence {
  return (CADENCES as readonly string[]).includes(v) ? (v as Cadence) : "MONTHLY";
}

/** حصّة الشهر من مصروفٍ متكرّر — المبلغُ مقسوماً على أشهر دورته، بالهللة الصحيحة. */
export function monthlyShareOf(amountMinor: number, cadence: Cadence): number {
  return cadence === "MONTHLY" ? amountMinor : Math.round(amountMinor / CADENCE_MONTHS[cadence]);
}
