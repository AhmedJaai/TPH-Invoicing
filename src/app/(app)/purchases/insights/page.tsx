import { permanentRedirect } from "next/navigation";

/**
 * تحويلٌ دائم إلى «حسابات المورّدين».
 *
 * كانت `/purchases/insights` تجيب «كم عليك لكلّ مورّد» وتعدّ اثني عشر
 * مورّداً، و`/suppliers` تعرض الجدول نفسه وتعدّ اثنين وعشرين. جوابان
 * لسؤالٍ واحد في شاشتين متجاورتين في القائمة نفسها.
 */
export default function LegacyInsights(): never {
  permanentRedirect("/suppliers");
}
