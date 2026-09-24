"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Money } from "./money";
import { KIND_LABEL, type SearchHit } from "@/lib/search";
import { COMMAND_GROUP_LABEL, commandsFor, matchCommands, type Command } from "@/lib/commands";
import { request } from "@/lib/http-client";
import type { Role } from "@/lib/permissions";

/**
 * لوحةُ الأوامر — البحثُ والانتقالُ والفعلُ من موضعٍ واحد.
 *
 * كان مربّعُ البحث يجد السجلّات وحدها: «لافا» تجد المورّد، و«٤٧٥٠٠» تجد
 * الحركة. أمّا «أقفل الشهر» أو «استورد الكشف» فلا — وهما ما يُفعَل كلَّ
 * أسبوع. فصار المربّعُ لوحةً: الكتابةُ تجد الأفعالَ والصفحاتِ فوراً (بلا
 * طلب، فهي معروفةٌ للمتصفّح)، والسجلّاتِ بعد مهلةٍ من الخادم.
 *
 * وتُفتَح بـ⌘K أو Ctrl+K أو «/» من أيّ صفحة — ومن زرٍّ ظاهرٍ لمن لا
 * يعرف الاختصار: الاختصارُ الذي لا يُرى لا يوجد إلّا لمن بناه.
 *
 * و`<dialog>` الأصليّ لا حاويةٌ مرسومة: يحبس التركيز، ويُغلَق بـEscape،
 * ويعيد التركيز إلى ما فتحه — بلا سطرٍ من عندنا يمكن أن ينسى واحدةً.
 */

const DEBOUNCE_MS = 200;
const MIN_CHARS = 2;
const OPEN_EVENT = "tph:command-palette";

/** يفتح اللوحة من أيّ زرّ — لوحةٌ واحدة في القشرة، ومداخلُ كثيرة. */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

type Row =
  | { type: "hit"; hit: SearchHit }
  | { type: "command"; command: Command };

