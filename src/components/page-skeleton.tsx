import { mainClass, type ShellWidth } from "./page-shell";
import { SkeletonAreaTabs } from "./shell-context";
import { STAT_GRID_CLASS } from "./ui";

/**
 * ما يُعرَض ريثما تُبنى الصفحة على الخادم — داخل القشرة الثابتة، في موضع
 * المحتوى نفسه وبمقاس عنوانه، فلا يقفز شيءٌ حين تصل.
 *
 * العنوانُ الحقيقيّ يُكتب (فيعرف المنتظر أين هو)، وما تحته أشكالٌ بلا
 * أرقام — والنسبةُ الكاذبة أسوأ من غيابها.
 *
 * والهيكلُ يرسم **شكلَ الصفحة نفسها** (`layout`): بطاقةُ الجواب ثمّ رقائقُ
 * الأشهر ثمّ الجدول، كما ستصل. كان كلُّ هيكلٍ أربعَ بطاقاتٍ وجدولاً، فتصل
 * صفحةُ البنك (تنبيهٌ ثمّ رقائقُ ثمّ سجلّ) وكلُّ شيءٍ يقفز إلى غير موضعه.
 * وبلا `layout` يبقى الشكلُ القديم (`stats` · `rows`) لمن لم يُرسَم بعد.
 *
 * وهيكلُ الرأس يطابق `PageShell`: العنوانُ وسطرُه وأفعالُه في صفٍّ واحد،
 * والألسنةُ تحته، والمتنُ في وعاءٍ `@container` كالمتن الحقيقيّ.
 */
export type SkeletonBlock =
  /** بطاقاتُ أرقامٍ في شبكة `StatGrid` نفسها. */
  | { kind: "stats"; count: number }
  /** بطاقةُ الجواب الكبيرة: رقمٌ وسطرُه، وأعمدةٌ تحته، وبطاقاتٌ جانبيّة. */
  | { kind: "hero"; side?: number; chart?: boolean }
  /** رقائقُ تصفية (`LinkTabs`) — الأشهرُ أو الحالات. */
  | { kind: "chips"; count?: number }
  /** حقلُ بحثٍ وقوائمُ اختيار. */
  | { kind: "filters"; selects?: number }
  /** صندوقُ تنبيهٍ بسطرٍ وفعل. */
  | { kind: "notice" }
  /** شريطُ تقدّمٍ في بطاقة. */
  | { kind: "meter" }
  /** قائمةُ بطاقاتٍ تُحسم — عنوانُ قسمٍ ثمّ صفوف. */
  | { kind: "list"; rows: number; heading?: boolean }
  /** جدولٌ برأسه — عنوانُ قسمٍ ثمّ صفوف. */
  | { kind: "table"; rows: number; heading?: boolean };

export function PageSkeleton({
  title,
  stats = 4,
  rows = 6,
  width = "wide",
  eyebrow,
  display = false,
  intro = 1,
  actions = 0,
  layout,
}: {
  /** اسمُ الصفحة كما سيصل — نصٌّ، أو التحيّةُ في «اليوم». */
  title: React.ReactNode;
  stats?: number;
  rows?: number;
  width?: ShellWidth;
  /** السطرُ الصغير فوق العنوان — كما في `PageShell`. */
  eyebrow?: React.ReactNode;
  /** مقاسُ عنوان العرض — لـ«اليوم» وحدها، كما في `PageShell`. */
  display?: boolean;
  /** كم سطراً في جملة الصفحة تحت العنوان (٠ بلا جملة). */
  intro?: number;
  /** كم زرّاً بجانب العنوان. */
  actions?: number;
  /** شكلُ المتن بترتيبه — وبدونه بطاقاتٌ (`stats`) ثمّ جدول (`rows`). */
  layout?: readonly SkeletonBlock[];
}) {
  const blocks: readonly SkeletonBlock[] =
    layout ?? [...(stats > 0 ? [{ kind: "stats", count: stats } as const] : []), { kind: "table", rows } as const];

  return (
    <main id="main" className={mainClass(width)} aria-busy="true">
      <header>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0 flex-1">
            {eyebrow && <p className="mb-1.5 text-xs font-medium text-muted">{eyebrow}</p>}
            <h1
              className={
                display
                  ? "font-display text-[2.1rem] font-bold leading-[1.15] tracking-tight sm:text-[2.7rem]"
                  : "font-display text-[1.8rem] font-bold leading-[1.2] tracking-tight sm:text-[2.2rem]"
              }
            >
              {title}
            </h1>
            {intro > 0 && (
              <div className="mt-2.5 max-w-2xl space-y-2">
                {Array.from({ length: intro }).map((_, i) => (
                  <div key={i} className={`skeleton h-3.5 ${i === intro - 1 && intro > 1 ? "w-2/5" : "w-full max-w-md"}`} />
                ))}
              </div>
            )}
          </div>
          {actions > 0 && (
            <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
              {Array.from({ length: actions }).map((_, i) => (
                <div key={i} className={`skeleton h-11 rounded-lg sm:h-10 ${i === actions - 1 ? "w-40" : "w-28"}`} />
              ))}
            </div>
          )}
        </div>
        {/* ألسنةُ المساحة نفسُها (لا تحتاج بيانات): كان المحتوى ينزل ستّين بكسلاً لحظةَ وصوله */}
        <div className="mt-5">
          <SkeletonAreaTabs />
        </div>
      </header>

      <div className="@container mt-6 space-y-6 lg:mt-8">
        {blocks.map((b, i) => (
          <Block key={i} block={b} />
        ))}
      </div>
      <span className="sr-only">يحمّل…</span>
    </main>
  );
}

