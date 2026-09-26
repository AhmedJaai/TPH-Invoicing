"use client";

import { useEffect, useRef, useState } from "react";
import { Money } from "./money";

/**
 * مبلغٌ يتحرّك إلى قيمته الجديدة حين تتغيّر — لا في أوّل رسم.
 *
 * بعد فعلٍ (سدادٌ سُجّل، مطابقةٌ رُدّت) يُعاد رسمُ الصفحة بالرقم الجديد،
 * فكان يتبدّل في إطارٍ واحد ولا تعرف العينُ ما الذي تغيّر. فصار ينتقل إليه
 * في ٣٢٠ مللي ثانية ويومض بلونه لحظة. والانتقالُ بالهللات الصحيحة وحدها —
 * كلُّ إطارٍ عددٌ صحيح يُكتب كما يُكتب المال في كلّ موضع.
 *
 * ولمن طلب تقليل الحركة: لا عدّ، والرقمُ الجديد يظهر ويومض وحده.
 */
const TWEEN_MS = 320;

export function LiveMoney({ minor, currency = false }: { minor: number; currency?: boolean }) {
  const [shown, setShown] = useState(minor);
  const [flash, setFlash] = useState(0);
  const from = useRef(minor);

  useEffect(() => {
    const start = from.current;
    from.current = minor;
    if (start === minor) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / TWEEN_MS);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(k === 1 ? minor : Math.round(start + (minor - start) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(still ? () => setShown(minor) : step);
    setFlash((n) => n + 1);
    return () => cancelAnimationFrame(raf);
  }, [minor]);

  return (
    <span key={flash} className={flash > 0 ? "just-changed" : undefined}>
      <Money minor={shown} currency={currency} />
    </span>
  );
}