export function CommandPalette({ role, canSearch }: { role: Role; canSearch: boolean }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  const commands = useMemo(() => commandsFor(role), [role]);

  const open = useCallback(() => {
    const d = dialogRef.current;
    if (!d || d.open) return;
    d.showModal();
    inputRef.current?.select();
  }, []);

  const close = useCallback(() => dialogRef.current?.close(), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (dialogRef.current?.open) close();
        else open();
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        open();
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, open);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, open);
    };
  }, [open, close]);

  useEffect(() => {
    if (!canSearch || q.trim().length < MIN_CHARS) return;
    /*
      الطلبُ الأقدم يُلغى حين يُكتب حرفٌ جديد — وإلّا ردّ بطيءٌ عن «لا»
      يصل بعد ردّ «لافا» فيغلبه.
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
          return;
        }
        setHits(r.data.hits);
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
  }, [q, canSearch]);

  function onChange(value: string) {
    setQ(value);
    setActive(0);
    if (value.trim().length < MIN_CHARS) {
      setHits([]);
      setFailed(null);
      setBusy(false);
    }
  }

  const matched = useMemo(() => matchCommands(q, commands), [q, commands]);
  const searching = canSearch && q.trim().length >= MIN_CHARS;

  /*
    الترتيب: الأفعالُ والصفحاتُ المطابقة أوّلاً حين تكون الكتابةُ كلمةً،
    والسجلّاتُ أوّلاً حين تكون رقماً — من كتب «٢٦٠٣٤٢» يطلب فاتورةً لا
    صفحة، ومن كتب «كشف» يطلب فعلاً.
  */
  const numeric = /^[\d٠-٩.,\s-]+$/.test(q.trim()) && q.trim().length > 0;
  const commandRows: Row[] = matched.map((command) => ({ type: "command", command }));
  const hitRows: Row[] = hits.map((hit) => ({ type: "hit", hit }));
  const rows: Row[] = numeric ? [...hitRows, ...commandRows] : [...commandRows, ...hitRows];
  const current = Math.min(active, Math.max(rows.length - 1, 0));

  const go = useCallback(
    (row: Row) => {
      close();
      setQ("");
      setHits([]);
      router.push(row.type === "hit" ? row.hit.href : row.command.href);
    },
    [close, router],
  );

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (rows.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((current + 1) % rows.length); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((current - 1 + rows.length) % rows.length); }
    if (e.key === "Enter") { e.preventDefault(); go(rows[current]); }
  }

  /* يُرسم عنوانُ كلّ مجموعةٍ عند أوّل صفٍّ منها */
  const groupOf = (r: Row) => (r.type === "hit" ? "RECORDS" : r.command.group);
  const GROUP_LABEL: Record<string, string> = { ...COMMAND_GROUP_LABEL, RECORDS: "في سجلّاتك" };

  return (
    <dialog
      ref={dialogRef}
      aria-label="ابحث أو انتقل"
      onClick={(e) => { if (e.target === dialogRef.current) close(); }}
      className="palette m-0 mx-auto mt-[12vh] w-[min(40rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-2xl border border-line bg-surface p-0 text-ink shadow-lifted backdrop:bg-black/35"
    >
      <div className="flex items-center gap-2.5 border-b border-line px-4">
        <SearchIcon className="h-4 w-4 shrink-0 text-muted" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          type="text"
          enterKeyHint="search"
          autoComplete="off"
          dir="rtl"
          aria-label="ابحث أو اكتب فعلاً"
          role="combobox"
          aria-expanded
          aria-controls="palette-results"
          aria-autocomplete="list"
          aria-activedescendant={rows.length > 0 ? `palette-row-${current}` : undefined}
          placeholder={canSearch ? "مورّد، رقم فاتورة، مبلغ — أو فعلٌ مثل «أقفل الشهر»" : "اكتب فعلاً أو صفحة"}
          className="palette-input min-h-13 w-full bg-transparent py-3.5 text-sm placeholder:text-muted"
        />
        <kbd className="hidden shrink-0 rounded border border-line px-1.5 text-[11px] text-muted sm:block">Esc</kbd>
      </div>

      <p className="sr-only" aria-live="polite">
        {busy ? "يبحث" : failed ? "تعذّر البحث" : `${rows.length} نتيجة`}
      </p>

      <ul id="palette-results" ref={listRef} role="listbox" aria-label="النتائج" className="max-h-[min(60vh,28rem)] overflow-y-auto py-1.5">
        {rows.map((r, i) => {
          const g = groupOf(r);
          const first = i === 0 || groupOf(rows[i - 1]) !== g;
          const selected = i === current;
          return (
            <li key={r.type === "hit" ? `h-${r.hit.kind}-${r.hit.id}` : `c-${r.command.id}`} role="presentation">
              {first && (
                <p className="px-4 pb-1 pt-2.5 text-[11px] font-bold text-muted" aria-hidden>
                  {GROUP_LABEL[g]}
                </p>
              )}
              <button
                type="button"
                id={`palette-row-${i}`}
                data-index={i}
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                onClick={() => go(r)}
                onMouseMove={() => { if (active !== i) setActive(i); }}
                className={`mx-1.5 flex min-h-11 w-[calc(100%-0.75rem)] items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-start ${
                  selected ? "bg-sunken" : ""
                }`}
              >
                {r.type === "command" ? (
                  <>
                    <span className="min-w-0 truncate text-sm">{r.command.label}</span>
                    {r.command.hint && <span className="shrink-0 truncate text-[11px] text-muted">{r.command.hint}</span>}
                  </>
                ) : (
                  <>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{r.hit.title}</span>
                      <span className="block truncate text-[11px] text-muted">
                        {KIND_LABEL[r.hit.kind]} · {r.hit.subtitle}
                      </span>
                    </span>
                    {r.hit.amountMinor !== undefined && (
                      <span className="nums shrink-0 text-xs font-bold">
                        <Money minor={r.hit.amountMinor} />
                      </span>
                    )}
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {searching && busy && hits.length === 0 && <p className="px-4 pb-3 text-xs text-muted">يبحث في سجلّاتك…</p>}
      {failed && <p className="px-4 pb-3 text-xs text-danger">تعذّر البحث في السجلّات: {failed}</p>}
      {rows.length === 0 && !busy && (
        <p className="px-4 py-6 text-center text-xs text-muted">
          لا شيء يطابق «{q}».{canSearch && " جرّب رقم فاتورة أو مبلغاً أو اسم مورّد."}
        </p>
      )}

      <div className="hidden items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-muted sm:flex">
        <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> للتنقّل</span>
        <span><Kbd>↵</Kbd> للفتح</span>
        <span className="ms-auto"><Kbd><bdi dir="ltr">⌘K</bdi></Kbd> أو <Kbd>/</Kbd> من أيّ صفحة</span>
      </div>
    </dialog>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line bg-sunken px-1 font-sans">{children}</kbd>;
}

/** الزرّ الظاهر — الاختصارُ الذي لا يُرى لا يوجد إلّا لمن بناه. */
export function CommandTrigger({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <button
        type="button"
        onClick={openCommandPalette}
        aria-label="ابحث أو انتقل"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-line text-ink-soft hover:border-ink-soft"
      >
        <SearchIcon className="h-[1.1rem] w-[1.1rem]" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-start text-xs text-muted transition-colors hover:border-ink-soft lg:min-h-9"
    >
      <SearchIcon className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">ابحث أو انتقل…</span>
      <kbd dir="ltr" className="shrink-0 rounded border border-line px-1 text-[10px]">⌘K</kbd>
    </button>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  );
}
