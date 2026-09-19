import { permanentRedirect } from "next/navigation";

/**
 * تحويلٌ دائم إلى «الأصناف والأسعار».
 *
 * كانت `/performance` و`/analysis` تشغّلان الاستعلام نفسه على بنود
 * الفواتير، وتعرضان جدول «الأصناف حسب الإنفاق» نفسه وبطاقتَي «أصناف
 * مختلفة» و«أسماء تتكرّر» بالرقمين نفسيهما. صفحتان لعملٍ واحد صارتا
 * واحدة — وفيها جدولُ الأسعار الذي كان يفتقده الرابط الآتي من التنبيه.
 */
export default function LegacyPerformance(): never {
  permanentRedirect("/analysis");
}
