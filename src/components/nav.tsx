"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { can, type Role } from "@/lib/permissions";
import {
  activeArea,
  activeChild,
  mobileTabs,
  visibleAccountLinks,
  visibleAreas,
  visibleChildren,
  type NavArea,
} from "@/lib/nav";

/**
 * التنقّل حول عمل صاحب المقهى لا حول جداول القاعدة.
 *
 * ── لماذا شريطٌ جانبيّ على الحاسوب ──
 *
 * كان التنقّل شريطاً علويّاً من صفّين: مساحاتٌ في صفّ وأقسامُها في صفّ
 * تحته. فيأكل نحو مئةٍ وعشرين بكسلاً رأسيّاً من كلّ صفحة — وهي أثمن ما
 * في شاشةٍ ارتفاعها تسعمئة — ويُحرّك الصفّ الثاني ظهوراً واختفاءً بحسب
 * المساحة، فيقفز المحتوى. والأسوأ أنّ موضع المستخدم من التطبيق يختفي
 * متى نزل قليلاً.
 *
 * والشريط الجانبيّ ثابتٌ لا يقفز، ويأخذ من العرض ما لا تحتاجه القراءة
 * (على ١٤٤٠ بكسلاً كان الوسطُ ١٢٨٠ والحافّتان فارغتين)، ويترك الارتفاع
 * كلَّه للجداول. وهو ما تفعله أدواتُ التشغيل الماليّة.
 *
 * وعلى الجوّال يبقى الشريط السفليّ: الإبهام يبلغ أسفل الشاشة، ولا يبلغ
 * أعلاها. البنية في `lib/nav.ts` مختبَرةً، وهذا رسمها.
 */

function Icon({ href, className }: { href: string; className?: string }) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (href) {
    case "/":
      return <svg {...common}><path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 9.5V21h13V9.5" /></svg>;
    case "/attention":
      return <svg {...common}><path d="M12 4 2.5 20h19L12 4Z" /><path d="M12 10v4" /><path d="M12 17.2v.1" /></svg>;
    case "/suppliers":
      return <svg {...common}><path d="M4 7h16l-1.2 12.5a1.5 1.5 0 0 1-1.5 1.5H6.7a1.5 1.5 0 0 1-1.5-1.5Z" /><path d="M8.5 7V5.5a3.5 3.5 0 0 1 7 0V7" /></svg>;
    case "/money":
      return <svg {...common}><rect x="2.5" y="5.5" width="19" height="13" rx="2" /><path d="M2.5 10h19" /></svg>;
    case "/documents":
      return <svg {...common}><path d="M6 2.5h8L19 7.5V21H6Z" /><path d="M13.5 2.5V8H19" /></svg>;
    case "/settings":
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" /></svg>;
    default:
      return <svg {...common}><circle cx="12" cy="12" r="8.5" /></svg>;
  }
}

function MoreIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

/**
 * الشريط الجانبيّ — الحاسوب وحده.
 *
 * والعدد الظاهر بجانب «يحتاج قرارك» هو عددُ بنود تلك الصفحة نفسها،
 * يُحسب مرّةً في القشرة ويُمرَّر. وكان العدّاد `countPendingWork()` —
 * وهو يقول صفراً على بيانات أحمد بينما تسعةُ بنودٍ تنتظره فعلاً،
 * لأنّه يعدّ حركاتِ البنك وحدها. **والعدد الذي يقول صفراً والعملُ
 * قائم أسوأ من لا عدّاد.**
 */
