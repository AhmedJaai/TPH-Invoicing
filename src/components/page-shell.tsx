import Link from "next/link";
import { MobileTabBar, Nav, UploadButton } from "./nav";
import { SearchBox } from "./search-box";
import { TrialBanner } from "./trial-banner";
import { UserMenu } from "./user-menu";
import type { Role } from "@/lib/permissions";

/**
 * عرض الصفحة يتبع ما فيها.
 *
 * كان الكل `max-w-5xl` — وهو عرضٌ ممتاز لنموذج تملؤه، ضيّقٌ على جدول
 * بعشرة أعمدة يُقرأ عرضاً. فصار العرض ثلاثة: نموذجٌ يُقرأ في سطر قصير،
 * وصفحةٌ عاديّة، ولوحةٌ أو جدولٌ يأخذ ما تعطيه الشاشة.
 */
export type ShellWidth = "form" | "page" | "wide";

const WIDTH: Record<ShellWidth, string> = {
  form: "max-w-3xl",
  page: "max-w-5xl",
  wide: "max-w-7xl",
};

export function PageShell({
  user,
  title,
  intro,
  actions,
  width = "page",
  children,
}: {
  user: { name?: string | null; role: Role };
  title: string;
  intro?: string;
  /** أفعال الصفحة، تظهر بمحاذاة العنوان على الشاشات الواسعة. */
  actions?: React.ReactNode;
  width?: ShellWidth;
  children: React.ReactNode;
}) {
  const w = WIDTH[width];

  return (
    <div className="min-h-screen">
      <TrialBanner />
      <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className={`mx-auto ${w} px-4 py-3 sm:px-6`}>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="hidden shrink-0 truncate font-display text-base font-bold leading-tight tracking-tight sm:block"
            >
              ذا بوبليك هاوس
            </Link>
            <SearchBox />
            <div className="flex shrink-0 items-center gap-2">
              <MobileUpload role={user.role} />
              <UserMenu name={user.name} role={user.role} />
            </div>
          </div>
          <div className="mt-2.5">
            <Nav role={user.role} />
          </div>
        </div>
      </header>

      {/* الحشو السفليّ يُخلي مكان الشريط السفليّ على الجوّال */}
      <main className={`mx-auto ${w} px-4 pb-28 pt-7 sm:px-6 sm:pb-16 sm:pt-10`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-[1.65rem] font-black leading-[1.15] tracking-tight sm:text-4xl">
              {title}
            </h1>
            {intro && (
              <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-ink-soft">{intro}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>
        <div className="mt-7 sm:mt-8">{children}</div>
      </main>

      {/* خارج الترويسة عمداً: `backdrop-blur` عليها يحبس `fixed` داخلها */}
      <MobileTabBar role={user.role} />
    </div>
  );
}

/** على الجوّال لا يظهر شريط المساحات العلويّ، فيبقى الرفع في رأس الصفحة. */
function MobileUpload({ role }: { role: Role }) {
  return (
    <span className="sm:hidden">
      <UploadButton role={role} pathname="" />
    </span>
  );
}

// يُعاد تصديرهما للمستوردين القدامى؛ تعريفهما في `money.tsx`
export { Money, Empty } from "./money";