const CARD = "rounded-xl border border-line bg-raised shadow-raised";

function Block({ block }: { block: SkeletonBlock }) {
  switch (block.kind) {
    case "stats":
      return (
        <div className={STAT_GRID_CLASS}>
          {Array.from({ length: block.count }).map((_, i) => (
            <div key={i} className={`${CARD} p-4 sm:p-5`}>
              <div className="skeleton h-3.5 w-24" />
              <div className="skeleton mt-4 h-8 w-32 max-w-full" />
              <div className="skeleton mt-3 h-3 w-40 max-w-full" />
            </div>
          ))}
        </div>
      );
    case "hero": {
      const side = block.side ?? 0;
      return (
        <div className={`${CARD} p-5 sm:p-6`}>
          <div className="flex flex-col gap-5 @3xl:flex-row @3xl:items-start @3xl:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <div className="skeleton h-8 w-8 rounded-lg" />
                <div className="skeleton h-3.5 w-32" />
              </div>
              <div className="skeleton mt-4 h-11 w-48 max-w-full" />
              <div className="skeleton mt-3 h-3 w-56 max-w-full" />
            </div>
            {side > 0 && (
              <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @3xl:w-[26rem]">
                {Array.from({ length: side }).map((_, i) => (
                  <div key={i} className="rounded-xl bg-sunken/60 p-4">
                    <div className="skeleton h-3 w-20" />
                    <div className="skeleton mt-3 h-6 w-24" />
                  </div>
                ))}
              </div>
            )}
          </div>
          {block.chart !== false && (
            /* مساحةُ الرسم بلا أعمدة: عمودٌ مرسومٌ قبل الرقم شكلُ بياناتٍ لم تصل */
            <div className="skeleton mt-6 h-28 w-full rounded-lg opacity-70" aria-hidden />
          )}
        </div>
      );
    }
    case "chips":
      return (
        <div className="flex gap-1 overflow-hidden">
          {Array.from({ length: block.count ?? 6 }).map((_, i) => (
            <div key={i} className={`skeleton h-11 shrink-0 rounded-lg sm:h-8 ${i === 0 ? "w-24 opacity-90" : "w-20 opacity-60"}`} />
          ))}
        </div>
      );
    case "filters":
      return (
        <div className="flex flex-wrap gap-2">
          <div className="skeleton h-11 w-full rounded-lg sm:h-10 sm:max-w-xs" />
          {Array.from({ length: block.selects ?? 0 }).map((_, i) => (
            <div key={i} className="skeleton h-11 w-32 rounded-lg sm:h-10" />
          ))}
        </div>
      );
    case "notice":
      return (
        <div className="flex items-center gap-4 rounded-xl border border-line bg-sunken/50 p-4 sm:p-5">
          <div className="skeleton h-10 w-10 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="skeleton h-3.5 w-48 max-w-full" />
            <div className="skeleton h-3 w-72 max-w-full" />
          </div>
          <div className="skeleton hidden h-10 w-32 shrink-0 rounded-lg sm:block" />
        </div>
      );
    case "meter":
      return (
        <div className={`${CARD} p-4`}>
          <div className="flex justify-between gap-4">
            <div className="skeleton h-3.5 w-40" />
            <div className="skeleton h-3 w-20" />
          </div>
          <div className="skeleton mt-3 h-2 w-full rounded-full" />
        </div>
      );
    case "list":
      return (
        <section>
          {block.heading !== false && <SectionHeading />}
          <div className="space-y-2">
            {Array.from({ length: block.rows }).map((_, i) => (
              <div key={i} className={`${CARD} flex items-center gap-4 px-4 py-4 sm:px-5`}>
                <div className="skeleton h-9 w-9 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="skeleton h-3.5 w-2/5" />
                  <div className="skeleton h-3 w-3/5" />
                </div>
                <div className="skeleton h-10 w-24 shrink-0 rounded-lg" />
              </div>
            ))}
          </div>
        </section>
      );
    case "table":
      return (
        <section>
          {block.heading && <SectionHeading />}
          <div className={`${CARD} overflow-hidden`}>
            <div className="hidden h-10 border-b border-line bg-sunken/60 sm:block" />
            {Array.from({ length: block.rows }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-t border-line-soft px-4 py-4 first:border-t-0 sm:px-5">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="skeleton h-3.5 w-2/5" />
                  <div className="skeleton h-3 w-1/4" />
                </div>
                <div className="skeleton hidden h-3.5 w-16 @2xl:block" />
                <div className="skeleton hidden h-3.5 w-16 @3xl:block" />
                <div className="skeleton h-4 w-20" />
              </div>
            ))}
          </div>
        </section>
      );
  }
}

function SectionHeading() {
  return (
    <div className="mb-3 flex items-center gap-2">
      <div className="skeleton h-4 w-4 rounded" />
      <div className="skeleton h-4 w-36" />
    </div>
  );
}
