"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { isInspectorPath, pathOf } from "@/lib/inspector";
import { useDragToDismiss } from "./ui-client";

/**
 * لوحُ الفحص — ملفُّ السجلّ فوق القائمة، لا بدلاً منها.
 *
 * كان فتحُ مورّدٍ أو فاتورةٍ من قائمةٍ ينقل الصفحةَ كلَّها: ثانيتان إلى
 * ثلاث، ثمّ الرجوعُ يعيد بناء القائمة من أوّلها ويُضيع تمريرها وتصفيتها.
 * فصار الملفُّ لوحاً من الحافّة المقابلة للشريط (اليسار في العربية)،
 * والقائمةُ تحته كما تُركت، والصفُّ المفتوح معلَّمٌ فيها.
 *
 * - **العنوان هو الحال:** اللوحُ مسارٌ معترِض (`(app)/@drawer`)، فالرجوعُ
 *   يغلقه والتقدّمُ يعيده والرابطُ يُشارَك. ومن حمّل الرابطَ مباشرةً رأى
 *   الصفحةَ كاملة.
 * - **لا يكدّس:** النقرُ على صفٍّ آخر واللوحُ مفتوح يستبدل محتواه ولا
 *   يضيف خطوةً إلى السجلّ — فالرجوعُ مرّةً يعود إلى القائمة، لا إلى عشرة
 *   ملفّاتٍ فُتحت قبله.
 * - **يدخل ويخرج بحركة:** والانتقالُ من ملفٍّ إلى ملفّ تلاشٍ لا دخولٌ جديد.
 *   والخروجُ إلى صفحةٍ أخرى ينتظر حركتَه (٢٢٠ مللي ثانية) ثمّ ينتقل.
 * - **التركيز:** يدخل إلى عنوان اللوح، ويعود عند الإغلاق إلى ما فتحه.
 *   وEscape يغلقه ما لم يكن فوقه حوارٌ أو قائمة.
 * - **على الجوّال:** ورقةٌ من الأسفل تُسحب لتُغلق، وما تحتها خامل.
 */

/** ما نُقر ليُفتح اللوح — يُحفظ قبل أن يأخذ الهيكلُ التركيز. */
let primedOpener: Element | null = null;

/** متى أُغلق آخرُ لوح — لوحٌ يُفتح بعده مباشرةً استبدالٌ لا دخول. */
let lastUnmountAt = 0;
/** الهيكلُ الفوريّ دخل بحركته — فاللوحُ الذي يخلفه لا يدخل ثانيةً. */
let primed = false;
const SWAP_WINDOW_MS = 500;
const EXIT_MS = 220;

const DESKTOP = "(min-width: 1024px)";

function sameOrigin(a: HTMLAnchorElement): boolean {
  return a.origin === window.location.origin;
}

