import { permanentRedirect } from "next/navigation";

/**
 * تحويلٌ دائم إلى «الأصناف والأسعار».
 *
 * ربطُ اسم الصنف عند المورّد بصنفٍ معياريّ **عملٌ على الأصناف**، لا
 * صفحةٌ ثالثة عنها بجانب صفحتين تعرضانها. فصار قسماً في مكانه.
 */
export default function LegacyProducts(): never {
  permanentRedirect("/analysis");
}
