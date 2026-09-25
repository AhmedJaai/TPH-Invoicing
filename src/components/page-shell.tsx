import { MobileTabBar, Sidebar, AreaTabs, type ShellCounts } from "./nav";
import { CommandPalette } from "./command-palette";
import { Suspense } from "react";
import { AutoProcess } from "./auto-process";
import { HashScroll } from "./hash-scroll";
import { TrialBanner } from "./trial-banner";
import { UserMenu } from "./user-menu";
import { ViewControls } from "./view-controls";
import { KeyboardShortcuts } from "./keyboard";
import { Topbar, DropAnywhere } from "./topbar";
import { Toaster } from "./ui-client";
import { can, type Role } from "@/lib/permissions";
import { inboxCount, workCount } from "@/lib/work";
import { isAuthBypassed } from "@/lib/session";

/**
 * القشرة — الإصدار الثاني.
 *
 * على الحاسوب: إطارٌ جانبيٌّ داكن بلون العلامة (٢٥٦ بكسلاً)، وفوق المحتوى
 * شريطٌ رفيع فيه موضعُك والبحثُ والإشعاراتُ والرفع. وعلى الجوّال: شريطٌ
 * علويّ باسم المساحة، وشريطٌ سفليّ يبلغه الإبهام وفي وسطه زرُّ الالتقاط.
 *
 * والقشرةُ في تخطيط `(app)` لا في كلّ صفحة: تبقى ثابتةً بين الصفحات،
 * وهيكلُ التحميل يقع في موضع المحتوى وحده. والعدّادان وعدٌ تقرؤه الشارة
 * في `Suspense`، فلا ينتظرهما رسمُ الصفحة.
 */
export type ShellWidth = "form" | "page" | "wide";

const WIDTH: Record<ShellWidth, string> = {
  form: "max-w-3xl",
  page: "max-w-6xl",
  wide: "max-w-[1440px]",
};

export function AppShell({
  user,
  children,
}: {
  user: { name?: string | null; role: Role };
  children: React.ReactNode;
}) {
  const counts: Promise<ShellCounts> = Promise.all([
    can(user.role, "reports:view") ? workCount().catch(() => null) : Promise.resolve(0),
    inboxCount().catch(() => null),
  ]).then(([pending, documents]) => ({ pending, documents }));

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
      <a href="#main" className="skip-link">
        تخطَّ إلى المحتوى
      </a>

      <aside
        className="no-print sticky top-0 z-30 hidden h-screen bg-frame text-frame-ink lg:block"
        aria-label="التنقّل"
      >
        <Sidebar
          role={user.role}
          counts={counts}
          footer={<UserMenu name={user.name} role={user.role} tone="frame" />}
        />
      </aside>

      <div className="min-w-0">
        <TrialBanner />
        <Topbar role={user.role} controls={<ViewControls />} />
        {children}
      </div>

      <MobileTabBar
        role={user.role}
        counts={counts}
        footer={
          <div className="flex items-center gap-3">
            <UserMenu name={user.name} role={user.role} tone="surface" />
            <ViewControls />
          </div>
        }
      />

      <CommandPalette role={user.role} canSearch={can(user.role, "document:view")} />
      <KeyboardShortcuts role={user.role} />
      <DropAnywhere role={user.role} />
      <Toaster />
      {can(user.role, "document:upload") && can(user.role, "amounts:view") && <AutoProcess drive={!isAuthBypassed()} />}
      <Suspense fallback={null}>
        <HashScroll />
      </Suspense>
    </div>
  );
}

/** موضعُ المحتوى بعرضه — تقرؤه الصفحةُ وهيكلُ تحميلها معاً، فلا يقفز المحتوى حين يصل. */
export function mainClass(width: ShellWidth = "page"): string {
  return `mx-auto w-full ${WIDTH[width]} px-4 pb-32 pt-6 sm:px-6 lg:px-8 lg:pb-16 lg:pt-8`;
}

/**
 * رأسُ الصفحة ومحتواها: عنوانٌ واضح، وسطرٌ يقول ما الصفحة، وأفعالُها
 * بجانبه، وألسنةُ المساحة تحته على كلّ مقاس.
 */
export function PageShell({
  user,
  title,
  intro,
  actions,
  width = "page",
  eyebrow,
  display = false,
  children,
}: {
  user: { name?: string | null; role: Role };
  title: string;
  intro?: string;
  /** أفعال الصفحة، تظهر بمحاذاة العنوان على الشاشات الواسعة. */
  actions?: React.ReactNode;
  width?: ShellWidth;
  /** سطرٌ صغير فوق العنوان — تاريخٌ أو سياق. */
  eyebrow?: React.ReactNode;
  /** عنوانٌ بخطّ ثمانية سيرف — للتحيّة في «اليوم» وحدها. */
  display?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main id="main" className={mainClass(width)}>
      {/* React 19 يرفع `<title>` إلى الترويسة أينما رُسم */}
      <title>{`${title} · ذا بوبليك هاوس`}</title>
      <header className="animate-rise">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            {eyebrow && <p className="mb-1.5 text-xs font-medium text-muted">{eyebrow}</p>}
            <h1
              className={
                display
                  ? "font-display text-[2rem] font-black leading-[1.15] tracking-tight sm:text-[2.6rem]"
                  : "text-[1.65rem] font-extrabold leading-[1.2] tracking-tight sm:text-[1.9rem]"
              }
            >
              {title}
            </h1>
            {intro && (
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-soft">{intro}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
        <div className="mt-5">
          <AreaTabs role={user.role} />
        </div>
      </header>

      <div className="mt-6 lg:mt-8">{children}</div>
    </main>
  );
}

// يُعاد تصديرهما للمستوردين القدامى؛ تعريفهما في `money.tsx`
export { Money, Empty } from "./money";
