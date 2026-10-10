"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, CircleAlert, CircleCheck, Info, Search, TriangleAlert, Undo2, X } from "lucide-react";
import { buttonClass, fieldClass, type ButtonVariant } from "./ui-tokens";
import { normalizeArabic, normalizeDigits } from "@/lib/search";
import { shortcutKey } from "@/lib/shortcut-keys";
import { formatSort, nextSort, parseSort, type SortDir } from "@/lib/table-sort";

/**
 * عناصر تحتاج تفاعلاً — الإقرار، والبحثُ داخل الجدول، والإشعاراتُ
 * بالتراجع، والحوارُ والورقة. وما لا يحتاج تفاعلاً في `ui.tsx`.
 */

/* ─────────────────────────── الإقرار ─────────────────────────── */

/**
 * فعلٌ لا رجعة فيه يُؤكَّد بإقرار، لا بنقرتين.
 *
 * «هل أنت متأكّد؟» سؤالٌ يُجاب بنعم آلياً بعد ثالث مرّة. أمّا أن يقرأ
 * المستخدم ماذا يعني الفعل ثمّ يعلن أنّه فهمه، فذلك يوقفه لحظةً كافية.
 */
export function ConfirmAction({
  label,
  title,
  consequence,
  acknowledgement,
  confirmLabel,
  variant = "danger",
  tone = "danger",
  size = "sm",
  block = false,
  onConfirm,
  disabled,
}: {
  label: string;
  title: string;
  /** ماذا يترتّب على الفعل — بصراحة لا بتلميح. */
  consequence: string;
  /** ما يقرّه المستخدم قبل أن يُفتح الزرّ. */
  acknowledgement: string;
  confirmLabel: string;
  variant?: ButtonVariant;
  /** `danger` لما لا رجعة فيه، و`warn` لما يُراجَع ويُفتح ثانيةً. */
  tone?: "danger" | "warn";
  size?: "sm" | "md";
  block?: boolean;
  /** يُرجع `false` إن فشل — فيبقى اللوح مفتوحاً ولا يُعاد الإقرار. */
  onConfirm: () => Promise<void | boolean> | void | boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);

  const skin =
    tone === "warn"
      ? { box: "border-warn/30 bg-warn-bg", title: "text-warn", confirm: "primary" as ButtonVariant, Icon: TriangleAlert }
      : { box: "border-danger/30 bg-danger-bg", title: "text-danger", confirm: "danger" as ButtonVariant, Icon: CircleAlert };

  const triggerRef = useRef<HTMLButtonElement>(null);
  const checkRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  /* الإقرارُ يفتح في مكانه ويأخذ التركيز؛ والتراجعُ يعيده إلى الزرّ الذي فتحه */
  useEffect(() => {
    if (open) checkRef.current?.focus({ preventScroll: true });
  }, [open]);

  function cancel() {
    setOpen(false);
    setUnderstood(false);
    requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }

  return (
    <div className={block ? "w-full" : ""}>
      {!open && (
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-expanded={false}
          onClick={() => setOpen(true)}
          className={`${buttonClass(variant, size)} ${block ? "w-full" : ""}`}
        >
          {label}
        </button>
      )}

      <Reveal open={open}>
        <div
          role="group"
          aria-labelledby={titleId}
          onKeyDown={(e) => { if (e.key === "Escape" && !busy) { e.stopPropagation(); cancel(); } }}
          className={`rounded-xl border p-4 ${skin.box}`}
        >
          <p id={titleId} className={`flex items-center gap-2 text-sm font-bold ${skin.title}`}>
            <skin.Icon className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            {title}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{consequence}</p>

          <label className="mt-3 flex min-h-11 items-start gap-2.5 text-xs leading-relaxed sm:min-h-0">
            <input
              ref={checkRef}
              type="checkbox"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
            />
            <span>{acknowledgement}</span>
          </label>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!understood}
              aria-busy={busy}
              title={!understood ? "أقرَّ بما فوقه أوّلاً" : undefined}
              onClick={async () => {
                if (busy) return;
                setBusy(true);
                let ok = true;
                try {
                  ok = (await onConfirm()) !== false;
                } catch {
                  ok = false;
                } finally {
                  setBusy(false);
                  /* اللوح يُغلق عند النجاح وحده — كان يُغلق بعد الفشل فيُعاد الإقرار كلُّه */
                  if (ok) {
                    setOpen(false);
                    setUnderstood(false);
                  }
                }
              }}
              className={buttonClass(skin.confirm, "sm")}
            >
              {confirmLabel}
            </button>
            <button type="button" disabled={busy} onClick={cancel} className={buttonClass("quiet", "sm")}>
              تراجع
            </button>
          </div>
        </div>
      </Reveal>
    </div>
  );
}

