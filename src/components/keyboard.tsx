"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { chordsFor } from "@/lib/nav";
import type { Role } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { Kbd } from "./ui";
import { Sheet } from "./ui-client";
import { triggerCapture } from "./nav";
import { SHORTCUTS_EVENT } from "@/lib/ui-events";
import { isInspectorPath, pathOf } from "@/lib/inspector";

/**
 * لوحةُ المفاتيح — لمن يعمل بها كلَّ يوم.
 *
 *   ⌘K أو /     ابحث أو انتقل أو افعل
 *   G ثمّ حرف   انتقل إلى مساحة (G S المورّدون · G B البنك …)
 *   J / K       الصفّ التالي / السابق في القائمة، وEnter يفتحه
 *   U           ارفع مستنداً
 *   ?           هذه القائمة
 *
 * والاختصارُ ظاهرٌ في الواجهة (بجانب المدخل في الشريط، وفي هذه القائمة):
 * الاختصارُ الذي لا يُرى لا يوجد إلّا لمن بناه. ولا يعمل شيءٌ منها
 * والمؤشّرُ في حقلٍ يُكتب فيه، ولا وحوارٌ مفتوح.
 */
const CHORD_MS = 1200;

function typingIn(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

export function KeyboardShortcuts({ role }: { role: Role }) {
  const router = useRouter();
  const [help, setHelp] = useState(false);
  const chords = useMemo(() => chordsFor(role), [role]);
  const pendingG = useRef<number | null>(null);

  useEffect(() => {
    const open = () => setHelp(true);
    window.addEventListener(SHORTCUTS_EVENT, open);
    return () => window.removeEventListener(SHORTCUTS_EVENT, open);
  }, []);

  useEffect(() => {
    function items(): HTMLElement[] {
      return Array.from(document.querySelectorAll<HTMLElement>("[data-nav-item]")).filter(
        (el) => el.offsetParent !== null && !el.hidden,
      );
    }

    function move(delta: number) {
      const list = items();
      if (list.length === 0) return;
      /* واللوحُ مفتوح: يبدأ العدُّ من الصفّ المفتوح فيه، لا من آخر ما اختير بالمفاتيح */
      const open = document.documentElement.dataset.inspector;
      const inspected = open ? list.findIndex((el) => pathOf(el.dataset.href ?? "") === open) : -1;
      const at = inspected !== -1 ? inspected : list.findIndex((el) => el.dataset.navActive === "true");
      const next = at === -1 ? (delta > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, at + delta));
      list.forEach((el) => delete el.dataset.navActive);
      const el = list[next];
      el.dataset.navActive = "true";
      el.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      /* لوحُ الفحص مفتوح: ينتقل إلى ملفّ الصفّ التالي في مكانه — مراجعةُ قائمةٍ بلا ذهابٍ وإياب */
      const href = el.dataset.href;
      if (open && href && isInspectorPath(href)) router.replace(href, { scroll: false });
    }

    function openActive(): boolean {
      const el = document.querySelector<HTMLElement>('[data-nav-item][data-nav-active="true"]');
      if (!el) return false;
      const href = el.dataset.href ?? el.querySelector<HTMLAnchorElement>("a[href]")?.getAttribute("href");
      if (!href) return false;
      router.push(href, { scroll: false });
      return true;
    }

    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (typingIn(e.target)) return;
      if (document.querySelector("dialog[open]")) return;

      const key = e.key.toLowerCase();

      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const hit = chords.find((c) => c.chord === key);
        if (hit) {
          e.preventDefault();
          router.push(hit.href);
        }
        return;
      }

      if (key === "g") {
        pendingG.current = window.setTimeout(() => { pendingG.current = null; }, CHORD_MS);
        return;
      }
      if (e.key === "?") { e.preventDefault(); setHelp(true); return; }
      if (key === "j") { e.preventDefault(); move(1); return; }
      if (key === "k") { e.preventDefault(); move(-1); return; }
      if (e.key === "Enter" && openActive()) { e.preventDefault(); return; }
      if (key === "u" && can(role, "document:upload")) { e.preventDefault(); triggerCapture(); return; }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chords, role, router]);

  return (
    <Sheet open={help} onClose={() => setHelp(false)} title="اختصارات لوحة المفاتيح" description="تعمل من أيّ صفحة ما دام المؤشّر خارج حقلٍ يُكتب فيه." size="md">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:grid-cols-2">
        <ShortcutGroup
          title="عامّ"
          rows={[
            { keys: ["⌘", "K"], label: "ابحث أو انتقل أو افعل" },
            { keys: ["/"], label: "افتح البحث" },
            ...(can(role, "document:upload") ? [{ keys: ["U"], label: "ارفع مستنداً أو صوّره" }] : []),
            { keys: ["?"], label: "هذه القائمة" },
            { keys: ["Esc"], label: "أغلق ما فُتح" },
          ]}
        />
        <ShortcutGroup
          title="في القوائم"
          rows={[
            { keys: ["J"], label: "الصفّ التالي" },
            { keys: ["K"], label: "الصفّ السابق" },
            { keys: ["Enter"], label: "افتح الصفّ المختار" },
            { keys: ["J", "K"], label: "واللوحُ مفتوح: الملفُّ التالي في مكانه" },
            { keys: ["Esc"], label: "أغلق اللوح" },
          ]}
        />
        <ShortcutGroup
          title="انتقل إلى"
          rows={chords.map((c) => ({ keys: ["G", c.chord.toUpperCase()], label: c.label }))}
        />
      </div>
    </Sheet>
  );
}

function ShortcutGroup({ title, rows }: { title: string; rows: { keys: string[]; label: string }[] }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-bold text-muted">{title}</h3>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-3 text-[13px]">
            <span>{r.label}</span>
            <span className="flex shrink-0 items-center gap-1">
              {r.keys.map((k, i) => (
                <Kbd key={i}>{k}</Kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
