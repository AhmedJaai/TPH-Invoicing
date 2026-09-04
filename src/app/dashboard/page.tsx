import { permanentRedirect } from "next/navigation";

/**
 * تحويلٌ دائم إلى الرئيسية.
 *
 * كانت `/dashboard` تكرّر ما في `/` و`/performance` بأربعمئة سطر —
 * لوحةٌ ثانية بأرقامٍ محسوبة مرّتين بطريقتين، فتختلفان يوماً ولا يُعرف
 * أيّهما الصواب. وحُذفت ولم تُترَك تُشير إلى فراغ: من حفظ الرابط يصل.
 */
export default function LegacyDashboard(): never {
  permanentRedirect("/");
}