/* ─────────────────────────── الكشفُ في المكان ─────────────────────────── */

/**
 * ما يُكشف في مكانه (لوحُ إقرار، تفصيلُ صفّ، حقلُ تعديل) يتحرّك ارتفاعُه
 * ولا يقفز. `grid-template-rows` من ‎0fr‎ إلى ‎1fr‎ في `globals.css`.
 *
 * والمطويُّ باقٍ في الشجرة، مخفيٌّ بعد انتهاء حركته (`visibility`) و`inert`
 * أثناءها — فلا يصل إليه التركيز ولا قارئُ الشاشة. كان يُزال بمؤقّتٍ يسابق
 * الفتحَ فيُخفي ما فُتح للتوّ؛ فصار CSS وحده، بلا حالةٍ ولا مؤقّت.
 */
export function Reveal({
  open,
  children,
  className = "",
}: {
  open: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`reveal ${className}`} data-open={open} inert={!open}>
      <div>{children}</div>
    </div>
  );
}

/* ─────────────────────────── زرُّ الفعل ─────────────────────────── */

/**
 * زرٌّ يفعل شيئاً عند الخادم — ينتظر في مكانه ويقول «تمّ».
 *
 * - الضغطةُ الثانية أثناء الانتظار لا تُرسل شيئاً (مرجعٌ لا حالة، فلا
 *   يسبقه إطارُ رسم).
 * - الانتظارُ دوّارةٌ داخل الزرّ بعرضه نفسه (`aria-busy`).
 * - النجاحُ علامةٌ قصيرة ثمّ يعود — إلّا إن أُزيل الزرُّ لأنّ عمله انتهى.
 * - `onAction` يُرجع `false` إن فشل، فلا تُعرَض علامةُ نجاح. والرسالةُ
 *   عند من ناداه — هو يعرف ما يقول.
 * - `reason`: لماذا هو معطَّل — تُقرأ تحت الفأرة ولقارئ الشاشة.
 */
export function ActionButton({
  onAction,
  children,
  variant = "secondary",
  size = "md",
  disabled = false,
  reason,
  className = "",
  showDone = true,
  label,
}: {
  onAction: () => Promise<unknown> | unknown;
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  reason?: string;
  className?: string;
  showDone?: boolean;
  /** اسمٌ يُقرأ حين يكون الزرُّ رمزاً بلا نصّ. */
  label?: string;
}) {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const reasonId = useId();

  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(false), 1100);
    return () => window.clearTimeout(t);
  }, [done]);

  async function run() {
    if (running.current || disabled) return;
    running.current = true;
    setBusy(true);
    let ok = true;
    try {
      ok = (await onAction()) !== false;
    } catch {
      ok = false;
    } finally {
      running.current = false;
      setBusy(false);
      if (ok && showDone) setDone(true);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={disabled}
        aria-busy={busy}
        data-done={done || undefined}
        aria-label={label}
        title={disabled ? reason : undefined}
        aria-describedby={disabled && reason ? reasonId : undefined}
        className={`${buttonClass(variant, size)} ${className}`}
      >
        {children}
      </button>
      {disabled && reason && <span id={reasonId} className="sr-only">{reason}</span>}
      <span className="sr-only" aria-live="polite">{busy ? "يُنفَّذ" : done ? "تمّ" : ""}</span>
    </>
  );
}

/* ─────────────────────────── انتظارُ الرابط ─────────────────────────── */

