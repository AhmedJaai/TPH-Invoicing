/**
 * أحداثُ الواجهة المشتركة — لوحةٌ واحدة في القشرة ومداخلُ كثيرة.
 *
 * في ملفٍّ لا يستورد شيئاً، فيستدعيه الشريطُ واللوحةُ والاختصاراتُ بلا
 * استيرادٍ دائريّ بينها. للمتصفّح وحده.
 */
export const PALETTE_EVENT = "tph:command-palette";
export const SHORTCUTS_EVENT = "tph:shortcuts";

/** يفتح لوحة الأوامر من أيّ زرّ. */
export function openCommandPalette() {
  window.dispatchEvent(new Event(PALETTE_EVENT));
}

/** يفتح قائمة اختصارات لوحة المفاتيح. */
export function openShortcuts() {
  window.dispatchEvent(new Event(SHORTCUTS_EVENT));
}
