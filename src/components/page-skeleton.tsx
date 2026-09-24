import { Skeleton } from "./ui";
import { mainClass, type ShellWidth } from "./page-shell";

/**
 * ما يُعرَض ريثما تُبنى الصفحة على الخادم.
 *
 * كانت الصفحة تبقى فارغةً حتى يكتمل الاستعلام، فيظنّ من ينتظر أنّ
 * التطبيق تعطّل. والهيكل يقول: شيءٌ قادم، وهذا موضعه. بلا نسبة مئوية
 * مخترَعة — فالنسبة الكاذبة أسوأ من غيابها.
 */
export function PageSkeleton({
  title,
  stats = 4,
  rows = 5,
  width = "wide",
}: {
  title: string;
  stats?: number;
  rows?: number;
  width?: ShellWidth;
}) {
  /*
    يقع داخل القشرة الدائمة، في موضع المحتوى نفسه وبمقاس عنوانه — فلا
    يقفز العنوانُ ولا يختفي الشريطُ حين تصل الصفحة.
  */
  return (
    <main id="main" className={mainClass(width)} aria-busy="true">
      <h1 className="font-display text-[1.6rem] font-black leading-[1.15] tracking-tight sm:text-[2rem]">
        {title}
      </h1>
      <p className="mt-2 text-sm text-muted">يُحمّل…</p>

      {stats > 0 && (
        <div className="mt-7 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
          {Array.from({ length: stats }).map((_, i) => (
            <div key={i} className="skeleton h-24 rounded-2xl" />
          ))}
        </div>
      )}

      <div className="mt-8">
        <Skeleton rows={rows} />
      </div>
    </main>
  );
}