/**
 * دوّارةٌ صغيرة داخل رابطٍ ينتظر الخادم — لسانٌ أو زرُّ انتقال.
 *
 * الانتقالُ إلى صفحةٍ ديناميكيّة يستغرق ثانيةً أو أكثر، والرابطُ لا يقول إنّ
 * الضغطة وصلت. وتظهر بعد ١٢٠ مللي ثانية لا فوراً (`globals.css`): الانتقالُ
 * السريع لا يومض فيه شيء. توضع داخل `<Link>` وحده (`useLinkStatus`).
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className="link-pending" data-on={pending} />;
}

/* ─────────────────────────── القائمةُ المنبثقة ─────────────────────────── */

/**
 * قرارٌ صغير بجانب ما يخصّه — لا ورقةٌ تغطّي الصفحة من أجل سؤالٍ واحد.
 *
 * `popover="auto"` الأصليّ: يُغلَق بالنقر خارجه وبـEscape، ويقع في الطبقة
 * العليا فلا يقصّه `overflow` جدولٍ حوله. والموضعُ يُحسَب من الزرّ عند
 * الفتح وعند التمرير: تحته إن اتّسع ما تحته، وإلّا فوقه، ولا يخرج من الشاشة.
 */
export function Popover({
  button,
  buttonClassName,
  buttonLabel,
  children,
  width = "20rem",
}: {
  button: React.ReactNode;
  buttonClassName?: string;
  /** اسمٌ يُقرأ حين يكون الزرُّ رمزاً. */
  buttonLabel?: string;
  /** المحتوى، ومعه `close` لمن يُغلقه بعد فعل. */
  children: (close: () => void) => React.ReactNode;
  width?: string;
}) {
  const id = useId().replace(/:/g, "");
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const place = useCallback(() => {
    const b = btnRef.current;
    const p = popRef.current;
    if (!b || !p) return;
    const r = b.getBoundingClientRect();
    const pw = p.offsetWidth;
    const ph = p.offsetHeight;
    const gap = 6;
    const margin = 8;
    const rtl = getComputedStyle(b).direction === "rtl";
    /* يصطفّ على حافّة الزرّ التي يبدأ منها السطر */
    let left = rtl ? r.right - pw : r.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - pw - margin));
    const below = window.innerHeight - r.bottom;
    const down = below >= ph + gap + margin || below > r.top;
    const top = down ? r.bottom + gap : r.top - ph - gap;
    /* ينمو من حافّته القريبة من الزرّ */
    const originX = Math.min(pw, Math.max(0, r.left + r.width / 2 - left));
    p.style.setProperty("--pop-origin", `${Math.round(originX)}px ${down ? "0" : "100%"}`);
    p.style.left = `${Math.round(left)}px`;
    p.style.top = `${Math.round(Math.max(margin, top))}px`;
  }, []);

  useEffect(() => {
    const p = popRef.current;
    if (!p) return;
    function onToggle(e: Event) {
      const next = (e as ToggleEvent).newState === "open";
      setOpen(next);
      if (next) place();
      else btnRef.current?.focus({ preventScroll: true });
    }
    p.addEventListener("toggle", onToggle);
    return () => p.removeEventListener("toggle", onToggle);
  }, [place]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", place, { passive: true, capture: true });
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, { capture: true });
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  /* المحتوى يُرسَم بعد الفتح — فيُعاد الحسابُ بمقاسه الحقيقيّ قبل أن يُرى */
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  /* بالمعرّف لا بالمرجع — `close` تُمرَّر إلى المحتوى أثناء الرسم */
  const close = useCallback(() => document.getElementById(id)?.hidePopover(), [id]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        popoverTarget={id}
        aria-expanded={open}
        aria-label={buttonLabel}
        onClick={(e) => e.stopPropagation()}
        className={buttonClassName ?? buttonClass("secondary", "sm")}
      >
        {button}
      </button>
      <div
        ref={popRef}
        id={id}
        popover="auto"
        style={{ width: `min(${width}, calc(100vw - 1rem))` }}
        onClick={(e) => e.stopPropagation()}
        className="pop max-h-[min(70vh,32rem)] overflow-y-auto rounded-xl border border-line bg-overlay p-4 text-ink shadow-overlay"
      >
        {open && children(close)}
      </div>
    </>
  );
}

