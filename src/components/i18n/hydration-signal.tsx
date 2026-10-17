"use client";

import { useEffect } from "react";

export const HYDRATED_EVENT = "tph:hydrated";

declare global {
  interface Window {
    __tphHydrated?: boolean;
  }
}

/**
 * يعلن أنّ الصفحة رُبطت (hydration) — أثرُه لا يعمل إلّا بعد ربط ما حوله.
 * ينتظره مترجمُ الواجهة الإنجليزيّة فلا يغيّر نصّاً لم تربطه React بعد،
 * وإلّا عدّته اختلافاً وأعادت رسم الصفحة كلّها.
 */
export function HydrationSignal() {
  useEffect(() => {
    window.__tphHydrated = true;
    window.dispatchEvent(new Event(HYDRATED_EVENT));
  }, []);
  return null;
}