export function InspectorPanel({
  title,
  eyebrow,
  intro,
  actions,
  fullHref,
  children,
  busy = false,
}: {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  intro?: React.ReactNode;
  actions?: React.ReactNode;
  /** رابطُ الصفحة الكاملة — يُحمَّل تحميلاً لا يُعترض. */
  fullHref?: string;
  children: React.ReactNode;
  /** هيكلُ التحميل — يُرسَم اللوحُ فوراً ويصل المحتوى بعده. */
  busy?: boolean;
}) {
  const router = useRouter();
  const titleId = useId();
  const [state, setState] = useState<"entering" | "open" | "closing">("entering");
  const [instant] = useState(() => primed || performance.now() - lastUnmountAt < SWAP_WINDOW_MS);
  const [desktop, setDesktop] = useState(() => typeof window === "undefined" || window.matchMedia(DESKTOP).matches);
  const opener = useRef<Element | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closing = useRef(false);

  const leave = useCallback(
    (then: () => void) => {
      if (closing.current) return;
      closing.current = true;
      setState("closing");
      window.setTimeout(then, EXIT_MS);
    },
    [],
  );

  const close = useCallback(() => leave(() => router.back()), [leave, router]);
  const { ref: panelRef, handle } = useDragToDismiss<HTMLElement>(close);

  /* ── الدخول ── */
  useLayoutEffect(() => {
    primed = false;
    opener.current = primedOpener ?? document.activeElement;
    primedOpener = null;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setState("open")));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!busy) headingRef.current?.focus({ preventScroll: true });
  }, [busy]);

  /* ── الخروج: التركيزُ يعود إلى ما فتحه ── */
  useEffect(() => {
    const back = opener.current;
    return () => {
      lastUnmountAt = performance.now();
      if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    };
  }, []);

  /* ── الصفُّ المفتوح معلَّمٌ في القائمة ── */
  useEffect(() => {
    const here = window.location.pathname;
    const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-href]")).filter(
      (el) => pathOf(el.dataset.href ?? "") === here,
    );
    rows.forEach((el) => el.setAttribute("data-inspected", "true"));
    document.documentElement.dataset.inspector = here;
    return () => {
      rows.forEach((el) => el.removeAttribute("data-inspected"));
      if (document.documentElement.dataset.inspector === here) delete document.documentElement.dataset.inspector;
    };
  }, []);

  /* ── على الجوّال: ورقةٌ مشروطة، وما تحتها خامل ولا يتمرّر ── */
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const sync = () => setDesktop(mq.matches);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (desktop) return;
    const content = document.getElementById("app-content");
    content?.setAttribute("inert", "");
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      content?.removeAttribute("inert");
      document.body.style.overflow = prev;
    };
  }, [desktop]);

  /* ── Escape ── */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("dialog[open], :popover-open")) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) {
        t.blur();
        return;
      }
      e.preventDefault();
      close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  /*
   * ── الروابط واللوحُ مفتوح ──
   * ملفٌّ آخر: يستبدل ولا يكدّس. وصفحةٌ أخرى: يخرج اللوحُ بحركته ثمّ ينتقل.
   * يُلتقط قبل `Link` (طورُ الالتقاط على الوثيقة)، و`preventDefault` يوقف
   * انتقاله هو فلا يقع مرّتين.
   */
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || !sameOrigin(a)) return;
      if (a.target && a.target !== "_self") return;
      if (a.hasAttribute("download") || a.dataset.fullPage !== undefined) return;
      const href = a.pathname + a.search + a.hash;
      if (a.pathname === window.location.pathname && a.search === window.location.search) return; // مرساةٌ في الملفّ نفسه
      if (href.startsWith("/api/")) return;
      e.preventDefault();
      if (isInspectorPath(href)) {
        router.replace(href, { scroll: false });
      } else {
        leave(() => router.push(href));
      }
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router, leave]);

  const data = state;

  return (
    <>
      {!desktop && (
        <div
          aria-hidden
          data-state={data === "open" ? "open" : "closed"}
          onClick={close}
          className="inspector-scrim fixed inset-0 z-40 bg-[rgb(14_13_11/0.42)]"
        />
      )}
      <section
        ref={panelRef}
        role="dialog"
        aria-modal={!desktop}
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        data-state={data}
        data-instant={instant || undefined}
        className="inspector no-print fixed inset-x-0 bottom-0 z-40 flex max-h-[92dvh] flex-col overflow-clip rounded-t-2xl border border-line bg-surface text-ink shadow-overlay lg:inset-y-0 lg:end-0 lg:start-auto lg:max-h-none lg:w-[min(46rem,calc(100vw-256px-3rem))] lg:rounded-none lg:border-y-0 lg:border-e-0"
      >
        <div className="grabber lg:hidden" aria-hidden {...handle} />
        <header
          {...handle}
          className="flex touch-none items-start gap-3 border-b border-line bg-raised px-4 pb-3.5 pt-2 sm:px-6 lg:touch-auto lg:pt-5"
        >
          <div className="min-w-0 flex-1">
            {eyebrow && <div className="mb-1 text-xs font-medium text-muted">{eyebrow}</div>}
            <h2
              id={titleId}
              ref={headingRef}
              tabIndex={-1}
              dir="auto"
              className="text-lg font-extrabold leading-snug tracking-tight outline-none sm:text-xl"
            >
              {title}
            </h2>
            {intro && <p className="mt-1 text-xs leading-relaxed text-ink-soft">{intro}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
            {fullHref && <a
              href={fullHref}
              data-full-page=""
              aria-label="افتح الصفحة كاملة"
              data-tip="افتح الصفحة كاملة"
              className="grid h-11 w-11 place-items-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-ink sm:h-9 sm:w-9"
            >
              <Maximize2 className="h-4 w-4" strokeWidth={2} aria-hidden />
            </a>}
            <button
              type="button"
              onClick={close}
              aria-label="أغلق اللوح"
              data-tip="أغلق (Esc)"
              className="grid h-11 w-11 place-items-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-ink sm:h-9 sm:w-9"
            >
              <X className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
            </button>
          </div>
        </header>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line-soft bg-raised px-4 py-2.5 sm:px-6">{actions}</div>
        )}
        <div className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-5 sm:px-6">
          {children}
        </div>
      </section>
    </>
  );
}

