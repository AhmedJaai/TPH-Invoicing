"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Inbox } from "lucide-react";
import { buttonClass } from "./ui-tokens";
import { shortcutKey } from "@/lib/shortcut-keys";
import { documentHref } from "@/lib/document-labels";
import { T } from "@/components/i18n/t";

function typingIn(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

/**
 * شريطُ الطابور في ملفّ المستند: «٢ من ٧ ينتظر» والسابقُ والتالي.
 *
 * مراجعةُ عشرة مستندات كانت عشرَ رحلاتٍ إلى القائمة وعشرَ عودات. فالملفُّ
 * يعرف موضعه ويمضي إلى تاليه — بالزرّ، أو بـJ/K حين يُفتح صفحةً كاملة.
 * (واللوحُ فوق القائمة له J/K من القشرة نفسها، فلا يُلتقط المفتاحُ مرّتين.)
 */
export function DocumentQueueNav({
  position,
  total,
  prevId,
  nextId,
}: {
  position: number | null;
  total: number;
  prevId: string | null;
  nextId: string | null;
}) {
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (typingIn(e.target) || document.querySelector("dialog[open]")) return;
      /* قائمةٌ تحت اللوح: J/K للقشرة — تنقل اللوحَ صفّاً صفّاً */
      if (document.querySelector("[data-nav-item]")) return;
      const key = shortcutKey(e);
      const to = key === "j" ? nextId : key === "k" ? prevId : null;
      if (!to) return;
      e.preventDefault();
      router.replace(documentHref(to), { scroll: false });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nextId, prevId, router]);

  if (total === 0 && position === null) return null;

  return (
    <nav
      aria-label="طابور المراجعة"
      className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-sunken/60 px-3 py-2"
    >
      <p className="flex min-w-0 items-center gap-2 text-xs font-bold text-ink-soft">
        <Inbox className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} aria-hidden />
        {position !== null
          ? <T s="مستند {0} من {1} ينتظر المراجعة" a={[<span key="0" className="nums">{position}</span>, <span key="1" className="nums">{total}</span>]} />
          : total > 0
            ? <T s="خرج من الطابور، وبقي {0} ينتظر" a={[<span key="0" className="nums">{total}</span>]} />
            : "لا شيء آخر ينتظر المراجعة"}
      </p>
      <span className="flex items-center gap-1.5">
        {prevId && (
          <Link href={documentHref(prevId)} replace scroll={false} className={buttonClass("quiet", "sm")} aria-keyshortcuts="K">
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            السابق
            <kbd aria-hidden className="hidden rounded border border-current/30 px-1 text-[10px] font-bold leading-4 opacity-70 lg:inline">K</kbd>
          </Link>
        )}
        {nextId && (
          <Link href={documentHref(nextId)} replace scroll={false} className={buttonClass(position === null ? "primary" : "secondary", "sm")} aria-keyshortcuts="J">
            {position === null ? "افتح التالي" : "التالي"}
            <kbd aria-hidden className="hidden rounded border border-current/30 px-1 text-[10px] font-bold leading-4 opacity-70 lg:inline">J</kbd>
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          </Link>
        )}
      </span>
    </nav>
  );
}
