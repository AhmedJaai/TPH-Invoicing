"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Money } from "./money";
import { KIND_LABEL, type SearchHit } from "@/lib/search";

/**
 * البحث في كل شيء من مكان واحد.
 *
 * كان على صاحب المقهى أن يعرف في أيّ صفحة يقع ما يبحث عنه، ثمّ يفتحها
 * ويُرشّح فيها. وهو لا يفكّر هكذا: يتذكّر «٤٧٥٠٠» أو «لافا» أو رقم
 * فاتورة، ويريد أن يجد. فالنظام هو الذي يستنتج ما قُصد.
 *
 * ويُفتح بـ«/» من أي صفحة — لأنّ من يراجع مئة فاتورة لا يريد أن يمدّ
 * يده إلى الفأرة في كل مرّة.
 */

const DEBOUNCE_MS = 220;
const MIN_CHARS = 2;

export function SearchBox() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState(false);

  // «/» يفتح البحث، ما لم يكن المستخدم يكتب في حقل آخر
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (q.trim().length < MIN_CHARS) return;

    const timer = setTimeout(async () => {
      setBusy(true);
      setFailed(false);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { hits: SearchHit[] };
        setHits(data.hits);
        setActive(0);
        setOpen(true);
      } catch {
        setFailed(true);
        setHits([]);
        setOpen(true);
      } finally {
        setBusy(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  /* الحالة تُصفَّر عند الكتابة نفسها لا داخل أثرٍ جانبيّ */
  function onChange(value: string) {
    setQ(value);
    if (value.trim().length < MIN_CHARS) {
      setHits([]);
      setOpen(false);
    }
  }

  const go = useCallback((hit: SearchHit) => {
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
    router.push(hit.href);
  }, [router]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || hits.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % hits.length); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + hits.length) % hits.length); }
    if (e.key === "Enter") { e.preventDefault(); go(hits[active]); }
  }

  return (
    <div className="relative min-w-0 flex-1 sm:max-w-sm">
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => q.trim().length >= MIN_CHARS && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        type="search"
        dir="auto"
        aria-label="ابحث"
        placeholder="ابحث برقم أو مبلغ أو اسم…"
        className="w-full rounded-xl border border-line bg-sunken px-3 py-1.5 text-xs outline-none transition-colors placeholder:text-muted focus:border-ink-soft focus:bg-surface"
      />

      {!q && (
        <kbd className="pointer-events-none absolute inset-y-0 end-2.5 my-auto hidden h-4 items-center rounded border border-line bg-surface px-1 text-[10px] text-muted sm:flex">
          /
        </kbd>
      )}

      {open && (
        <div className="absolute inset-x-0 top-full z-40 mt-1.5 overflow-hidden rounded-2xl border border-line bg-surface shadow-lifted">
          {busy && hits.length === 0 && (
            <p className="px-4 py-3 text-xs text-muted">يبحث…</p>
          )}

          {failed && (
            <p className="px-4 py-3 text-xs text-danger">تعذّر البحث. حاول ثانيةً.</p>
          )}

          {!busy && !failed && hits.length === 0 && (
            <p className="px-4 py-3 text-xs text-muted">
              لا شيء يطابق «{q}». جرّب رقم فاتورة أو مبلغاً أو اسم مورّد.
            </p>
          )}

          {hits.length > 0 && (
            <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
              {hits.map((h, i) => (
                <li key={`${h.kind}-${h.id}`}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => go(h)}
                    onMouseEnter={() => setActive(i)}
                    className={`flex w-full items-start justify-between gap-3 px-3.5 py-2.5 text-start transition-colors ${
                      i === active ? "bg-sunken" : ""
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-bold">{h.title}</span>
                      <span className="block truncate text-[10px] text-muted">
                        {KIND_LABEL[h.kind]} · {h.subtitle}
                      </span>
                    </span>
                    {h.amountMinor !== undefined && (
                      <span className="nums shrink-0 text-xs font-bold">
                        <Money minor={h.amountMinor} />
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
