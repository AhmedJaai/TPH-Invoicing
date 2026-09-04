import { Skeleton } from "./ui";

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
}: {
  title: string;
  stats?: number;
  rows?: number;
}) {
  return (
    <div className="mx-auto max-w-7xl px-4 pb-28 pt-7 sm:px-6 sm:pt-10">
      <h1 className="font-display text-[1.65rem] font-black leading-[1.15] tracking-tight sm:text-4xl">
        {title}
      </h1>
      <p className="mt-2.5 text-sm text-muted">يُحمّل…</p>

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
    </div>
  );
}
