"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, use, useState, useEffect } from "react";
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
    case "/inventory":
      return <svg {...common}><path d="M3.5 8 12 3.5 20.5 8v8L12 20.5 3.5 16Z" /><path d="M3.5 8 12 12.5 20.5 8" /><path d="M12 12.5v8" /></svg>;
    case "/settings/audit":
      return <svg {...common}><path d="M12 3 4.5 6v5.5c0 4.4 3.1 8.2 7.5 9.5 4.4-1.3 7.5-5.1 7.5-9.5V6Z" /><path d="m9 12 2 2 4-4" /></svg>;
    case "/settings":
      return <svg {...common}><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>;
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
 * ── لماذا صار بأسمائه لا بأيقوناته ──
 *
 * كان شريطاً منطوياً بعرض ٥٦ بكسلاً، يتّسع بمرور الفأرة. فكانت المساحاتُ
 * أيقوناتٍ بلا اسم — والجرد دائرةٌ فارغة لأنّه لا أيقونة له، والإعداداتُ
 * وسجلُّ التدقيق شمسان متطابقتان — **وأيقونةٌ لا يُعرف معناها إلّا بمرور
 * الفأرة ليست تنقّلاً بل لغز**. وكان اسمُ المنشأة (المخفيُّ وهو منطوٍ) يرث
 * `flex-1` من صنفٍ كُتب للصفوف، فيتمدّد في العمود ٥٢٥ بكسلاً ويدفع
 * المساحاتِ كلَّها إلى منتصف الشاشة. عطبان صامتان لا يراهما اختبار.
 *
 * وعلى ١٤٤٠ بكسلاً عرضُ المحتوى محدودٌ أصلاً بسقفه، فالمئتا بكسلٍ التي
 * وفّرها الانطواء لم تكن تُعطى لجدول. فصار الشريطُ ثابتاً بأسمائه، وتحت
 * المساحة المفتوحة ألسنتُها — فيُرى الموضعُ من التطبيق كلُّه في نظرة.
 *
 * والعدد الظاهر بجانب «يحتاج قرارك» هو عددُ بنود تلك الصفحة نفسها،
 * يُحسب مرّةً في القشرة ويُمرَّر. **والعدد الذي يقول صفراً والعملُ
 * قائم أسوأ من لا عدّاد.**
 */
