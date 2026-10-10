"use client";

import { Share2 } from "lucide-react";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";

/**
 * «شارك الإحاطة» — نصُّ الصباح جاهزاً لواتساب.
 *
 * النصُّ يبنيه الخادمُ من أرقام الصفحة نفسها ويمرّره؛ هنا يُسلَّم لورقة المشاركة
 * في الهاتف، وحيث لا ورقةَ يُنسَخ ويُقال ذلك.
 */
export function ShareBrief({ text }: { text: string }) {
  async function share() {
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      toast({ tone: "ok", title: "نُسخت الإحاطة", body: "الصقها في واتساب أو رسالة." });
    } catch (e) {
      /* أغلق ورقةَ المشاركة بيده — ليس عطباً */
      if (e instanceof DOMException && e.name === "AbortError") return;
      toast({ tone: "warn", title: "تعذّرت المشاركة", body: "المتصفّح منع النسخ — حدّد النصَّ يدويّاً من الصفحة." });
    }
  }
  return (
    <button type="button" onClick={() => void share()} className={buttonClass("secondary", "lg")}>
      <Share2 className="h-4 w-4" strokeWidth={2} aria-hidden />
      شارك الإحاطة
    </button>
  );
}
