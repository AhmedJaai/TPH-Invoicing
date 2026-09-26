"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, use, useRef, useState } from "react";
import { Camera, Ellipsis, Plus, Search, Upload } from "lucide-react";
import { can, type Role } from "@/lib/permissions";
import {
  activeArea,
  activeChild,
  entryHref,
  groupedAreas,
  homeHref,
  mobileTabs,
  visibleAccountLinks,
  visibleChildren,
  type NavArea,
} from "@/lib/nav";
import { queueCapture } from "@/lib/capture-queue";
import { BrandMark, NavGlyph } from "./icons";
import { openCommandPalette } from "@/lib/ui-events";
import { Sheet, toast } from "./ui-client";

/**
 * التنقّل حول عمل صاحب المقهى لا حول جداول القاعدة.
 *
 * على الحاسوب: إطارٌ جانبيٌّ داكن بلون العلامة — ثابتٌ لا يقفز، والمجموعاتُ
 * (اليوم · المال · التشغيل) عناوينُ ترتّب المداخل، وبجانب كلّ مدخلٍ عددُه
 * واختصارُه. وعلى الجوّال: شريطٌ سفليّ يبلغه الإبهام، وفي وسطه زرُّ
 * الالتقاط — أكثرُ فعلٍ يتكرّر في النظام.
 *
 * البنيةُ في `lib/nav.ts` مختبَرة، وهذا رسمُها.
 */

/** عدّادا القشرة — `null` حين تعذّر العدّ فيُكتب «؟» لا صفرٌ يقول «لا شيء ينتظرك». */
export type ShellCounts = { pending: number | null; documents: number | null };

