import { mainClass, type ShellWidth } from "./page-shell";
import { SkeletonAreaTabs } from "./shell-context";

/**
 * ما يُعرَض ريثما تُبنى الصفحة على الخادم — داخل القشرة الثابتة، في موضع
 * المحتوى نفسه وبمقاس عنوانه، فلا يقفز شيءٌ حين تصل.
 *
 * العنوانُ الحقيقيّ يُكتب (فيعرف المنتظر أين هو)، وما تحته أشكالٌ بلا
 * أرقام — والنسبةُ الكاذبة أسوأ من غيابها.
 */
export function PageSkeleton({
  title,
  stats = 4,
  rows = 6,
  width = "wide",
  eyebrow,
  display = false,
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
}) {
  return (
    <main id="main" className={mainClass(width)} aria-busy="true">
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
      <div className="skeleton mt-3 h-4 w-72 max-w-full" />
      {/* ألسنةُ المساحة نفسُها (لا تحتاج بيانات): كان المحتوى ينزل ستّين بكسلاً لحظةَ وصوله */}
      <div className="mt-5">
        <SkeletonAreaTabs />
      </div>

      {stats > 0 && (
        <div className="mt-8 grid grid-cols-2 gap-3 xl:grid-cols-4">
          {Array.from({ length: stats }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-line bg-raised p-5">
              <div className="skeleton h-3.5 w-24" />
              <div className="skeleton mt-5 h-8 w-32" />
              <div className="skeleton mt-4 h-3 w-40 max-w-full" />
            </div>
          ))}
        </div>
      )}

      <div className="mt-10 overflow-hidden rounded-xl border border-line bg-raised">
        <div className="skeleton h-10 rounded-none opacity-60" />
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-t border-line-soft px-5 py-4">
            <div className="skeleton h-9 w-9 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-3.5 w-2/5" />
              <div className="skeleton h-3 w-3/5" />
            </div>
            <div className="skeleton h-4 w-20" />
          </div>
        ))}
      </div>
      <span className="sr-only">يُحمّل…</span>
    </main>
  );
}
