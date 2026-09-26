"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Clock, CornerDownLeft, FileText, Landmark, Package, Search, Store, Zap, Receipt, type LucideIcon,
} from "lucide-react";
import { Money } from "./money";
import { KIND_LABEL, parseSearch, type SearchHit } from "@/lib/search";
import { COMMAND_GROUP_LABEL, commandsFor, matchCommands, type Command } from "@/lib/commands";
import { activeArea } from "@/lib/nav";
import { request } from "@/lib/http-client";
import type { Role } from "@/lib/permissions";
import { NavGlyph } from "./icons";
import { PALETTE_EVENT, openCommandPalette, openShortcuts } from "@/lib/ui-events";
import { toggleAmounts, toggleTheme } from "./view-controls";

/**
 * لوحةُ الأوامر — البحثُ والانتقالُ والفعلُ من موضعٍ واحد.
 *
 * الكتابةُ تجد الأفعالَ والصفحاتِ فوراً (معروفةٌ للمتصفّح)، والسجلّاتِ —
 * مورّداً أو فاتورةً أو مبلغاً أو حركةً — من الخادم بعد مهلة. والرقمُ
 * يُفهَم مبلغاً («2,450» ± ريال) أو رقمَ فاتورة («INV-88»)، ويُقال ذلك
 * تحت الحقل كي يُعرف ما يُبحث عنه. وبلا كتابة: آخرُ ما فتحتَه ثمّ الأفعال.
 *
 * وتُفتَح بـ⌘K أو Ctrl+K أو «/» من أيّ صفحة، ومن زرٍّ ظاهر. و`<dialog>`
 * الأصليّ يحبس التركيز ويُغلَق بـEscape ويعيد التركيز إلى ما فتحه.
 */

const DEBOUNCE_MS = 180;
const MIN_CHARS = 2;
const RECENT_KEY = "tph.recent";
const RECENT_MAX = 6;

/** يُعاد تصديره للمستوردين القدامى — تعريفه في `lib/ui-events.ts`. */
export { openCommandPalette };

type Recent = { label: string; hint?: string; href: string; kind: "page" | SearchHit["kind"] };

type Row =
  | { type: "hit"; hit: SearchHit }
  | { type: "verb"; hit: SearchHit; verb: { label: string; href: string } }
  | { type: "command"; command: Command }
  | { type: "recent"; recent: Recent };

const HIT_ICON: Record<SearchHit["kind"], LucideIcon> = {
  invoice: Receipt,
  supplier: Store,
  product: Package,
  bankTransaction: Landmark,
  document: FileText,
};

function readRecent(): Recent[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list)
      ? list.filter((r): r is Recent => typeof r?.href === "string" && typeof r?.label === "string").slice(0, RECENT_MAX)
      : [];
  } catch {
    return [];
  }
}

