"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { overflowSide, revealDelta, type OverflowSide } from "@/lib/scroll-edge";

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
  const side = useOverflowEdge(ref);
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

/**
 * شريطُ ألسنةٍ يُمرَّر عرضاً (`<nav>`): حافّتُه المتدرّجة تقول إنّ وراءه ألسنة،
 * واللسانُ المختار (`aria-current`) يُمرَّر إلى الوسط عند الرسم — كان «فودكس»
 * مقصوصاً على الجوّال، واللسانُ المفتوح قد يقع خارج الشاشة فلا يُعرَف أين أنت.
 */
export function ScrollStrip({
  children,
  className = "",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement>(null);
  const side = useOverflowEdge(ref);
  const revealed = useRef<Element | null>(null);
  /* كلَّ رسمٍ يُسأل: أتغيّر اللسانُ المختار؟ فإن لم يتغيّر لا يُنازَع من مرّر الشريطَ بيده */
  useEffect(() => {
    const el = ref.current;
    const active = el?.querySelector<HTMLElement>('[aria-current="page"], [aria-current="true"], [aria-selected="true"]');
    if (!el || !active || revealed.current === active) return;
    revealed.current = active;
    const delta = revealDelta(el.getBoundingClientRect(), active.getBoundingClientRect());
    /* `scrollLeft` لا `scrollIntoView`: هذا لا يحرّك الصفحةَ عموديّاً */
    if (delta !== 0) el.scrollLeft += delta;
  });
  return (
    <nav
      ref={ref}
      className={`scroll-x ${className}`}
      data-overflow={side === "none" ? undefined : side}
      {...rest}
    >
      {children}
    </nav>
  );
}

/**
 * يُقاس الفيض بعد التركيب وعند التمرير وعند تغيّر المقاس، وتُراقَب الأبعاد
 * بـ`ResizeObserver` لأنّ المحتوى قد يصل بعد التركيب.
 */
function useOverflowEdge(ref: React.RefObject<HTMLElement | null>): OverflowSide {
  const [side, setSide] = useState<OverflowSide>("none");

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setSide(overflowSide(el.scrollWidth, el.clientWidth, el.scrollLeft));
  }, [ref]);

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
  }, [measure, ref]);

  return side;
}
