import { AreaTabs, MobileTabBar, Sidebar, UploadButton } from "./nav";
import { CommandPalette, CommandTrigger } from "./command-palette";
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

  const userControls = (
    <div className="flex items-center gap-2">
      <UserMenu name={user.name} role={user.role} />
      <ViewControls />
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/*
        عنوانُ اللسان عنوانُ الصفحة. كانت الألسنةُ كلُّها «فواتير ذا بوبليك
        هاوس» فلا يُفرَّق بينها في المتصفّح ولا في سجلّه — ومن فتح المورّدَ
        والبنكَ والجردَ جنباً إلى جنب لا يعرف أيّها أيّها. وReact يرفع
        `<title>` إلى الترويسة أينما رُسم، فلا تحتاج كلُّ صفحةٍ metadata.
      */}
      <title>{`${title} · ذا بوبليك هاوس`}</title>
      <a href="#main" className="skip-link">
        تخطَّ إلى المحتوى
      </a>

      {/*
        ── الشريط الجانبيّ: ثابتٌ بأسمائه ──

        كان ينطوي إلى أيقوناتٍ بلا أسماء ويتّسع بالفأرة (انظر `Sidebar`).
        وصار يحمل ما كانت الترويسةُ تحمله على الحاسوب — البحثَ والرفعَ
        والمستخدمَ وضوابطَ العرض — فلا ترويسةَ فوق المحتوى تأكل ستّين
        بكسلاً من كلّ صفحة، والعنوانُ أوّلُ ما يُقرأ.
      */}
      <aside
        className="sticky top-0 z-30 hidden h-screen w-60 shrink-0 border-e border-line bg-sunken/50 lg:block"
        aria-label="التنقّل"
      >
        <Sidebar
          role={user.role}
          pending={pending}
          documents={inbox}
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

        {/* الحشو السفليّ يُخلي مكان الشريط السفليّ على الجوّال */}
        <main id="main" className={`mx-auto ${WIDTH[width]} px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-16 lg:pt-10`}>
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
            الشريط تحت مساحتها — وضابطان لشيءٍ واحد في شاشةٍ واحدة يُقرآن
            شيئين.
          */}
          <div className="mt-5 lg:hidden">
            <AreaTabs role={user.role} />
          </div>

          <div className="mt-6 lg:mt-8">{children}</div>
        </main>
      </div>

      {/* خارج الترويسة عمداً: `backdrop-blur` عليها يحبس `fixed` داخلها */}
      <MobileTabBar role={user.role} pending={pending} documents={inbox} footer={<UserMenu name={user.name} role={user.role} />} />

      <CommandPalette role={user.role} canSearch={can(user.role, "document:view")} />
    </div>
  );
}

// يُعاد تصديرهما للمستوردين القدامى؛ تعريفهما في `money.tsx`
export { Money, Empty } from "./money";
