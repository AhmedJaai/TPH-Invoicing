"use client";

import { useEffect, useRef, useState } from "react";

/**
 * التلميحُ — طبقةٌ واحدة في القشرة لكلّ ما يحمل `data-tip`.
 *
 * كان التلميحُ `title` الأصليّ: يظهر بعد ثانيةٍ ونصف بخطّ النظام في صندوقٍ
 * أصفر، ويغيب عن الجوّال ولوحة المفاتيح. فصار:
 * - **أوّلُ تلميحٍ بعد مهلة** (٤٥٠ مللي ثانية) كي لا يومض مع كلّ مرور،
 *   **وما يليه فوراً** ما دامت العينُ تتنقّل بين الأزرار (Emil Kowalski).
 * - يظهر بالتركيز أيضاً — لمن يتنقّل بـTab.
 * - يقع فوق الزرّ أو تحته بحسب المتّسع، ولا يخرج من الشاشة، ويختفي
 *   بالتمرير والضغط وEscape.
 * - ولا يُغني عن الاسم: الزرُّ يحمل `aria-label` وهذا عونٌ للعين.
 */
const FIRST_DELAY = 450;
const WARM_MS = 600;

export function Tooltips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);
  const timer = useRef<number | null>(null);
  const lastHide = useRef(0);
  const target = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function place(el: HTMLElement) {
      const r = el.getBoundingClientRect();
      const below = r.top < 56;
      setTip({ text: el.dataset.tip ?? "", x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below });
    }
    function show(el: HTMLElement) {
      if (timer.current) window.clearTimeout(timer.current);
      target.current = el;
      const warm = performance.now() - lastHide.current < WARM_MS;
      if (warm) place(el);
      else timer.current = window.setTimeout(() => place(el), FIRST_DELAY);
    }
    function hide() {
      if (timer.current) window.clearTimeout(timer.current);
      if (target.current) lastHide.current = performance.now();
      target.current = null;
      setTip(null);
    }
    const tipOf = (e: Event) => (e.target as Element | null)?.closest?.("[data-tip]") as HTMLElement | null;
    function over(e: PointerEvent) {
      if (e.pointerType !== "mouse") return;
      const el = tipOf(e);
      if (el && el !== target.current) show(el);
      else if (!el && target.current) hide();
    }
    function focus(e: FocusEvent) {
      const el = tipOf(e);
      if (el && (e.target as HTMLElement).matches(":focus-visible")) show(el);
    }
    function key(e: KeyboardEvent) { if (e.key === "Escape") hide(); }
    document.addEventListener("pointerover", over);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", hide, { passive: true, capture: true });
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", hide, { capture: true });
    };
  }, []);

  if (!tip) return null;
  return (
    <div
      role="tooltip"
      className="tip no-print pointer-events-none fixed z-[80] max-w-64 rounded-md bg-inverse-surface px-2 py-1 text-[11px] font-bold leading-snug text-inverse-ink shadow-lifted"
      style={{
        left: `clamp(8px, ${tip.x}px, calc(100vw - 8px))`,
        top: tip.y,
        translate: `-50% ${tip.below ? "0" : "-100%"}`,
      }}
    >
      {tip.text}
    </div>
  );
}