/** هيكلُ اللوح ريثما يُبنى ملفُّه — يُرسَم فوراً فيُرى أنّ الضغطة وصلت. */
export function InspectorSkeleton({ title }: { title: string }) {
  return (
    <InspectorPanel title={title} busy>
      <div className="space-y-4" aria-hidden>
        <div className="rounded-2xl border border-line bg-raised p-5">
          <div className="skeleton h-3.5 w-24" />
          <div className="skeleton mt-4 h-9 w-44" />
          <div className="skeleton mt-5 h-1.5 w-full" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 rounded-xl border border-line bg-raised px-4 py-3.5">
            <div className="skeleton h-8 w-8 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-3.5 w-2/5" />
              <div className="skeleton h-3 w-3/5" />
            </div>
            <div className="skeleton h-4 w-16" />
          </div>
        ))}
      </div>
      <span className="sr-only">يُحمّل…</span>
    </InspectorPanel>
  );
}

/**
 * استجابةٌ في الإطار نفسه — قبل أن يردّ الخادم.
 *
 * النقرُ على ملفٍّ من قائمةٍ يرسم هيكلَ اللوح فوراً (بلا انتظار الخادم ولا
 * `loading.tsx`)، ثمّ يخلفه اللوحُ الحقيقيّ في مكانه بلا دخولٍ ثانٍ. كان
 * الأوّلُ يظهر بعد ثانيةٍ أو أكثر، والضغطةُ لا تقول إنّها وصلت.
 * ولا يفعل الهيكلُ شيئاً: لا يغلق ولا يعترض — يُرى فقط.
 */
export function InspectorLauncher() {
  const [pending, setPending] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (document.documentElement.dataset.inspector) return; // لوحٌ مفتوح يستبدل بنفسه
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || !sameOrigin(a) || (a.target && a.target !== "_self")) return;
      if (a.dataset.fullPage !== undefined || !isInspectorPath(a.pathname)) return;
      if (a.pathname === window.location.pathname) return; // الملفُّ نفسُه مفتوحٌ صفحةً
      primedOpener = document.activeElement;
      primed = true;
      setPending(a.pathname);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  /* الانتقالُ وقع — واللوحُ الحقيقيّ (أو هيكلُه) في مكانه الآن، فيُطوى هذا */
  const pathname = usePathname();
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    setPending(null);
  }

  useEffect(() => {
    if (!pending) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    /* انتقالٌ لم يقع قطّ (أُلغي، أو فشل قبل أن يبدأ) لا يترك هيكلاً معلَّقاً */
    const giveUp = window.setTimeout(() => { primed = false; setPending(null); }, 12000);
    return () => {
      cancelAnimationFrame(id);
      window.clearTimeout(giveUp);
      setShown(false);
    };
  }, [pending]);

  if (!pending) return null;
  return (
    <section
      aria-hidden
      data-state={shown ? "open" : "entering"}
      className="inspector no-print pointer-events-none fixed inset-x-0 bottom-0 z-40 flex h-[92dvh] flex-col overflow-clip rounded-t-2xl border border-line bg-surface shadow-overlay lg:inset-y-0 lg:end-0 lg:start-auto lg:h-auto lg:w-[min(46rem,calc(100vw-256px-3rem))] lg:rounded-none lg:border-y-0 lg:border-e-0"
    >
      <div className="grabber lg:hidden" />
      <div className="border-b border-line bg-raised px-4 pb-4 pt-2 sm:px-6 lg:pt-5">
        <div className="skeleton h-3 w-24" />
        <div className="skeleton mt-2.5 h-6 w-56" />
        <div className="skeleton mt-2.5 h-3 w-40" />
      </div>
      <div className="space-y-4 px-4 pt-5 sm:px-6">
        <div className="rounded-2xl border border-line bg-raised p-5">
          <div className="skeleton h-3.5 w-24" />
          <div className="skeleton mt-4 h-9 w-44" />
          <div className="skeleton mt-5 h-1.5 w-full" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 rounded-xl border border-line bg-raised px-4 py-3.5">
            <div className="skeleton h-8 w-8 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-3.5 w-2/5" />
              <div className="skeleton h-3 w-3/5" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