/* ─────────────────────────── البحث داخل الجدول ─────────────────────────── */

function fold(s: string): string {
  return normalizeArabic(normalizeDigits(s.toLowerCase())).replace(/[ّ,٬]/g, "");
}

/**
 * حقلُ بحثٍ يصفّي صفوفَ الجدول الذي فوقه — بلا رحلةٍ إلى الخادم.
 *
 * الصفوفُ مرسومةٌ في الخادم ومعها نصُّها في `data-filter`، وهذا يُخفي ما
 * لا يطابق. فالجدولُ يبقى مكوّنَ خادم، والبحثُ فوري.
 */
export function TableFilter({ label, total }: { label: string; total: number }) {
  const ref = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(total);

  useEffect(() => {
    const root = ref.current?.closest("[data-filter-root]");
    if (!root) return;
    const words = fold(q).split(/\s+/).filter(Boolean);
    function apply() {
      const rows = root!.querySelectorAll<HTMLElement>("[data-filter]");
      let visibleDesktop = 0;
      rows.forEach((el) => {
        const text = fold(el.dataset.filter ?? "");
        const hit = words.every((w) => text.includes(w));
        if (el.hidden === hit) el.hidden = !hit;
        if (hit && el.tagName === "TR") visibleDesktop++;
      });
      setShown(words.length === 0 ? total : visibleDesktop);
    }
    apply();
    /*
      بعد فعلٍ ثمّ `router.refresh()` تصل صفوفٌ جديدة أو مستبدَلة بلا `hidden` —
      وإن بقي عددُها كما كان لم يجرِ هذا الأثر، فظهر ما لا يطابق المكتوبَ والعدّادُ
      يقول غير ما يُرى. فيُعاد التطبيقُ كلّما تبدّلت صفوفُ الجدول (لا صفاتُها:
      كتابةُ `hidden` هنا لا توقظه).
    */
    let frame = 0;
    const observer = new MutationObserver((changes) => {
      if (!changes.some((m) => [...m.addedNodes].some((n) => n instanceof HTMLElement && (n.matches("[data-filter]") || n.querySelector("[data-filter]") !== null)))) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [q, total]);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <label className="relative flex min-w-0 flex-1 items-center sm:max-w-sm">
        <span className="sr-only">{label}</span>
        <Search className="pointer-events-none absolute start-3 h-4 w-4 text-muted" strokeWidth={2} aria-hidden />
        <input
          ref={ref}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }}
          placeholder={label}
          className="min-h-11 w-full rounded-lg border border-line-input bg-raised ps-9 pe-3 text-sm sm:min-h-9"
        />
      </label>
      {/* أعدادُ صفوفٍ لا مبالغ — `nums-count` يُبقيها ظاهرةً و«أخفِ المبالغ» مضغوط */}
      <p className="text-xs text-muted" aria-live="polite">
        {q ? (
          shown === 0 ? (
            /* الفراغُ يُقال بما يُخرج منه: رأسُ جدولٍ فوق لا شيء لا يقول ما العمل */
            <>
              لا صفّ يطابق «<bdi>{q}</bdi>» في المعروض.{" "}
              <button type="button" onClick={() => { setQ(""); ref.current?.focus(); }} className="min-h-8 font-bold text-accent hover:underline">
                امسح البحث
              </button>
            </>
          ) : <><span className="nums nums-count">{shown}</span> من <span className="nums nums-count">{total}</span></>
        ) : (
          <><span className="nums nums-count">{total}</span> صفّاً</>
        )}
      </p>
    </div>
  );
}

/* ─────────────────────────── ترتيبُ الجدول ─────────────────────────── */

function sortHref(pathname: string, params: URLSearchParams, param: string, value: string | null): string {
  const q = new URLSearchParams(params);
  if (value) q.set(param, value);
  else q.delete(param);
  const s = q.toString();
  return s ? `${pathname}?${s}` : pathname;
}

