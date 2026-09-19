"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Money } from "./money";
import { KIND_LABEL, type SearchHit } from "@/lib/search";
import { request } from "@/lib/http-client";

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
  /** سببُ الفشل بنصّه: حدّ الاستعمال غير انتهاء الجلسة غير الشبكة. */
  const [failed, setFailed] = useState<string | null>(null);

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

    /*
      الطلبُ الأقدم يُلغى حين يُكتب حرفٌ جديد — وإلّا ردّ بطيءٌ عن «لا»
      يصل بعد ردّ «لافا» فيغلبه، ويرى صاحب العمل نتائج ما لم يعد يكتبه.
    */
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      setFailed(null);
      try {
        const r = await request<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: abort.signal,
        });
        if (abort.signal.aborted) return;
        if (!r.ok) {
          setFailed(r.error);
          setHits([]);
          setOpen(true);
          return;
        }
        setHits(r.data.hits);
        setActive(0);
        setOpen(true);
      } catch {
        /* أُلغي لأنّ بحثاً أحدث بدأ — لا عطب */
      } finally {
        if (!abort.signal.aborted) setBusy(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
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
        role="combobox"
        aria-expanded={open}
        aria-controls="search-results"
        aria-autocomplete="list"
        aria-activedescendant={open && hits.length > 0 ? `search-hit-${active}` : undefined}
        placeholder="ابحث برقم أو مبلغ أو اسم…"
        className="w-full rounded-xl border border-line-input bg-sunken px-3 py-1.5 text-xs outline-none transition-colors placeholder:text-muted focus:border-ink-soft focus:bg-surface"
      />

      {!q && (
        <kbd className="pointer-events-none absolute inset-y-0 end-2.5 my-auto hidden h-4 items-center rounded border border-line bg-surface px-1 text-[11px] text-muted sm:flex">
          /
        </kbd>
      )}

      {/* عددُ النتائج يُعلَن لقارئ الشاشة — القائمة وحدها لا تُسمَع */}
      <p className="sr-only" aria-live="polite">
        {open && !busy ? (failed ? "تعذّر البحث" : hits.length === 0 ? "لا نتائج" : `النتائج: ${hits.length}`) : ""}
      </p>

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
            <ul id="search-results" role="listbox" aria-label="نتائج البحث" className="max-h-[60vh] divide-y divide-line overflow-y-auto">
              {hits.map((h, i) => (
                <li key={`${h.kind}-${h.id}`} id={`search-hit-${i}`} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => go(h)}
                    onMouseEnter={() => setActive(i)}
                    className={`flex min-h-11 w-full items-start justify-between gap-3 px-3.5 py-2.5 text-start transition-colors ${
                      i === active ? "bg-sunken" : ""
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-bold">{h.title}</span>
                      <span className="block truncate text-[11px] text-muted">
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
