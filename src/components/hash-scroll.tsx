"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/** كم يُنتظَر المحتوى قبل التخلّي — أطولُ صفحةٍ تُبنى في ثوانٍ. */
const WAIT_MS = 10_000;

/**
 * الرابطُ إلى موضعٍ في صفحة (`/bank#import`) يهبط إليه ولو وصل المحتوى متأخّراً.
 *
 * كان المتصفّح يبحث عن المرساة لحظةَ التنقّل، والصفحةُ حينها هيكلُ تحميلٍ
 * رماديّ — فلا يجدها ولا يعود إليها، ويبقى صاحبُ المقهى في رأس صفحةٍ
 * موضعُ عمله فيها بعد ألفٍ وثمانمئة بكسل. فتُنتظَر المرساة حتى تُرسَم ثمّ
 * يُهبَط إليها مرّةً واحدة؛ ومن مرّر بنفسه قبلها لا يُسحَب.
 */
export function HashScroll() {
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;

    let done = false;
    const land = () => {
      const el = document.getElementById(id);
      if (!el || done) return false;
      done = true;
      el.scrollIntoView({ block: "start" });
      return true;
    };
    if (land()) return;

    const startY = window.scrollY;
    const observer = new MutationObserver(() => {
      // من مرّر بنفسه وهو ينتظر قد اختار موضعه
      if (Math.abs(window.scrollY - startY) > 40) return stop();
      if (land()) stop();
    });
    const timer = window.setTimeout(() => stop(), WAIT_MS);
    function stop() {
      observer.disconnect();
      window.clearTimeout(timer);
    }
    observer.observe(document.body, { childList: true, subtree: true });
    return stop;
  }, [pathname, search]);

  return null;
}
