"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { Sparkles, X } from "lucide-react";
import { unseenNews, type NewsItem } from "@/lib/whats-new";

/**
 * «الجديد في النظام» — يُعرَض في «اليوم» مرّةً لكلّ بند، ويُطوى بزرّه.
 * حدُّ القراءة في تخزين الجهاز: راحةٌ لا بيانات، وإن مُنع عُرض ثانيةً ولا ضرر.
 */
const KEY = "tph.news.seen";
const EVENT = "tph:news";

function read(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

export function WhatsNew({ allowed }: { allowed: readonly NewsItem["needs"][] }) {
  /* الخادمُ لا يعرف ما قُرئ — فلا يرسم شيئاً، ويظهر ما لم يُقرأ بعد الترطيب */
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const items = useMemo(
    () => (raw === null ? [] : unseenNews(new Set(raw.split(",").filter(Boolean)), (c) => allowed.includes(c))),
    [raw, allowed],
  );
  if (items.length === 0) return null;

  function dismiss() {
    try {
      const seen = new Set([...read().split(",").filter(Boolean), ...items.map((n) => n.id)]);
      window.localStorage.setItem(KEY, [...seen].join(","));
    } catch { /* بلا حفظ */ }
    window.dispatchEvent(new Event(EVENT));
  }

  return (
    <section aria-labelledby="news-title" className="mb-6 rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 id="news-title" className="flex items-center gap-2 text-sm font-bold">
          <Sparkles className="h-4 w-4 text-accent" strokeWidth={2} aria-hidden />
          الجديد في النظام
        </h2>
        <button
          type="button"
          onClick={dismiss}
          aria-label="قرأتُه — أخفِ الجديد"
          className="-m-2 grid h-11 w-11 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink sm:m-0 sm:h-8 sm:w-8"
        >
          <X className="h-4 w-4" strokeWidth={2} aria-hidden />
        </button>
      </div>
      <ul className="mt-2 space-y-1.5">
        {items.map((n) => (
          <li key={n.id} className="text-xs leading-relaxed text-ink-soft">
            {n.text}{" "}
            <Link href={n.href} className="font-bold text-accent hover:underline">افتحه</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
