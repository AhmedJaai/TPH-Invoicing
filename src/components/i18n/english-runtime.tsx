"use client";

import { useEffect } from "react";
import { DICTIONARY_URL } from "@/lib/i18n/locale";
import { Translator, type Dictionary } from "@/lib/i18n/translate";
import { HYDRATED_EVENT } from "./hydration-signal";

/** ما لا يُمسّ نصُّه: ما يكتبه المستخدم، والشيفرة. */
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "NOSCRIPT", "CODE", "PRE"]);
const ATTRS = ["placeholder", "title", "aria-label", "alt"] as const;
/** حرفٌ عربيّ، أو رقمٌ هنديّ، أو علامةُ ترقيمٍ عربيّة — ما يحتاج ترجمة. */
const NEEDS = /[؀-ۿ«»]/;

/**
 * الواجهةُ بالإنجليزيّة: يترجم كلَّ نصٍّ يُرسم في الصفحة، ثمّ يراقب ما يتغيّر
 * فيترجمه لحظة ظهوره (قبل الرسم — مراقبُ التغييرات يعمل قبل الإطار التالي).
 *
 * يبدّل قيمةَ عقدة النصّ في مكانها ولا يستبدل العقدة، فتبقى React تملكها
 * وتحدّثها؛ وكلُّ تحديثٍ منها يُترجَم من جديد.
 */
export function EnglishRuntime() {
  useEffect(() => {
    const root = document.documentElement;
    const reveal = () => root.classList.remove("i18n-pending");
    const fallback = window.setTimeout(reveal, 2500);
    let observer: MutationObserver | null = null;
    let cancelled = false;

    /*
      لا يُمسّ نصٌّ قبل أن تنتهي React من ربط الصفحة (hydration): أجزاءُ الصفحة
      المتدفّقة تُربط بعد أثر هذا المكوّن، ونصٌّ تغيّر قبل ربطه يُعدّ اختلافاً
      فتعيد React رسمَ الجزء كلّه. فالمرورُ الأوّل بعد تمام التحميل ولحظةِ فراغ.
    */
    const loaded = new Promise<void>((resolve) => {
      const idle = () => (window.requestIdleCallback ? window.requestIdleCallback(() => resolve(), { timeout: 600 }) : window.setTimeout(resolve, 50));
      /* صفحاتُ التطبيق تعلن ربطها (`HydrationSignal` في القشرة)؛ وما لا قشرةَ له (الدخول) يكفيه تمامُ التحميل */
      const hydrated = new Promise<void>((done) => {
        if (window.__tphHydrated || !document.getElementById("main")) return done();
        window.addEventListener(HYDRATED_EVENT, () => done(), { once: true });
        window.setTimeout(done, 4000);
      });
      const complete = new Promise<void>((done) => {
        if (document.readyState === "complete") done();
        else window.addEventListener("load", () => done(), { once: true });
      });
      Promise.all([hydrated, complete]).then(idle);
    });
    const dictionary = fetch(DICTIONARY_URL, { cache: "force-cache" })
      .then((r) => (r.ok ? (r.json() as Promise<Dictionary>) : Promise.reject(new Error(String(r.status)))));

    Promise.all([dictionary, loaded])
      .then(([dict]) => {
        if (cancelled) return;
        const tr = new Translator(dict);
        const mine = new WeakMap<Node, string>();

        const skipped = (el: Element | null): boolean =>
          !el || SKIP.has(el.tagName) || (el as HTMLElement).isContentEditable || el.closest("[data-no-translate]") !== null;

        const text = (n: Text) => {
          const v = n.nodeValue;
          if (!v || mine.get(n) === v || !NEEDS.test(v) || skipped(n.parentElement)) return;
          const out = tr.translate(v);
          mine.set(n, out);
          if (out !== v) n.nodeValue = out;
        };
        const element = (el: Element) => {
          if (skipped(el)) return;
          for (const a of ATTRS) {
            const v = el.getAttribute(a);
            if (v && NEEDS.test(v)) {
              const out = tr.translate(v);
              if (out !== v) el.setAttribute(a, out);
            }
          }
        };
        const walk = (node: Node) => {
          if (node.nodeType === Node.TEXT_NODE) return text(node as Text);
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          element(node as Element);
          const w = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
          for (let n = w.nextNode(); n; n = w.nextNode()) {
            if (n.nodeType === Node.TEXT_NODE) text(n as Text);
            else element(n as Element);
          }
        };

        const title = document.head.querySelector("title");
        if (title) walk(title);
        walk(document.body);

        observer = new MutationObserver((records) => {
          for (const r of records) {
            if (r.type === "characterData") text(r.target as Text);
            else if (r.type === "attributes") element(r.target as Element);
            else r.addedNodes.forEach(walk);
          }
        });
        observer.observe(root, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: [...ATTRS],
        });
        reveal();
      })
      .catch(reveal);

    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
      observer?.disconnect();
    };
  }, []);
  return null;
}
