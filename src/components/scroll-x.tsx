"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * وعاءٌ يُمرَّر عرضاً، ويقول إن كان وراء حافّته مزيد.
 *
 * كان تعليق `.scroll-x` يَعِد بحافّةٍ متدرّجة «تدلّ على أنّ وراءه مزيداً —
 * وإلّا ظنّه القارئ منتهياً»، والصنف ثلاثة أسطرٍ ليس فيها تدرّج. والوعد
 * غير المنفَّذ أسوأ من عدمه: من قرأ التعليق حسِب المسألة محلولةً فلم
 * يفحصها.
 *
 * والتدرّج لا يُرسَم دائماً بل على الجهة التي وراءها شيء: صفٌّ يسع محتواه
 * لا يُموَّه طرفاه، وصفٌّ بلغ آخره تُرفَع حافّته. فالعلامة إن ظهرت **صدقت**.
 *
 * ويُقاس الفيض بعد التركيب وعند التمرير وعند تغيّر المقاس، وتُراقَب
 * الأبعاد بـ`ResizeObserver` لأنّ المحتوى قد يصل بعد التركيب — كصفّ
 * مورّدين يُبنى في الخادم ويُرسَم بخطٍّ يُحمَّل بعده.
 */
export function ScrollX({
  children,
  className = "",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<"none" | "start" | "end" | "both">("none");

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    /*
      في الاتّجاه من اليمين إلى اليسار يكون `scrollLeft` سالباً أو صفراً
      في المتصفّحات الحديثة، فيؤخذ مطلقه. والسماح ببكسلٍ واحد لأنّ القياس
      كسريّ عند بعض مستويات التكبير، فيبقى فرقٌ لا يُرى ويُنتج حافّةً كاذبة.
    */
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 1) {
      setSide("none");
      return;
    }
    const at = Math.abs(el.scrollLeft);
    const atStart = at <= 1;
    const atEnd = at >= max - 1;

    setSide(atStart ? "end" : atEnd ? "start" : "both");
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    measure();
    el.addEventListener("scroll", measure, { passive: true });

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    /* فيض الابن هو ما يتغيّر حين يصل المحتوى، لا مقاس الوعاء */
    if (el.firstElementChild) ro.observe(el.firstElementChild);

    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [measure]);

  return (
    <div
      ref={ref}
      className={`scroll-x ${className}`}
      data-overflow={side === "none" ? undefined : side}
      {...rest}
    >
      {children}
    </div>
  );
}
