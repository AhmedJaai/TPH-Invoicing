"use client";

import { useEffect } from "react";

/**
 * يسجّل عاملَ الخدمة (`public/sw.js`) — في الإنتاج وحده، وبعد أن تُحمَّل الصفحة.
 *
 * العاملُ لا يخزّن شيئاً من التطبيق: صفحةُ «بلا اتّصال» وهدفُ المشاركة وحدهما.
 * وفي التطوير لا يُسجَّل — كي لا يقف بين المطوّر وخادمه. وفشلُ التسجيل صامت:
 * التطبيقُ يعمل بلا عاملٍ كما كان.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        /* متصفّحٌ يمنعه أو جلسةٌ انتهت — لا عامل، ولا عطب */
      });
    };
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);
  return null;
}
