"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, Keyboard, Search, UploadCloud } from "lucide-react";
import { ACCOUNT_LINKS, activeArea, activeChild, canSeeArea, entryHref, homeHref } from "@/lib/nav";
import { can, type Role } from "@/lib/permissions";
import { queueCapture } from "@/lib/capture-queue";
import { BrandMark } from "./icons";
import { openCommandPalette } from "@/lib/ui-events";
import { openShortcuts } from "@/lib/ui-events";
import { NotificationsBell } from "./notifications";
import { CaptureButton } from "./nav";
import { toast } from "./ui-client";
import { useShellPath } from "./use-shell-path";

/**
 * الشريطُ العلويّ — موضعُك، والبحث، والإشعارات، والرفع.
 *
 * على الحاسوب: فتاتُ الموضع («المورّدون › الفواتير»)، وحقلُ بحثٍ عريض
 * يفتح لوحة الأوامر، والجرس، وزرُّ الرفع. وعلى الجوّال: العلامةُ واسمُ
 * المساحة والبحثُ والجرس — والرفعُ في زرّ الوسط أسفلَ الشاشة.
 */
export function Topbar({ role, controls }: { role: Role; controls?: React.ReactNode }) {
  const pathname = useShellPath();
  const area = activeArea(pathname);
  const child = area ? activeChild(pathname, area) : undefined;
  const showChild = child && child.label !== area?.label && child.href !== area?.href;
  /* الإعداداتُ وسجلُّ التدقيق خارج المساحات — وموضعُهما يُقال كذلك */
  const account = area ? undefined : [...ACCOUNT_LINKS].sort((a, b) => b.href.length - a.href.length)
    .find((l) => pathname === l.href || pathname.startsWith(`${l.href}/`));

  return (
    <header className="topbar no-print sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur-md">
      <div className="flex h-14 items-center gap-2 px-4 sm:px-6 lg:h-[60px] lg:px-8">
        {/* الجوّال: العلامة واسمُ المساحة */}
        <Link href={homeHref(role)} className="flex min-w-0 items-center gap-2 lg:hidden" aria-label="البداية">
          <BrandMark className="h-7 w-auto text-accent" />
        </Link>
        <p className="min-w-0 flex-1 truncate text-[15px] font-bold lg:hidden">{area?.label ?? account?.label ?? "ذا بوبليك هاوس"}</p>

        {/* الحاسوب: فتاتُ الموضع */}
        <nav aria-label="موضعك" className="hidden min-w-0 items-center gap-1.5 text-[13px] lg:flex lg:w-64 xl:w-72">
          {area ? (
            <>
              {canSeeArea(role, area) ? (
                <Link href={entryHref(role, area)} className={`truncate ${showChild ? "text-muted hover:text-ink" : "font-bold"}`}>
                  {area.label}
                </Link>
              ) : (
                /* مساحةٌ خارج الصلاحية تُسمّى ولا تُفتح — وصلها بابٌ آخر */
                <span className={`truncate ${showChild ? "text-muted" : "font-bold"}`}>{area.label}</span>
              )}
              {showChild && (
                <>
                  <ChevronLeft className="h-3.5 w-3.5 shrink-0 text-muted" strokeWidth={2} aria-hidden />
                  <span className="truncate font-bold">{child.label}</span>
                </>
              )}
            </>
          ) : account ? (
            <>
              <Link href="/settings" className={`truncate ${account.href !== "/settings" ? "text-muted hover:text-ink" : "font-bold"}`}>الإعدادات</Link>
              {account.href !== "/settings" && (
                <>
                  <ChevronLeft className="h-3.5 w-3.5 shrink-0 text-muted" strokeWidth={2} aria-hidden />
                  <span className="truncate font-bold">{account.label}</span>
                </>
              )}
            </>
          ) : (
            <span className="font-bold">ذا بوبليك هاوس</span>
          )}
        </nav>

        <button
          type="button"
          onClick={openCommandPalette}
          className="mx-auto hidden h-9 w-full max-w-md items-center gap-2 rounded-lg border border-line bg-raised px-3 text-start text-[13px] text-muted shadow-xs transition-colors hover:border-line-input lg:flex"
        >
          <Search className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          <span className="flex-1 truncate">ابحث عن مورّدٍ أو فاتورةٍ أو مبلغ — أو اكتب فعلاً</span>
          <kbd dir="ltr" className="shrink-0 rounded border border-line bg-sunken px-1.5 text-[10px] leading-4">⌘K</kbd>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label="ابحث أو انتقل"
            className="grid h-11 w-11 place-items-center rounded-lg text-ink-soft hover:bg-hover hover:text-ink lg:hidden"
          >
            <Search className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden />
          </button>
          <button
            type="button"
            onClick={openShortcuts}
            aria-label="اختصارات لوحة المفاتيح"
            data-tip="اختصارات لوحة المفاتيح (?)"
            className="hidden h-9 w-9 place-items-center rounded-lg text-ink-soft hover:bg-hover hover:text-ink lg:grid"
          >
            <Keyboard className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden />
          </button>
          <NotificationsBell />
          {controls && <div className="hidden lg:block">{controls}</div>}
          <div className="ms-1 hidden lg:block">
            <CaptureButton role={role} variant="bar" />
          </div>
        </div>
      </div>
    </header>
  );
}

/**
 * الإفلاتُ في أيّ صفحة — اسحب فاتورةً من سطح المكتب إلى أيّ موضعٍ في
 * التطبيق فتُقرأ. كان لا يقبلها إلّا مربّعٌ في صفحة الرفع.
 */
export function DropAnywhere({ role }: { role: Role }) {
  const router = useRouter();
  const [over, setOver] = useState(false);
  const allowed = can(role, "document:upload");

  useEffect(() => {
    if (!allowed) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

    function enter(e: DragEvent) {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    }
    function leave(e: DragEvent) {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    }
    function overFn(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
    }
    function drop(e: DragEvent) {
      if (!hasFiles(e)) return;
      /* صفحةُ الرفع لها منطقتُها — لا يُقرأ الملفّ مرّتين */
      if ((e.target as HTMLElement | null)?.closest?.("[data-dropzone]")) {
        depth = 0;
        setOver(false);
        return;
      }
      e.preventDefault();
      depth = 0;
      setOver(false);
      const n = queueCapture(e.dataTransfer?.files ?? []);
      if (n === 0) {
        toast({ tone: "warn", title: "لا يُقرأ إلّا PDF أو صورة." });
        return;
      }
      if (window.location.pathname !== "/upload") router.push("/upload");
    }

    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overFn);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overFn);
      window.removeEventListener("drop", drop);
    };
  }, [allowed, router]);

  if (!over) return null;
  return (
    <div className="no-print pointer-events-none fixed inset-0 z-[70] grid place-items-center bg-surface/70 p-6 backdrop-blur-sm animate-fade">
      <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-accent bg-raised px-10 py-12 text-center shadow-overlay">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-accent-soft text-accent">
          <UploadCloud className="h-7 w-7" strokeWidth={1.75} aria-hidden />
        </span>
        <p className="text-lg font-bold">أفلِتها هنا لتُقرأ</p>
        <p className="text-sm text-muted">فواتير وإيصالات وكشوف — PDF أو صور، أكثر من ملفّ معاً.</p>
      </div>
    </div>
  );
}