/**
 * رأسُ عمودٍ يرتّب — يكتب `?sort=key.desc` في العنوان ويُبقي ما فيه من تصفية.
 * ثلاثُ ضغطات: الاتّجاهُ الطبيعيّ، ثمّ عكسُه، ثمّ ترتيبُ الخادم. والسهمُ يقول
 * الحال، و`aria-sort` على الخليّة يقولها لقارئ الشاشة.
 */
export function SortHeader({
  param,
  sortKey,
  first,
  children,
}: {
  param: string;
  sortKey: string;
  first: SortDir;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = parseSort(params.get(param), [sortKey]);
  const next = nextSort(current, sortKey, first);
  const Icon = current?.dir === "asc" ? ArrowUp : current?.dir === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <Link
      href={sortHref(pathname, params, param, formatSort(next))}
      scroll={false}
      replace
      data-tip={next ? (next.dir === "desc" ? "رتّب تنازليّاً" : "رتّب تصاعديّاً") : "أعِد الترتيبَ الأصليّ"}
      className={`-mx-1.5 inline-flex min-h-7 items-center gap-1 rounded-md px-1.5 transition-colors hover:bg-hover hover:text-ink ${current ? "text-ink" : ""}`}
    >
      {children}
      <Icon className={`h-3 w-3 shrink-0 ${current ? "text-accent" : "opacity-60"}`} strokeWidth={2.25} aria-hidden />
      <LinkPending />
    </Link>
  );
}

/** الترتيبُ على الجوّال — البطاقاتُ بلا رؤوس أعمدة، فقائمةٌ واحدة فوقها. */
export function SortSelect({
  param,
  options,
}: {
  param: string;
  options: readonly { key: string; label: string; first: SortDir }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const id = useId();
  const current = parseSort(params.get(param), options.map((o) => o.key));
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-xs text-muted">
      <span className="shrink-0 font-bold">رتّب حسب</span>
      <select
        id={id}
        value={formatSort(current) ?? ""}
        onChange={(e) => router.replace(sortHref(pathname, params, param, e.target.value || null), { scroll: false })}
        className={`${fieldClass("sm")} max-w-56`}
      >
        <option value="">الترتيب الأصليّ</option>
        {options.flatMap((o) => {
          const second: SortDir = o.first === "desc" ? "asc" : "desc";
          const word = (d: SortDir) => (d === "asc" ? "تصاعديّاً" : "تنازليّاً");
          return [o.first, second].map((d) => (
            <option key={`${o.key}.${d}`} value={`${o.key}.${d}`}>{o.label} — {word(d)}</option>
          ));
        })}
      </select>
    </label>
  );
}

/* ─────────────────────────── الحقول ─────────────────────────── */

/**
 * حقلٌ بتسميته وتلميحه وخطئه — والربطُ (`htmlFor` · `aria-describedby` ·
 * `aria-invalid`) يُكتب هنا مرّةً لا في كلّ نموذج.
 *
 * `children` دالّةٌ تأخذ ما يُنشَر على عنصر الإدخال، فيصلح لـ`Input` و`Select`
 * و`MoneyInput` ولأيّ ضابطٍ آخر:
 *
 *   <Field label="المبلغ" error={err}>{(p) => <MoneyInput {...p} value={v} onChange={setV} />}</Field>
 */
