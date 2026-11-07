/**
 * الوحدةُ كما يقرؤها الموظّف — للتبليغ عن تالف. الكمّيّةُ مِلّيّاتٌ صحيحة (`units.ts`).
 */
export const UNIT_LABEL: Record<string, string> = { KG: "كجم", G: "جرام", L: "لتر", ML: "مل", PIECE: "حبة", PACK: "عبوة" };

/** «1.5 كجم» من 1500 مِلّي كجم — بلا عددٍ عشريّ في الطريق: القسمةُ نصّاً. */
export function formatQuantity(milli: number, unit: string): string {
  const whole = Math.trunc(milli / 1000);
  const frac = String(Math.abs(milli % 1000)).padStart(3, "0").replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""} ${UNIT_LABEL[unit] ?? unit}`;
}