export function Sidebar({
  role,
  counts,
  footer,
}: {
  role: Role;
  counts?: Promise<ShellCounts>;
  /** المستخدمُ وضوابطُ العرض — مكوّناتُ خادمٍ تُمرَّر ولا تُستورَد هنا. */
  footer?: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const groups = groupedAreas(role);
  const area = activeArea(pathname);

  return (
    <nav className="flex h-full flex-col" aria-label="التنقّل الرئيسيّ">
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
        <Link href={homeHref(role)} className="flex min-w-0 items-center gap-2.5 rounded-lg">
          <BrandMark className="h-8 w-auto text-frame-accent" />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-bold leading-tight tracking-tight text-frame-ink">ذا بوبليك هاوس</span>
            <span className="block truncate text-[11px] text-frame-muted">المال والتشغيل</span>
          </span>
        </Link>
      </div>

      <div className="space-y-2 px-3 pb-4">
        <button
          type="button"
          onClick={openCommandPalette}
          className="flex h-10 w-full items-center gap-2 rounded-lg border border-frame-line bg-frame-raised px-3 text-start text-[13px] text-frame-muted transition-colors hover:border-frame-muted/50 hover:text-frame-ink"
        >
          <Search className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          <span className="flex-1 truncate">ابحث أو انتقل…</span>
          <kbd dir="ltr" className="shrink-0 rounded border border-frame-line px-1.5 text-[10px] leading-4">⌘K</kbd>
        </button>
        <CaptureButton role={role} variant="frame" />
      </div>

      <div className="frame-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {groups.map((g) => (
          <div key={g.group} className="mb-4">
            {g.label && (
              <p className="px-2.5 pb-1.5 text-[11px] font-bold tracking-wide text-frame-muted">{g.label}</p>
            )}
            <ul className="space-y-0.5">
              {g.areas.map((a) => {
                const current = area?.href === a.href;
                return (
                  <li key={a.href}>
                    <Link
                      href={entryHref(role, a)}
                      aria-current={current ? "page" : undefined}
                      className={`group relative flex h-10 items-center gap-3 rounded-lg px-2.5 text-[14px] transition-colors ${
                        current
                          ? "bg-frame-raised font-bold text-frame-ink"
                          : "text-frame-muted hover:bg-frame-raised/60 hover:text-frame-ink"
                      }`}
                    >
                      {current && <span aria-hidden className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-frame-accent" />}
                      <NavGlyph icon={a.icon} className={`h-[18px] w-[18px] shrink-0 ${current ? "text-frame-accent" : ""}`} />
                      <span className="min-w-0 flex-1 truncate">{a.label}</span>
                      <CountBadge counts={counts} href={a.href} className="rounded-full bg-frame-accent px-1.5 text-[11px] font-bold leading-5 text-frame" />
                      <kbd dir="ltr" aria-hidden className="hidden shrink-0 rounded border border-frame-line px-1 text-[10px] leading-4 text-frame-muted group-hover:inline-block">
                        G {a.chord.toUpperCase()}
                      </kbd>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-frame-line px-3 pb-3 pt-2">
        <ul className="space-y-0.5">
          {visibleAccountLinks(role).map((l) => {
            const on = pathname === l.href;
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={on ? "page" : undefined}
                  className={`flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13px] transition-colors ${
                    on ? "bg-frame-raised font-bold text-frame-ink" : "text-frame-muted hover:bg-frame-raised/60 hover:text-frame-ink"
                  }`}
                >
                  <NavGlyph icon={l.icon} className="h-4 w-4 shrink-0" />
                  <span className="truncate">{l.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        {footer && <div className="mt-2 border-t border-frame-line pt-3">{footer}</div>}
      </div>
    </nav>
  );
}

/**
 * ألسنةُ المساحة — تحت عنوان الصفحة على كلّ مقاس. واسمُ اللسان هو عنوانُ
 * الصفحة التي يفتحها.
 */
export function AreaTabs({ role }: { role: Role }) {
  const pathname = usePathname() ?? "/";
  const area = activeArea(pathname);
  if (!area) return null;
  const children = visibleChildren(role, area);
  if (children.length === 0) return null;
  const child = activeChild(pathname, area);

  return (
    <nav
      className="scroll-x -mb-px flex items-center gap-6 overflow-x-auto border-b border-line"
      aria-label={area.label}
    >
      {children.map((c) => {
        const on = child?.href === c.href;
        return (
          <Link
            key={c.href}
            href={c.href}
            aria-current={on ? "page" : undefined}
            className={`relative flex min-h-11 shrink-0 items-center text-[13px] transition-colors ${
              on ? "font-bold text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {c.label}
            {on && <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent" />}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * شريطُ الجوّال السفليّ: ثلاثُ مساحاتٍ وزرُّ الالتقاط في الوسط و«المزيد».
 *
 * يُركَّب في جذر الصفحة لا داخل ترويسة: `backdrop-blur` على الأب يُنشئ
 * إطاراً حاوياً يحبس `fixed` داخله فيظهر الشريطُ أعلى الشاشة.
 */
export function MobileTabBar({
  role,
  counts,
  footer,
}: {
  role: Role;
  counts?: Promise<ShellCounts>;
  footer?: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const [moreOpen, setMoreOpen] = useState(false);
  const area = activeArea(pathname);
  const { tabs, more } = mobileTabs(role, pathname);
  const canCapture = can(role, "document:upload");
  const left = tabs.slice(0, 2);
  const right = tabs.slice(2);

  /* الانتقالُ يغلق الورقة — يُضبط أثناء الرسم لا في أثر، فلا رسمٌ مزدوج */
  const [shownFor, setShownFor] = useState(pathname);
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setMoreOpen(false);
  }

  return (
    <>
      <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-raised/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
        <nav className="mx-auto flex max-w-lg items-stretch" aria-label="المساحات">
          {left.map((a) => (
            <Tab key={a.href} role={role} area={a} current={area?.href === a.href} counts={counts} />
          ))}
          {canCapture && (
            <div className="flex flex-1 items-start justify-center">
              <CaptureButton role={role} variant="fab" />
            </div>
          )}
          {right.map((a) => (
            <Tab key={a.href} role={role} area={a} current={area?.href === a.href} counts={counts} />
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] transition-colors ${moreOpen ? "text-accent" : "text-muted"}`}
          >
            <Ellipsis className="h-[22px] w-[22px]" strokeWidth={1.75} aria-hidden />
            المزيد
          </button>
        </nav>
      </div>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="كلّ المساحات">
        <ul className="grid grid-cols-3 gap-2">
          {[...tabs, ...more].map((a) => {
            const on = area?.href === a.href;
            return (
              <li key={a.href}>
                <Link
                  href={entryHref(role, a)}
                  onClick={() => setMoreOpen(false)}
                  aria-current={on ? "page" : undefined}
                  className={`flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border px-2 text-center text-xs font-bold ${
                    on ? "border-accent-line bg-accent-soft text-accent" : "border-line bg-raised text-ink"
                  }`}
                >
                  <NavGlyph icon={a.icon} className="h-5 w-5" />
                  {a.label}
                </Link>
              </li>
            );
          })}
        </ul>
        {visibleAccountLinks(role).length > 0 && (
          <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-raised">
            {visibleAccountLinks(role).map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={() => setMoreOpen(false)} className="flex min-h-12 items-center gap-3 px-4 text-sm">
                  <NavGlyph icon={l.icon} className="h-[18px] w-[18px] text-muted" />
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {footer && <div className="mt-4 rounded-xl border border-line bg-raised p-3">{footer}</div>}
      </Sheet>
    </>
  );
}

function Tab({ role, area, current, counts }: { role: Role; area: NavArea; current: boolean; counts?: Promise<ShellCounts> }) {
  return (
    <Link
      href={entryHref(role, area)}
      aria-current={current ? "page" : undefined}
      className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] transition-colors ${
        current ? "font-bold text-accent" : "text-muted"
      }`}
    >
      <span className="relative">
        <NavGlyph icon={area.icon} className="h-[22px] w-[22px]" />
        <CountBadge counts={counts} href={area.href} className="absolute -end-2.5 -top-1.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-4 text-accent-ink" />
      </span>
      {area.short}
    </Link>
  );
}

/** الشارةُ تنتظر عددها وحدها — فلا ينتظره رسمُ الصفحة. */
function CountBadge({ counts, href, className }: { counts?: Promise<ShellCounts>; href: string; className: string }) {
  if (!counts || (href !== "/attention" && href !== "/documents")) return null;
  return (
    <Suspense fallback={null}>
      <CountBadgeValue counts={counts} href={href} className={className} />
    </Suspense>
  );
}

function CountBadgeValue({ counts, href, className }: { counts: Promise<ShellCounts>; href: string; className: string }) {
  const c = use(counts);
  const n = href === "/attention" ? c.pending : c.documents;
  if (n === 0) return null;
  return (
    <span className={`nums ${className}`} aria-label={n === null ? "تعذّر العدّ" : `${n} بانتظارك`}>
      {n === null ? "؟" : n}
    </span>
  );
}

/**
 * زرُّ الالتقاط — أكثرُ فعلٍ يتكرّر في النظام.
 *
 * يفتح الكاميرا على الجوّال (ومنتقي الملفّات على الحاسوب) **من حيث أنت**،
 * ثمّ ينقل الملفّ إلى قارئ المستندات. كان زرّاً ينقلك إلى صفحة الرفع
 * لتضغط زرّاً ثانياً فيها.
 */
export function CaptureButton({ role, variant }: { role: Role; variant: "frame" | "fab" | "bar" }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  if (!can(role, "document:upload")) return null;

  function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const n = queueCapture(files);
    if (n === 0) {
      toast({ tone: "warn", title: "لا يُقرأ إلّا PDF أو صورة.", body: "اختر فاتورةً أو إيصالاً أو كشفاً بإحدى الصيغتين." });
      return;
    }
    router.push("/upload");
  }

  const input = (
    <input
      ref={ref}
      aria-label="اختر مستنداً أو صوّره"
      type="file"
      multiple
      accept="image/*,application/pdf,.pdf"
      capture={variant === "fab" ? "environment" : undefined}
      className="sr-only"
      tabIndex={-1}
      onChange={(e) => {
        onFiles(e.target.files);
        e.target.value = "";
      }}
    />
  );

  if (variant === "fab") {
    return (
      <>
        {input}
        <button
          type="button"
          onClick={() => ref.current?.click()}
          aria-label="صوّر مستنداً أو ارفعه"
          className="-mt-5 grid h-14 w-14 place-items-center rounded-2xl bg-accent text-accent-ink shadow-lifted ring-4 ring-surface transition-transform active:scale-95"
        >
          <Camera className="h-6 w-6" strokeWidth={2} aria-hidden />
        </button>
      </>
    );
  }

  if (variant === "bar") {
    return (
      <>
        {input}
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-bold text-accent-ink shadow-xs transition-colors hover:bg-accent-strong"
        >
          <Upload className="h-4 w-4" strokeWidth={2} aria-hidden />
          ارفع مستنداً
        </button>
      </>
    );
  }

  return (
    <>
      {input}
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-frame-accent text-[13px] font-bold text-frame transition-[filter] hover:brightness-110"
      >
        <Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden />
        ارفع مستنداً
        <kbd dir="ltr" className="rounded border border-frame/25 px-1 text-[10px] leading-4">U</kbd>
      </button>
    </>
  );
}

/** يفتح منتقي الالتقاط من اختصار لوحة المفاتيح — أوّلُ زرٍّ ظاهرٍ منه. */
export function triggerCapture() {
  const input = document.querySelector<HTMLInputElement>('input[type="file"][accept^="image/*"]');
  input?.click();
}
