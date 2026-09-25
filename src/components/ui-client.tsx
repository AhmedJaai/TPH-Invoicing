"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Info, Search, TriangleAlert, Undo2, X } from "lucide-react";
import { buttonClass, type ButtonVariant } from "./ui-tokens";
import { normalizeArabic, normalizeDigits } from "@/lib/search";

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

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={`${buttonClass(variant, size)} ${block ? "w-full" : ""}`}
      >
        {label}
      </button>
    );
  }

  return (
    <div className={`animate-rise rounded-xl border p-4 ${skin.box}`}>
      <p className={`flex items-center gap-2 text-sm font-bold ${skin.title}`}>
        <skin.Icon className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
        {title}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{consequence}</p>

      <label className="mt-3 flex min-h-11 items-start gap-2.5 text-xs leading-relaxed sm:min-h-0">
        <input
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
          disabled={!understood || busy}
          onClick={async () => {
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
          {busy ? "يُنفَّذ…" : confirmLabel}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setUnderstood(false); }}
          className={buttonClass("quiet", "sm")}
        >
          تراجع
        </button>
      </div>
    </div>
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
    const rows = root.querySelectorAll<HTMLElement>("[data-filter]");
    let visibleDesktop = 0;
    rows.forEach((el) => {
      const text = fold(el.dataset.filter ?? "");
      const hit = words.every((w) => text.includes(w));
      el.hidden = !hit;
      if (hit && el.tagName === "TR") visibleDesktop++;
    });
    setShown(words.length === 0 ? total : visibleDesktop);
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
      <p className="text-xs text-muted" aria-live="polite">
        {q ? (
          shown === 0 ? "لا صفّ يطابق." : <><span className="nums">{shown}</span> من <span className="nums">{total}</span></>
        ) : (
          <><span className="nums">{total}</span> صفّاً</>
        )}
      </p>
    </div>
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

type LiveToast = ToastInput & { id: number; state: "idle" | "undoing" | "undone" | "undo-failed" };

const TOAST_ICON = { ok: CircleCheck, warn: TriangleAlert, danger: CircleAlert, info: Info } as const;
const TOAST_TONE = { ok: "text-ok", warn: "text-warn", danger: "text-danger", info: "text-info" } as const;

export function Toaster() {
  const [items, setItems] = useState<LiveToast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  useEffect(() => {
    function onToast(e: Event) {
      const detail = (e as CustomEvent<ToastInput>).detail;
      if (!detail) return;
      const id = ++seq.current;
      setItems((xs) => [...xs.slice(-2), { ...detail, id, state: "idle" }]);
      const ms = detail.duration ?? (detail.undo ? 8000 : 4500);
      window.setTimeout(() => dismiss(id), ms);
    }
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, [dismiss]);

  async function runUndo(t: LiveToast) {
    if (!t.undo) return;
    setItems((xs) => xs.map((x) => (x.id === t.id ? { ...x, state: "undoing" } : x)));
    let ok = true;
    try {
      ok = (await t.undo.run()) !== false;
    } catch {
      ok = false;
    }
    setItems((xs) => xs.map((x) => (x.id === t.id ? { ...x, state: ok ? "undone" : "undo-failed" } : x)));
    window.setTimeout(() => dismiss(t.id), 3000);
  }

  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      className="no-print pointer-events-none fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-6 sm:end-6 sm:items-end lg:bottom-6"
    >
      {items.map((t) => {
        const tone = t.tone ?? "ok";
        const Icon = TOAST_ICON[tone];
        return (
          <div
            key={t.id}
            role={tone === "danger" ? "alert" : "status"}
            className="pointer-events-auto flex w-full max-w-sm animate-rise items-start gap-3 rounded-xl border border-line bg-overlay px-4 py-3 text-ink shadow-overlay"
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
                disabled={t.state === "undoing"}
                onClick={() => runUndo(t)}
                className={`${buttonClass("subtle", "sm")} -my-1`}
              >
                <Undo2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                {t.state === "undoing" ? "يتراجع…" : t.undo.label ?? "تراجع"}
              </button>
            )}
            {t.link && t.state === "idle" && (
              <Link href={t.link.href} onClick={() => dismiss(t.id)} className={`${buttonClass("subtle", "sm")} -my-1`}>
                {t.link.label}
              </Link>
            )}
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="أغلق الإشعار"
              className="-me-1 -mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink"
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
 * حوارٌ أصليّ (`<dialog>`) — يحبس التركيز ويُغلَق بـEscape ويعيد التركيز
 * إلى ما فتحه. على الحاسوب لوحٌ في الوسط، وعلى الجوّال ورقةٌ من الأسفل.
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
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const width = size === "lg" ? "sm:w-[min(52rem,calc(100vw-3rem))]" : size === "sm" ? "sm:w-[min(26rem,calc(100vw-3rem))]" : "sm:w-[min(36rem,calc(100vw-3rem))]";

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={`sheet m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-2xl border border-line bg-overlay p-0 text-ink shadow-overlay sm:m-auto sm:rounded-2xl ${width}`}
    >
      <div className="flex max-h-[92dvh] flex-col">
        <div className="flex items-start gap-3 border-b border-line px-5 pb-3.5 pt-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-bold">{title}</h2>
            {description && <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="أغلق"
            className="-me-2 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink sm:h-9 sm:w-9"
          >
            <X className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-sunken/50 px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </dialog>
  );
}
