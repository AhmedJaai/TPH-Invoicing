"use client";

import { Share2 } from "lucide-react";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";
import { T } from "@/components/i18n/t";

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
      toast({ tone: "ok", title: "نُسخت الإحاطة", body: "الصقها في واتساب أو في رسالة." });
    } catch (e) {
      /* أغلق ورقةَ المشاركة بيده — ليس عطباً */
      if (e instanceof DOMException && e.name === "AbortError") return;
      toast({ tone: "warn", title: "تعذّرت المشاركة", body: "المتصفح منع النسخ. حدّد النص من الصفحة وانسخه بنفسك." });
    }
  }
  return (
    <button type="button" onClick={() => void share()} className={buttonClass("secondary", "lg")}>
      <T s="{0}شارك الإحاطة" a={[<Share2 key="0" className="h-4 w-4" strokeWidth={2} aria-hidden />]} /></button>
  );
}
