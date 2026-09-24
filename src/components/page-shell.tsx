import { AreaTabs, MobileTabBar, Sidebar, UploadButton, type ShellCounts } from "./nav";
import { CommandPalette, CommandTrigger } from "./command-palette";
import { AutoProcess } from "./auto-process";
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

/**
 * القشرةُ الدائمة — في تخطيط `(app)` لا في كلّ صفحة.
 *
 * كانت تُرسَم داخل كلّ صفحة، فيقع هيكلُ التحميل (`loading.tsx`) **مكانها**:
 * يضغط صاحبُ المقهى «حركة البنك» فيختفي الشريطُ الجانبيّ كلُّه ثانيتين
 * ويبقى عنوانٌ وأشرطةٌ رماديّة على سواد — كأنّه خرج من التطبيق. وكان
 * عدّادُ «يحتاج قرارك» يُعاد حسابُه (ستّة عشر استعلاماً) في كلّ تنقّل.
 *
 * والتخطيطُ يبقى بين الصفحات: الشريطُ ثابت، والهيكلُ يقع في موضع المحتوى
 * وحده. والعدّادان يتجدّدان مع كلّ فعلٍ (`router.refresh()` يعيد رسم
 * التخطيط) لا مع كلّ ضغطة رابط.
 */
export function AppShell({
  user,
  children,
}: {
  user: { name?: string | null; role: Role };
  children: React.ReactNode;
}) {
  /*
    عددان اثنان لا أكثر، وكلاهما يفتح ما يعدّه بعينه. ومن لا يرى
    التقارير لا يُحسَب له عددُ العمل. ولا يُنتظَران هنا: يُمرَّران وعداً
    تقرؤه الشارة، فتُرسَم القشرةُ والصفحةُ قبلهما.
  */
  const counts: Promise<ShellCounts> = Promise.all([
    can(user.role, "reports:view") ? workCount().catch(() => null) : Promise.resolve(0),
    inboxCount().catch(() => null),
  ]).then(([pending, documents]) => ({ pending, documents }));

  const userControls = (
    <div className="flex items-center gap-2">
      <UserMenu name={user.name} role={user.role} />
      <ViewControls />
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" className="skip-link">
        تخطَّ إلى المحتوى
      </a>

      {/*
        ── الشريط الجانبيّ: ثابتٌ بأسمائه ──

        يحمل ما كانت الترويسةُ تحمله على الحاسوب — البحثَ والرفعَ
        والمستخدمَ وضوابطَ العرض — فلا ترويسةَ فوق المحتوى تأكل ستّين
        بكسلاً من كلّ صفحة، والعنوانُ أوّلُ ما يُقرأ.
      */}
      <aside
        className="sticky top-0 z-30 hidden h-screen w-60 shrink-0 border-e border-line bg-sunken/50 lg:block"
        aria-label="التنقّل"
      >
        <Sidebar
          role={user.role}
          counts={counts}
          search={<CommandTrigger />}
          footer={userControls}
        />
      </aside>

      <div className="min-w-0 flex-1">
        <TrialBanner />

        {/* ── الجوّال: ترويسةٌ تحمل الاسمَ والبحثَ والرفع ── */}
        <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur-md lg:hidden">
          <div className="flex items-center gap-2 px-4 py-2">
            <span className="min-w-0 flex-1 truncate font-display text-base font-bold leading-tight tracking-tight">
              ذا بوبليك هاوس
            </span>
            <CommandTrigger compact />
            <ViewControls />
            <UploadButton role={user.role} pathname="" />
          </div>
        </header>

        {children}
      </div>

      {/* خارج الترويسة عمداً: `backdrop-blur` عليها يحبس `fixed` داخلها */}
      <MobileTabBar role={user.role} counts={counts} footer={<UserMenu name={user.name} role={user.role} />} />

      <CommandPalette role={user.role} canSearch={can(user.role, "document:view")} />
      {can(user.role, "document:upload") && can(user.role, "amounts:view") && <AutoProcess />}
    </div>
  );
}

/** موضعُ المحتوى بعرضه — تقرؤه الصفحةُ وهيكلُ تحميلها معاً، فلا يقفز المحتوى حين يصل. */
export function mainClass(width: ShellWidth = "page"): string {
  return `mx-auto ${WIDTH[width]} px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-16 lg:pt-10`;
}

/**
 * رأسُ الصفحة ومحتواها — والقشرةُ حولها في التخطيط.
 *
 * `user` باقٍ في التوقيع لألسنة المساحة على الجوّال (تتبع الدور).
 */
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
  return (
    <main id="main" className={mainClass(width)}>
      {/*
        عنوانُ اللسان عنوانُ الصفحة — وReact يرفع `<title>` إلى الترويسة
        أينما رُسم، فلا تحتاج كلُّ صفحةٍ metadata.
      */}
      <title>{`${title} · ذا بوبليك هاوس`}</title>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-[1.6rem] font-black leading-[1.15] tracking-tight sm:text-[2rem]">
            {title}
          </h1>
          {intro && (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">{intro}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>

      {/*
        ألسنةُ المساحة تحت عنوانها على الجوّال وحده. وعلى الحاسوب هي في
        الشريط تحت مساحتها.
      */}
      <div className="mt-5 lg:hidden">
        <AreaTabs role={user.role} />
      </div>

      <div className="mt-6 lg:mt-8">{children}</div>
    </main>
  );
}

// يُعاد تصديرهما للمستوردين القدامى؛ تعريفهما في `money.tsx`
export { Money, Empty } from "./money";
