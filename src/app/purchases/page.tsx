import { permanentRedirect } from "next/navigation";

/**
 * تحويلٌ دائم إلى «حسابات المورّدين».
 *
 * كانت `/purchases` سبعَ بطاقاتٍ كلُّها روابط إلى صفحاتٍ أخرى — فهرسٌ
 * في ثوب صفحة، ولا عملَ فيها ولا جواب. وكلُّ ما كانت تشير إليه صار
 * لساناً في مساحة «المورّدون».
 */
export default function LegacyPurchases(): never {
  permanentRedirect("/suppliers");
}
