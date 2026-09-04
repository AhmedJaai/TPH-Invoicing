"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { can, type Role } from "@/lib/permissions";
import {
  activeArea,
  activeChild,
  mobileTabs,
  visibleAreas,
  visibleChildren,
  type NavArea,
} from "@/lib/nav";

/**
 * التنقّل حول عمل صاحب المقهى لا حول جداول القاعدة.
 *
 * والموضع يُشتقّ من المسار نفسه لا من خاصيّة تمرّرها كل صفحة: كانت
 * `/الموردون` تُعلِّم «الإعدادات» و`/التدقيق` تُعلِّم «الأداء»، لأنّ
 * الخاصيّة تُكتب باليد فتُنسى. المسار لا يُنسى.
 *
 * وعلى الجوّال شريط سفليّ ثابت: الإبهام يبلغ أسفل الشاشة، ولا يبلغ
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
    case "/purchases":
      return <svg {...common}><path d="M4 7h16l-1.2 12.5a1.5 1.5 0 0 1-1.5 1.5H6.7a1.5 1.5 0 0 1-1.5-1.5Z" /><path d="M8.5 7V5.5a3.5 3.5 0 0 1 7 0V7" /></svg>;
    case "/money":
      return <svg {...common}><rect x="2.5" y="5.5" width="19" height="13" rx="2" /><path d="M2.5 10h19" /></svg>;
    case "/performance":
      return <svg {...common}><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></svg>;
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

export function Nav({ role }: { role: Role }) {
  const pathname = usePathname() ?? "/";
  const areas = visibleAreas(role);
  const area = activeArea(pathname);
  const children = area ? visibleChildren(role, area) : [];
  const child = area ? activeChild(pathname, area) : undefined;

  return (
    <>
      {/* ── الحاسوب: المساحات ثمّ أقسام المساحة المفتوحة ── */}
      <nav className="hidden items-center gap-1 sm:flex" aria-label="المساحات">
        {areas.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            aria-current={area?.href === a.href ? "page" : undefined}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              area?.href === a.href
                ? "bg-inverse-surface text-inverse-ink"
                : "text-ink-soft hover:bg-sunken"
            }`}
          >
            {a.label}
          </Link>
        ))}

        {/* الرفع فعلٌ لا مساحة — فيبقى ظاهراً وممتازاً عن بقيّة الروابط */}
        <UploadButton role={role} pathname={pathname} className="ms-auto" />
      </nav>

      {children.length > 0 && (
        <nav
          className="mt-2 flex items-center gap-4 overflow-x-auto border-t border-line pt-2"
          aria-label={area?.label}
        >
          {children.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              aria-current={child?.href === c.href ? "page" : undefined}
              className={`shrink-0 border-b-2 pb-1 text-xs transition-colors ${
                child?.href === c.href
                  ? "border-ink font-bold text-ink"
                  : "border-transparent text-muted hover:text-ink-soft"
              }`}
            >
              {c.label}
            </Link>
          ))}
        </nav>
      )}

    </>
  );
}


/**
 * شريط الجوّال السفليّ.
 *
 * يُركَّب في جذر الصفحة لا داخل الترويسة: الترويسة عليها `backdrop-blur`،
 * والمرشِّح يُنشئ إطاراً حاويًا يحبس `fixed` داخله — فكان الشريط يظهر
 * أعلى الشاشة لا أسفلها. لا يُدخل هذا المكوّن ترويسةً أبداً.
 */
export function MobileTabBar({ role }: { role: Role }) {
  const pathname = usePathname() ?? "/";
  const [moreOpen, setMoreOpen] = useState(false);
  const area = activeArea(pathname);
  const { tabs, more } = mobileTabs(role, pathname);

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden">
        <nav className="flex items-stretch" aria-label="المساحات">
          {tabs.map((a) => (
            <Tab key={a.href} area={a} current={area?.href === a.href} />
          ))}
          {more.length > 0 && (
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              className={`flex flex-1 flex-col items-center gap-1 py-2 text-[10px] transition-colors ${
                moreOpen ? "text-ink" : "text-muted"
              }`}
            >
              <MoreIcon className="h-5 w-5" />
              المزيد
            </button>
          )}
        </nav>
      </div>

      {moreOpen && more.length > 0 && (
        <>
          <button
            type="button"
            aria-label="إغلاق"
            onClick={() => setMoreOpen(false)}
            className="fixed inset-0 z-30 bg-black/25 sm:hidden"
          />
          <div className="fixed inset-x-0 bottom-0 z-40 rounded-t-2xl border-t border-line bg-surface pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-2 sm:hidden">
            <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-line" />
            <ul className="divide-y divide-line">
              {more.map((a) => (
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

function Tab({ area, current }: { area: NavArea; current: boolean }) {
  return (
    <Link
      href={area.href}
      aria-current={current ? "page" : undefined}
      className={`flex flex-1 flex-col items-center gap-1 py-2 text-[10px] transition-colors ${
        current ? "font-bold text-ink" : "text-muted"
      }`}
    >
      <Icon href={area.href} className="h-5 w-5" />
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
      className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
        active ? "border-ink bg-inverse-surface text-inverse-ink" : "border-line hover:border-ink-soft"
      } ${className}`}
    >
      + رفع
    </Link>
  );
}