function pushRecent(r: Recent) {
  try {
    const next = [r, ...readRecent().filter((x) => x.href !== r.href)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* متصفّحٌ يمنع التخزين — تبقى اللوحة بلا «الأخيرة» */
  }
}

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
  const [recent, setRecent] = useState<Recent[]>([]);

  const commands = useMemo(() => commandsFor(role), [role]);

  const open = useCallback(() => {
    const d = dialogRef.current;
    if (!d || d.open) return;
    setRecent(readRecent());
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
      } else if (e.key === "/" && !typing && !document.querySelector("dialog[open]")) {
        e.preventDefault();
        open();
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(PALETTE_EVENT, open);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(PALETTE_EVENT, open);
    };
  }, [open, close]);

  useEffect(() => {
    if (!canSearch || q.trim().length < MIN_CHARS) return;
    /* الطلبُ الأقدم يُلغى حين يُكتب حرفٌ جديد — وإلّا غلب ردٌّ بطيء ما بعده */
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
  const intent = useMemo(() => (canSearch && q.trim().length >= MIN_CHARS ? parseSearch(q) : null), [q, canSearch]);

  /*
    الترتيب: بلا كتابة — الأخيرةُ ثمّ الأفعال والصفحات. وبكتابة: الأفعالُ
    والصفحاتُ أوّلاً حين تكون كلمة، والسجلّاتُ أوّلاً حين تكون رقماً —
    من كتب «٢٦٠٣٤٢» يطلب فاتورةً لا صفحة.
  */
  const numeric = intent !== null && intent.kind !== "TEXT";
  const commandRows: Row[] = matched.map((command) => ({ type: "command", command }));
  /* تحت كلّ سجلٍّ أفعالُه — «سجّل سدادها» لا «افتحها ثمّ ابحث عن الزرّ» */
  const hitRows: Row[] = hits.flatMap((hit): Row[] => [
    { type: "hit", hit },
    ...(hit.verbs ?? []).map((verb): Row => ({ type: "verb", hit, verb })),
  ]);
  const recentRows: Row[] = q.trim() === "" ? recent.map((r) => ({ type: "recent", recent: r })) : [];
  const rows: Row[] = numeric ? [...hitRows, ...commandRows] : [...recentRows, ...commandRows, ...hitRows];
  const current = Math.min(active, Math.max(rows.length - 1, 0));

  const go = useCallback(
    (row: Row) => {
      close();
      setQ("");
      setHits([]);
      if (row.type === "command" && row.command.event) {
        if (row.command.event === "shortcuts") openShortcuts();
        if (row.command.event === "theme") toggleTheme();
        if (row.command.event === "amounts") toggleAmounts();
        return;
      }
      if (row.type === "hit") {
        pushRecent({ label: row.hit.title, hint: KIND_LABEL[row.hit.kind], href: row.hit.href, kind: row.hit.kind });
        router.push(row.hit.href, { scroll: false });
      } else if (row.type === "verb") {
        router.push(row.verb.href, { scroll: false });
      } else if (row.type === "command") {
        pushRecent({ label: row.command.label, hint: row.command.hint, href: row.command.href, kind: "page" });
        router.push(row.command.href);
      } else {
        pushRecent(row.recent);
        router.push(row.recent.href, { scroll: false });
      }
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

  const groupOf = (r: Row) => (r.type === "hit" || r.type === "verb" ? "RECORDS" : r.type === "recent" ? "RECENT" : r.command.group);
  const GROUP_LABEL: Record<string, string> = { ...COMMAND_GROUP_LABEL, RECORDS: "في سجلّاتك", RECENT: "فتحتَها مؤخّراً" };

  const intentLine =
    intent?.kind === "AMOUNT" && intent.amountMinor !== undefined ? <>يبحث عن مبلغ <Money minor={intent.amountMinor} /> ± ريال في الفواتير والحركات</>
    : intent?.kind === "NUMBER" ? <>يبحث عن رقم <bdi dir="ltr" className="font-mono">{intent.term}</bdi> في الفواتير والمراجع</>
    : intent?.kind === "MONTH" ? <>يبحث في شهر <bdi dir="ltr">{intent.term}</bdi></>
    : intent?.kind === "DATE" ? <>يبحث في يوم <bdi dir="ltr">{intent.term}</bdi></>
    : intent?.kind === "VAT" ? <>يبحث عن رقمٍ ضريبيّ بين المورّدين</>
    : null;

  return (
    <dialog
      ref={dialogRef}
      aria-label="ابحث أو انتقل"
      onClick={(e) => { if (e.target === dialogRef.current) close(); }}
      className="palette m-0 mx-auto mt-[10vh] w-[min(42rem,calc(100vw-1.5rem))] max-w-none overflow-hidden rounded-2xl border border-line bg-overlay p-0 text-ink shadow-overlay"
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search className="h-[18px] w-[18px] shrink-0 text-accent" strokeWidth={2} aria-hidden />
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
          className="palette-input min-h-14 w-full bg-transparent py-4 text-[15px] placeholder:text-muted"
        />
        {busy ? (
          <span aria-hidden className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-accent" />
        ) : (
          <kbd className="hidden shrink-0 rounded-md border border-line px-1.5 text-[11px] text-muted sm:block">Esc</kbd>
        )}
      </div>

      {intentLine && (
        <p className="border-b border-line-soft bg-sunken/60 px-4 py-2 text-[11px] text-ink-soft">{intentLine}</p>
      )}

      <p className="sr-only" aria-live="polite">
        {busy ? "يبحث" : failed ? "تعذّر البحث" : `${rows.length} نتيجة`}
      </p>

      <ul id="palette-results" ref={listRef} role="listbox" aria-label="النتائج" className="max-h-[min(62vh,30rem)] overflow-y-auto py-2">
        {rows.map((r, i) => {
          const g = groupOf(r);
          const first = i === 0 || groupOf(rows[i - 1]) !== g;
          const selected = i === current;
          const key = r.type === "hit" ? `h-${r.hit.kind}-${r.hit.id}`
            : r.type === "verb" ? `v-${r.hit.kind}-${r.hit.id}-${r.verb.href}`
            : r.type === "recent" ? `r-${r.recent.href}` : `c-${r.command.id}`;
          return (
            <li key={key} role="presentation">
              {first && (
                <p className="px-4 pb-1.5 pt-3 text-[11px] font-bold text-muted" aria-hidden>
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
                className={`mx-2 flex min-h-12 w-[calc(100%-1rem)] items-center gap-3 rounded-lg px-2.5 py-2 text-start transition-colors ${
                  selected ? "bg-accent-soft" : ""
                }`}
              >
                <RowIcon row={r} selected={selected} />
                <RowBody row={r} />
                {selected && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} aria-hidden />}
              </button>
            </li>
          );
        })}
      </ul>

      {searching && busy && hits.length === 0 && rows.length === 0 && <p className="px-4 pb-4 text-xs text-muted">يبحث في سجلّاتك…</p>}
      {failed && <p className="px-4 pb-3 text-xs text-danger">تعذّر البحث في السجلّات: {failed}</p>}
      {rows.length === 0 && !busy && (
        <p className="px-4 py-8 text-center text-xs text-muted">
          لا شيء يطابق «{q}».{canSearch && " جرّب رقم فاتورة أو مبلغاً أو اسم مورّد."}
        </p>
      )}

      <div className="hidden items-center gap-4 border-t border-line bg-sunken/50 px-4 py-2.5 text-[11px] text-muted sm:flex">
        <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> للتنقّل</span>
        <span className="flex items-center gap-1"><Kbd>↵</Kbd> للفتح</span>
        <span className="ms-auto flex items-center gap-1"><Kbd>?</Kbd> كلُّ الاختصارات</span>
      </div>
    </dialog>
  );
}

function RowIcon({ row, selected }: { row: Row; selected: boolean }) {
  const box = `grid h-8 w-8 shrink-0 place-items-center rounded-lg ${selected ? "bg-raised text-accent" : "bg-sunken text-ink-soft"}`;
  if (row.type === "verb") {
    return <span className={`${box} ms-6 h-7 w-7`}><Zap className="h-3.5 w-3.5" strokeWidth={2} aria-hidden /></span>;
  }
  if (row.type === "hit") {
    const Icon = HIT_ICON[row.hit.kind];
    return <span className={box}><Icon className="h-4 w-4" strokeWidth={2} aria-hidden /></span>;
  }
  if (row.type === "recent") {
    return <span className={box}><Clock className="h-4 w-4" strokeWidth={2} aria-hidden /></span>;
  }
  if (row.command.group === "ACTION") {
    return <span className={box}><Zap className="h-4 w-4" strokeWidth={2} aria-hidden /></span>;
  }
  const area = activeArea(row.command.href.split(/[?#]/)[0]);
  return (
    <span className={box}>
      {area ? <NavGlyph icon={area.icon} className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden />}
    </span>
  );
}

function RowBody({ row }: { row: Row }) {
  if (row.type === "verb") {
    return (
      <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[13px] font-medium">{row.verb.label}</span>
        <span className="shrink-0 truncate text-[11px] text-muted">{row.hit.title}</span>
      </span>
    );
  }
  if (row.type === "command") {
    return (
      <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium">{row.command.label}</span>
        {row.command.hint && <span className="shrink-0 truncate text-[11px] text-muted">{row.command.hint}</span>}
      </span>
    );
  }
  if (row.type === "recent") {
    return (
      <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm">{row.recent.label}</span>
        {row.recent.hint && <span className="shrink-0 truncate text-[11px] text-muted">{row.recent.hint}</span>}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{row.hit.title}</span>
        <span className="block truncate text-[11px] text-muted">
          {KIND_LABEL[row.hit.kind]} · {row.hit.subtitle}
        </span>
      </span>
      {row.hit.amountMinor !== undefined && (
        <span className="shrink-0 text-[13px] font-bold">
          <Money minor={row.hit.amountMinor} />
        </span>
      )}
    </span>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex min-w-5 justify-center rounded border border-line bg-raised px-1 font-sans leading-4">{children}</kbd>;
}