export function Sidebar({
  role,
  counts,
  search,
  footer,
}: {
  role: Role;
  /** عدّادا القشرة — وعدٌ يُقرأ في الشارة وحدها، فلا ينتظره رسمُ الصفحة. */
  counts?: Promise<ShellCounts>;
  /** زرُّ لوحة الأوامر — يُمرَّر كي تبقى اللوحةُ واحدةً في القشرة. */
  search?: React.ReactNode;
  /** ضوابطُ العرض والمستخدم — مكوّناتُ خادمٍ تُمرَّر ولا تُستورَد هنا. */
  footer?: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const areas = visibleAreas(role);
  const area = activeArea(pathname);
  const child = area ? activeChild(pathname, area) : undefined;

  return (
    <nav className="flex h-full flex-col" aria-label="المساحات">
      <div className="px-3 pb-2 pt-4">
        <Link href="/" className="flex items-center gap-2.5 rounded-lg px-1.5 py-1">
          <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-inverse-surface font-display text-[13px] font-black text-inverse-ink">
            ذ
          </span>
          <span className="min-w-0">
            <span className="block truncate font-display text-[0.95rem] font-bold leading-tight tracking-tight">ذا بوبليك هاوس</span>
            <span className="block truncate text-[11px] text-muted">المال والتشغيل</span>
          </span>
        </Link>
      </div>

      <div className="space-y-2 px-3 pb-3">
        {search}
        <UploadButton role={role} pathname={pathname} className="w-full" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <ul className="space-y-0.5">
          {areas.map((a) => {
            const current = area?.href === a.href;
            const kids = current ? visibleChildren(role, a) : [];
            return (
              <li key={a.href}>
                <Link
                  href={a.href}
                  aria-current={current && kids.length === 0 ? "page" : undefined}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-[0.45rem] text-sm transition-colors ${
                    current ? "bg-sunken font-bold text-ink" : "text-ink-soft hover:bg-sunken hover:text-ink"
                  }`}
                >
                  <Icon href={a.href} className="h-[1.1rem] w-[1.1rem] shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{a.label}</span>
                  <CountBadge counts={counts} href={a.href} className="rounded-full bg-warn px-1.5 py-px text-[11px] font-bold text-surface" />
                </Link>
                {kids.length > 0 && (
                  <ul className="mb-1 ms-[1.3rem] mt-0.5 space-y-px border-s border-line ps-2">
                    {kids.map((c) => {
                      const on = child?.href === c.href;
                      return (
                        <li key={c.href}>
                          <Link
                            href={c.href}
                            aria-current={on ? "page" : undefined}
                            className={`block truncate rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                              on ? "bg-inverse-surface font-bold text-inverse-ink" : "text-ink-soft hover:bg-sunken hover:text-ink"
                            }`}
                          >
                            {c.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-line px-3 py-2">
        <ul className="space-y-px">
          {visibleAccountLinks(role).map((l) => {
            const on = pathname === l.href;
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={on ? "page" : undefined}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                    on ? "bg-sunken font-bold text-ink" : "text-muted hover:bg-sunken hover:text-ink-soft"
                  }`}
                >
                  <Icon href={l.href} className="h-4 w-4 shrink-0" />
                  <span className="truncate">{l.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        {footer && <div className="mt-2 border-t border-line pt-2.5">{footer}</div>}
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
  counts,
  footer,
}: {
  role: Role;
  counts?: Promise<ShellCounts>;
  /** المستخدمُ والخروج — كانا في الترويسة، وصار موضعُهما «المزيد». */
  footer?: React.ReactNode;
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

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
        <nav className="flex items-stretch" aria-label="المساحات">
          {tabs.map((a) => (
            <Tab key={a.href} area={a} current={area?.href === a.href} counts={counts} />
          ))}
          {(more.length > 0 || footer || visibleAccountLinks(role).length > 0) && (
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
            {footer && <div className="border-t border-line px-5 pt-3">{footer}</div>}
          </div>
        </>
      )}
    </>
  );
}

/**
 * عدّادا القشرة: ما ينتظر قرارك، وما لم يُبَتّ من المستندات.
 * `null` حين تعذّر العدّ — فيُكتب «؟» لا صفرٌ يقول «لا شيء ينتظرك».
 */
export type ShellCounts = { pending: number | null; documents: number | null };

/**
 * الشارةُ تنتظر عددها وحدها. كان التخطيطُ ينتظر الطابور كلَّه (ستّة عشر
 * استعلاماً، ~٣ ثوانٍ) قبل أن يرسم شيئاً، فتتأخّر كلُّ صفحةٍ وكلُّ
 * `router.refresh()` بعد فعلٍ بزمنه. صار العددُ يصل بعد الصفحة.
 */
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

function Tab({ area, current, counts }: { area: NavArea; current: boolean; counts?: Promise<ShellCounts> }) {
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
        <CountBadge counts={counts} href={area.href} className="absolute -end-2 -top-1.5 rounded-full bg-warn px-1 text-[9px] font-bold text-surface" />
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

  /*
    الفعلُ الأكثرُ تكراراً في النظام — فهو الزرُّ الوحيد المملوء في الشريط.
    وفي صفحة الرفع نفسها يبقى ظاهراً ولا يتلوّن: الضغطُ عليه لا يفعل شيئاً
    جديداً، فيُعلَن أنّه الموضعُ الحاليّ.
  */
  const active = pathname === "/upload";
  return (
    <Link
      href="/upload"
      aria-current={active ? "page" : undefined}
      className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-opacity lg:min-h-9 ${
        active ? "border border-line text-muted" : "bg-inverse-surface text-inverse-ink hover:opacity-90"
      } ${className}`}
    >
      <span aria-hidden className="text-sm leading-none">+</span>
      ارفع مستنداً
    </Link>
  );
}
