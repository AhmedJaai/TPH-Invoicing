import { AreaTabs, MobileTabBar, Sidebar, UploadButton } from "./nav";
import { SearchBox } from "./search-box";
import { TrialBanner } from "./trial-banner";
import { UserMenu } from "./user-menu";
import { ViewControls } from "./view-controls";
import { can, type Role } from "@/lib/permissions";
import { inboxCount, workCount } from "@/lib/work";

/**
 * القشرة: شريطٌ جانبيٌّ ثابت على الحاسوب، وشريطٌ سفليّ على الجوّال.
 *
 * ── العرض ──
 *
 * كان الكلّ `max-w-5xl`، ثمّ صار ثلاثة عروض. والعرضان الضيّقان يصلحان
 * لنموذجٍ يُملأ ولصفحةٍ تُقرأ، ولا يصلحان لجدولٍ ماليّ. والأوسع منها
 * `max-w-7xl` — أي ١٢٨٠ بكسلاً في وسط شاشةٍ عرضُها ١٤٤٠، وحافّتان
 * فارغتان بينما الجدول يُسحب عرضاً تحتهما.
 *
 * فصار الشريطُ الجانبيّ يأخذ عرضه، والمحتوى يأخذ الباقي كلَّه إلى سقفٍ
 * مريح؛ و`form` وحده يبقى ضيّقاً لأنّ السطر الطويل لا يُملأ.
 *
 * وموضع السقف على المحتوى لا على القشرة: كان `max-w` يلفّ الترويسة
 * والمحتوى معاً، فيضيق شريط التنقّل بضيق الصفحة — وهو ثابتٌ في التطبيق
 * لا يتبع ما في الصفحة.
 */
export type ShellWidth = "form" | "page" | "wide";

const WIDTH: Record<ShellWidth, string> = {
  form: "max-w-3xl",
  page: "max-w-5xl",
  wide: "max-w-[1400px]",
};

export async function PageShell({
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
  /*
    عددان اثنان لا أكثر، وكلاهما يفتح ما يعدّه بعينه. ومن لا يرى
    التقارير لا يُحسَب له عددُ العمل.
  */
  const [pending, inbox] = await Promise.all([
    can(user.role, "reports:view") ? workCount() : Promise.resolve(0),
    inboxCount(),
  ]);

  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" className="skip-link">
        تخطَّ إلى المحتوى
      </a>

      {/*
        ── الشريط الجانبيّ ينطوي ──

        كان ثابتاً بعرض ٢٤٠ بكسلاً يأخذها من الجدول دائماً. وأكثرُ
        الوقت لا يُنظَر إليه: صاحب المقهى يفتح شاشةً ويعمل فيها. فصار
        شريطاً ضيّقاً بالأيقونات، يتّسع بمرور الفأرة عليه أو بتركيز
        لوحة المفاتيح، وينطوي حين تبتعد.

        والاتّساع بالتراكب لا بالدفع: لو دفع المحتوى لانتقل الجدولُ
        تحت الفأرة كلّما مرّت، وهو أسوأ من ضيق الشاشة.

        و`group` على الحاوية كي يتبعها المحتوى في `Sidebar` بلا حالةٍ
        في JavaScript — فينطوي ويتّسع بلا إعادة رسم.
      */}
      <aside
        className="group/rail sticky top-0 z-30 hidden h-screen w-14 shrink-0 overflow-hidden border-s border-line bg-sunken/40 transition-[width] duration-200 hover:w-60 focus-within:w-60 lg:block"
        aria-label="التنقّل"
      >
        <div className="h-full w-60">
          <Sidebar role={user.role} pending={pending} documents={inbox} />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <TrialBanner />

        {/* ── الجوّال: ترويسةٌ تحمل الشعار والبحث ── */}
        <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur-md">
          <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
            <span className="shrink-0 truncate font-display text-base font-bold leading-tight tracking-tight lg:hidden">
              ذا بوبليك هاوس
            </span>
            <SearchBox />
            <div className="flex shrink-0 items-center gap-2">
              <ViewControls />
              <span className="lg:hidden">
                <UploadButton role={user.role} pathname="" />
              </span>
              <UserMenu name={user.name} role={user.role} />
            </div>
          </div>
        </header>

        {/* الحشو السفليّ يُخلي مكان الشريط السفليّ على الجوّال */}
        <main id="main" className={`mx-auto ${WIDTH[width]} px-4 pb-28 pt-6 sm:px-6 lg:pb-16 lg:pt-9`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="font-display text-[1.65rem] font-black leading-[1.15] tracking-tight sm:text-[2.1rem]">
                {title}
              </h1>
              {intro && (
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">{intro}</p>
              )}
            </div>
            {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
          </div>

          {/* ألسنةُ المساحة تحت عنوانها — فتُقرأ تابعةً له */}
          <div className="mt-5">
            <AreaTabs role={user.role} />
          </div>

          <div className="mt-6">{children}</div>
        </main>
      </div>

      {/* خارج الترويسة عمداً: `backdrop-blur` عليها يحبس `fixed` داخلها */}
      <MobileTabBar role={user.role} pending={pending} documents={inbox} />
    </div>
  );
}

// يُعاد تصديرهما للمستوردين القدامى؛ تعريفهما في `money.tsx`
export { Money, Empty } from "./money";