export function Sidebar({
  role,
  pending = 0,
  documents = 0,
}: {
  role: Role;
  pending?: number;
  documents?: number;
}) {
  const pathname = usePathname() ?? "/";
  const areas = visibleAreas(role);
  const area = activeArea(pathname);

  const badgeOf = (href: string) =>
    href === "/attention" ? pending : href === "/documents" ? documents : 0;

  return (
    <nav className="flex h-full flex-col gap-1 p-3" aria-label="المساحات">
      <Link
        href="/"
        className="mb-1 block truncate rounded-lg px-3 py-2 font-display text-base font-bold leading-tight tracking-tight"
      >
        ذا بوبليك هاوس
      </Link>

      <UploadButton role={role} pathname={pathname} className="mb-2 w-full" />

      <ul className="space-y-0.5">
        {areas.map((a) => {
          const current = area?.href === a.href;
          const n = badgeOf(a.href);
          return (
            <li key={a.href}>
              <Link
                href={a.href}
                aria-current={current ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  current
                    ? "bg-inverse-surface font-bold text-inverse-ink"
                    : "text-ink-soft hover:bg-sunken"
                }`}
              >
                <Icon href={a.href} className="h-[1.15rem] w-[1.15rem] shrink-0" />
                <span className="min-w-0 flex-1 truncate">{a.label}</span>
                {n > 0 && (
                  <span
                    className={`nums shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                      current ? "bg-inverse-ink/15 text-inverse-ink" : "bg-warn-bg text-warn"
                    }`}
                  >
                    {n}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto border-t border-line pt-2">
        <ul className="space-y-0.5">
          {visibleAccountLinks(role).map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={pathname.startsWith(l.href) ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs transition-colors ${
                  pathname === l.href ? "font-bold text-ink" : "text-muted hover:bg-sunken hover:text-ink-soft"
                }`}
              >
                <Icon href="/settings" className="h-4 w-4 shrink-0 opacity-70" />
                <span className="truncate">{l.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

/**
 * ألسنةُ المساحة — فوق محتواها لا في القشرة.
 *
 * موضعُها داخل الصفحة يجعلها تُقرأ تابعةً للعنوان الذي تحتها، لا صفّاً
 * ثانياً من تنقّلٍ عامّ.
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
      className="scroll-x -mb-px flex items-center gap-5 overflow-x-auto border-b border-line"
      aria-label={area.label}
    >
      {children.map((c) => (
        <Link
          key={c.href}
          href={c.href}
          aria-current={child?.href === c.href ? "page" : undefined}
          className={`flex min-h-11 shrink-0 items-center border-b-2 text-xs transition-colors sm:min-h-0 sm:pb-2.5 sm:pt-1 ${
            child?.href === c.href
              ? "border-ink font-bold text-ink"
              : "border-transparent text-muted hover:text-ink-soft"
          }`}
        >
          {c.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * شريط الجوّال السفليّ.
 *
 * يُركَّب في جذر الصفحة لا داخل الترويسة: الترويسة عليها `backdrop-blur`،
 * والمرشِّح يُنشئ إطاراً حاويًا يحبس `fixed` داخله — فكان الشريط يظهر
 * أعلى الشاشة لا أسفلها. لا يُدخل هذا المكوّن ترويسةً أبداً.
 */
export function MobileTabBar({
  role,
  pending = 0,
  documents = 0,
}: {
  role: Role;
  pending?: number;
  documents?: number;
}) {
  const pathname = usePathname() ?? "/";
  const [moreOpen, setMoreOpen] = useState(false);
  /* الدرج يُغلق بـEscape — من فتحه بلوحة المفاتيح لا يُحبَس فيه */
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMoreOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);
  const area = activeArea(pathname);
  const { tabs, more } = mobileTabs(role, pathname);
  const badgeOf = (href: string) =>
    href === "/attention" ? pending : href === "/documents" ? documents : 0;

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
        <nav className="flex items-stretch" aria-label="المساحات">
          {tabs.map((a) => (
            <Tab key={a.href} area={a} current={area?.href === a.href} badge={badgeOf(a.href)} />
          ))}
          {more.length > 0 && (
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              className={`flex min-h-11 flex-1 flex-col items-center gap-1 py-2 text-[11px] transition-colors ${
                moreOpen ? "text-ink" : "text-muted"
              }`}
            >
              <MoreIcon className="h-5 w-5" />
              المزيد
            </button>
          )}
        </nav>
      </div>

      {moreOpen && (
        <>
          <button
            type="button"
            aria-label="إغلاق"
            onClick={() => setMoreOpen(false)}
            className="fixed inset-0 z-30 bg-black/25 lg:hidden"
          />
          <div role="dialog" aria-modal="true" aria-label="المزيد" className="fixed inset-x-0 bottom-0 z-40 rounded-t-2xl border-t border-line bg-surface pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-2 lg:hidden">
            <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-line" />
            <ul className="divide-y divide-line">
              {[...more, ...visibleAccountLinks(role)].map((a) => (
                <li key={a.href}>
                  <Link
                    href={a.href}
                    onClick={() => setMoreOpen(false)}
                    className="flex items-center gap-3 px-5 py-3 text-sm font-medium"
                  >
                    <Icon href={a.href} className="h-5 w-5 text-ink-soft" />
                    {a.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </>
  );
}

function Tab({ area, current, badge }: { area: NavArea; current: boolean; badge: number }) {
  return (
    <Link
      href={area.href}
      aria-current={current ? "page" : undefined}
      className={`relative flex min-h-11 flex-1 flex-col items-center gap-1 py-2 text-[11px] transition-colors ${
        current ? "font-bold text-ink" : "text-muted"
      }`}
    >
      <span className="relative">
        <Icon href={area.href} className="h-5 w-5" />
        {badge > 0 && (
          <span className="nums absolute -end-2 -top-1.5 rounded-full bg-warn px-1 text-[9px] font-bold text-white">
            {badge}
          </span>
        )}
      </span>
      {area.short}
    </Link>
  );
}

export function UploadButton({
  role,
  pathname,
  className = "",
}: {
  role: Role;
  pathname: string;
  className?: string;
}) {
  if (!can(role, "document:upload")) return null;

  const active = pathname === "/upload";
  return (
    <Link
      href="/upload"
      className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors sm:min-h-0 sm:py-2 ${
        active ? "border-ink bg-inverse-surface text-inverse-ink" : "border-line hover:border-ink-soft"
      } ${className}`}
    >
      + ارفع مستنداً
    </Link>
  );
}
