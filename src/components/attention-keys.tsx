"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { shortcutKey } from "@/lib/shortcut-keys";
import { Kbd } from "./ui";
import { T } from "@/components/i18n/t";

/**
 * مفاتيحُ التفصيل في «يحتاج قرارك» — الفرزُ بلا فأرة:
 *
 *   N  البندُ التالي     P  السابق     E  افعل (الفعلُ الأوّل نفسُه: «قرّر هنا» أو الصفحةُ التي تصلحه)
 *
 * J/K في القائمة كما هي (`keyboard.tsx`) — وهذه تعمل والتركيزُ في التفصيل، بلا رجوعٍ إلى القائمة.
 * والمفتاحُ يتبع الرابطَ نفسه الذي في الصفحة، لا طريقاً ثانياً؛ ولا يعمل في حقلٍ أو حوارٍ مفتوح،
 * ويُقرأ من موضعه فيعمل ولوحةُ الكتابة عربيّة (`shortcutKey`).
 */
export function TriageKeys({ prev, next, act }: { prev?: string; next?: string; act: { href: string } | { anchor: string } }) {
  const router = useRouter();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (document.querySelector("dialog[open], [role=dialog]")) return;
      const key = shortcutKey(e);
      if (key === "n" && next) { e.preventDefault(); router.push(next, { scroll: false }); }
      else if (key === "p" && prev) { e.preventDefault(); router.push(prev, { scroll: false }); }
      else if (key === "e") {
        e.preventDefault();
        if ("href" in act) router.push(act.href);
        else {
          const el = document.getElementById(act.anchor);
          el?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
          el?.querySelector<HTMLElement>("button:not(:disabled), a[href]")?.focus({ preventScroll: true });
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, prev, next, act]);

  return (
    <p className="hidden text-[11px] text-muted lg:block">
      <T s="{0} التالي · {1} السابق · {2} افعل" a={[<Kbd key="0">N</Kbd>, <Kbd key="1">P</Kbd>, <Kbd key="2">E</Kbd>]} />
    </p>
  );
}