export function Field({
  label,
  hint,
  error,
  required,
  className = "",
  children,
}: {
  label: React.ReactNode;
  /** سطرٌ هادئ تحت الحقل — يُخفى حين يُعرَض خطأ. */
  hint?: React.ReactNode;
  /** رسالةُ الخطأ — وجودُها يجعل الحقل `aria-invalid`. */
  error?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: (control: { id: string; "aria-describedby"?: string; "aria-invalid"?: true; required?: true; invalid: boolean }) => React.ReactNode;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const invalid = error !== undefined && error !== null && error !== false && error !== "";
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={id} className="block text-xs font-bold text-ink-soft">
        {label}
        {required && <span className="ms-1 text-danger" aria-hidden>*</span>}
      </label>
      <div className="mt-1.5">
        {children({
          id,
          "aria-describedby": invalid || hint ? noteId : undefined,
          "aria-invalid": invalid ? true : undefined,
          required: required ? true : undefined,
          invalid,
        })}
      </div>
      {invalid ? (
        <p id={noteId} role="alert" className="mt-1 flex items-start gap-1 text-[11px] font-bold leading-relaxed text-danger">
          <CircleAlert className="mt-px h-3 w-3 shrink-0" strokeWidth={2.25} aria-hidden />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={noteId} className="mt-1 text-[11px] leading-relaxed text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

type ControlExtras = { invalid?: boolean; fieldSize?: "sm" | "md" };

/*
  اسمُ الحقل يصله من `Field` (`id` ↔ `htmlFor`) — أو `aria-label` ممّن استعمله
  وحده. فلا يُكتب حقلٌ بهذه العناصر بلا أحدهما.
*/
export function Input({ id, invalid, fieldSize, className = "", ...rest }: React.ComponentProps<"input"> & ControlExtras) {
  return <input id={id} {...rest} className={`${fieldClass(fieldSize, invalid)} ${className}`} />;
}

export function Select({ id, invalid, fieldSize, className = "", children, ...rest }: React.ComponentProps<"select"> & ControlExtras) {
  return <select id={id} {...rest} className={`${fieldClass(fieldSize, invalid)} ${className}`}>{children}</select>;
}

/**
 * حقلُ مبلغ — يفتح لوحةَ الأرقام على الجوّال، ويُكتب من اليسار بخطّ الأرقام.
 * والقيمةُ **نصّ** كما كُتبت: الطلبُ يحملها نصّاً والخادمُ يحوّلها إلى هللات
 * (`src/lib/money.ts`) — لا عددَ عائماً في الطريق.
 */
export function MoneyInput({
  id,
  value,
  onChange,
  invalid,
  fieldSize,
  className = "",
  ...rest
}: Omit<React.ComponentProps<"input">, "value" | "onChange" | "type" | "inputMode"> & ControlExtras & {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      id={id}
      {...rest}
      type="text"
      inputMode="decimal"
      dir="ltr"
      autoComplete="off"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`nums text-end ${fieldClass(fieldSize, invalid)} ${className}`}
    />
  );
}

/* ─────────────────────────── الإشعارات ─────────────────────────── */

type ToastTone = "ok" | "warn" | "danger" | "info";

export interface ToastInput {
  title: string;
  body?: string;
  tone?: ToastTone;
  /**
   * التراجعُ حيث يسمح المجال به وحده — ولا يُعرض لفعلٍ ماليٍّ لا يُنقَض.
   * يُرجع `false` إن فشل التراجع.
   */
  undo?: { label?: string; run: () => Promise<boolean | void> | boolean | void };
  /** موضعُ الإصلاح — إشعارٌ يقول «توقّف كذا» يفتح حيث يُصلَح، لا يقف عند الخبر. */
  link?: { label: string; href: string };
  /** بالمللي ثانية — والإشعارُ بتراجعٍ يبقى أطول كي يُلحَق. */
  duration?: number;
}

const TOAST_EVENT = "tph:toast";

/** يُطلق إشعاراً من أيّ مكوّن — والعارضُ واحدٌ في القشرة. */
export function toast(input: ToastInput) {
  window.dispatchEvent(new CustomEvent<ToastInput>(TOAST_EVENT, { detail: input }));
}

type LiveToast = ToastInput & {
  id: number;
  state: "idle" | "undoing" | "undone" | "undo-failed";
  leaving?: boolean;
};

const TOAST_ICON = { ok: CircleCheck, warn: TriangleAlert, danger: CircleAlert, info: Info } as const;
const TOAST_TONE = { ok: "text-ok", warn: "text-warn", danger: "text-danger", info: "text-info" } as const;
/** مدّةُ خروج الإشعار — `--dur-2` في `globals.css`. */
const TOAST_EXIT_MS = 160;

/**
 * الإشعارات — تدخل وتخرج بحركة، ويقف عدُّها ما دامت الفأرةُ أو التركيزُ
 * عليها: من يقرأ إشعاراً بتراجعٍ لا يُسحب منه وهو يقرؤه.
 */
export function Toaster() {
  const [items, setItems] = useState<LiveToast[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, { handle: number; due: number; left: number }>());
  const paused = useRef(false);

  const remove = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) window.clearTimeout(t.handle);
    timers.current.delete(id);
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), TOAST_EXIT_MS);
  }, []);

  const arm = useCallback((id: number, ms: number) => {
    const prev = timers.current.get(id);
    if (prev) window.clearTimeout(prev.handle);
    if (paused.current) {
      timers.current.set(id, { handle: 0, due: 0, left: ms });
      return;
    }
    timers.current.set(id, { handle: window.setTimeout(() => remove(id), ms), due: Date.now() + ms, left: ms });
  }, [remove]);

  useEffect(() => {
    function onToast(e: Event) {
      const detail = (e as CustomEvent<ToastInput>).detail;
      if (!detail) return;
      const id = ++seq.current;
      setItems((xs) => {
        /* ثلاثةٌ على الأكثر — والأقدمُ يخرج بحركته */
        const live = xs.filter((x) => !x.leaving);
        if (live.length >= 3) window.setTimeout(() => remove(live[0].id), 0);
        return [...xs, { ...detail, id, state: "idle" }];
      });
      arm(id, detail.duration ?? (detail.undo ? 8000 : 4500));
    }
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, [arm, remove]);

  function pause() {
    if (paused.current) return;
    paused.current = true;
    for (const [id, t] of timers.current) {
      window.clearTimeout(t.handle);
      timers.current.set(id, { handle: 0, due: 0, left: t.due ? Math.max(1200, t.due - Date.now()) : t.left });
    }
  }
  function resume() {
    if (!paused.current) return;
    paused.current = false;
    for (const [id, t] of timers.current) arm(id, Math.max(1800, t.left));
  }

  const runUndo = useCallback(async (t: LiveToast) => {
    if (!t.undo || t.state !== "idle") return;
    setItems((xs) => xs.map((x) => (x.id === t.id ? { ...x, state: "undoing" } : x)));
    let ok = true;
    try {
      ok = (await t.undo.run()) !== false;
    } catch {
      ok = false;
    }
    setItems((xs) => xs.map((x) => (x.id === t.id ? { ...x, state: ok ? "undone" : "undo-failed" } : x)));
    arm(t.id, 3000);
  }, [arm]);

  /*
    ⌘Z / Ctrl+Z يتراجع عن أحدث إشعارٍ حيٍّ يقبل التراجع — من يعمل بالمفاتيح
    (J/K ثمّ فعل) لا يطارد زرّاً في زاوية الشاشة قبل أن تنتهي مهلتُه. وفي حقلٍ
    يُكتب فيه يبقى ⌘Z للكتابة.
  */
  const live = useRef<LiveToast[]>([]);
  useEffect(() => { live.current = items; }, [items]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || shortcutKey(e) !== "z") return;
      const el = e.target;
      if (el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const t = [...live.current].reverse().find((x) => x.undo && x.state === "idle" && !x.leaving);
      if (!t) return;
      e.preventDefault();
      void runUndo(t);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runUndo]);

  return (
    /* بلا `aria-live` هنا: كلُّ إشعارٍ منطقةٌ حيّة بدوره (`status` · `alert`)، والاثنان معاً يُقرآن مرّتين */
    <div
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      className="no-print pointer-events-none fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-6 sm:end-6 sm:items-end lg:bottom-6"
    >
      {items.map((t) => {
        const tone = t.state === "undo-failed" ? "danger" : t.state === "undone" ? "info" : t.tone ?? "ok";
        const Icon = t.state === "undone" ? Undo2 : TOAST_ICON[tone];
        return (
          <div
            key={t.id}
            role={tone === "danger" ? "alert" : "status"}
            data-leaving={t.leaving || undefined}
            className="toast pointer-events-auto flex w-full max-w-sm animate-rise items-start gap-3 rounded-xl border border-line bg-overlay px-4 py-3 text-ink shadow-overlay"
          >
            <Icon className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${TOAST_TONE[tone]}`} strokeWidth={2} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold leading-snug">
                {t.state === "undone" ? "تمّ التراجع." : t.state === "undo-failed" ? "تعذّر التراجع — لم يتغيّر شيء." : t.title}
              </p>
              {t.body && t.state === "idle" && <p className="mt-0.5 text-xs leading-relaxed text-muted">{t.body}</p>}
            </div>
            {t.undo && (t.state === "idle" || t.state === "undoing") && (
              <button
                type="button"
                aria-busy={t.state === "undoing"}
                onClick={() => runUndo(t)}
                className={`${buttonClass("subtle", "sm")} -my-1`}
              >
                <Undo2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                <span>{t.undo.label ?? "تراجع"}</span>
              </button>
            )}
            {t.link && t.state === "idle" && (
              <Link href={t.link.href} onClick={() => remove(t.id)} className={`${buttonClass("subtle", "sm")} -my-1`}>
                {t.link.label}
              </Link>
            )}
            <button
              type="button"
              onClick={() => remove(t.id)}
              aria-label="أغلق الإشعار"
              className="-me-1 -mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink"
            >
              <X className="h-4 w-4" strokeWidth={2} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── الحوار والورقة ─────────────────────────── */

/**
 * سحبُ الورقة إلى الأسفل لإغلاقها — على الجوّال وحده.
 *
 * يُكتب الإزاحةُ في `--drag` فيتبع الإصبعَ بلا رسمٍ من React، ويُغلَق إن
 * جاوز ربعَ الارتفاع أو قُذف بسرعة. وما دون ذلك يعود بنابضه إلى موضعه.
 */
export function useDragToDismiss<T extends HTMLElement>(onDismiss: () => void) {
  const ref = useRef<T>(null);
  const start = useRef<{ y: number; t: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    start.current = { y: e.clientY, t: performance.now() };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    ref.current?.setAttribute("data-dragging", "");
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!start.current || !ref.current) return;
    const dy = Math.max(0, e.clientY - start.current.y);
    ref.current.style.setProperty("--drag", `${dy}px`);
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const el = ref.current;
    const s = start.current;
    start.current = null;
    if (!el || !s) return;
    el.removeAttribute("data-dragging");
    const dy = Math.max(0, e.clientY - s.y);
    const v = dy / Math.max(1, performance.now() - s.t);
    if (dy > el.offsetHeight * 0.25 || v > 0.6) {
      onDismiss();
      /* يخرج من حيث تركه الإصبع، ثمّ يُصفَّر للفتح القادم */
      window.setTimeout(() => el.style.removeProperty("--drag"), 400);
    } else {
      el.style.removeProperty("--drag");
    }
  }, [onDismiss]);

  return { ref, handle: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } };
}

/**
 * حوارٌ أصليّ (`<dialog>`) — يحبس التركيز ويُغلَق بـEscape ويعيد التركيز
 * إلى ما فتحه. على الحاسوب لوحٌ في الوسط، وعلى الجوّال ورقةٌ من الأسفل
 * تُسحب لتُغلق. ويدخل ويخرج بحركة (`globals.css` · `.sheet`).
 *
 * للعمل متعدّد الخطوات وحده؛ والقرارُ الصغير `Popover`، والتفصيلُ لوحُ الفحص.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const { ref, handle } = useDragToDismiss<HTMLDialogElement>(onClose);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open, ref]);

  const width = size === "lg" ? "sm:w-[min(52rem,calc(100vw-3rem))]" : size === "sm" ? "sm:w-[min(26rem,calc(100vw-3rem))]" : "sm:w-[min(36rem,calc(100vw-3rem))]";

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={`sheet m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-clip rounded-t-2xl border border-line bg-overlay p-0 text-ink shadow-overlay sm:m-auto sm:rounded-2xl ${width}`}
    >
      <div className="flex max-h-[92dvh] flex-col">
        <div className="grabber" aria-hidden {...handle} />
        <div className="flex touch-none items-start gap-3 border-b border-line px-5 pb-3.5 pt-3 sm:touch-auto sm:pt-4" {...handle}>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-bold">{title}</h2>
            {description && <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="أغلق"
            className="-me-2 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-ink sm:h-9 sm:w-9"
          >
            <X className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-sunken/50 px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </dialog>
  );
}
