import { PageSkeleton } from "@/components/page-skeleton";

/* الجوابُ ثمّ الأيّامُ يوماً بيوم ثمّ ما يُجنَّب له — بترتيب الصفحة */
export default function Loading() {
  return <PageSkeleton title="النقد القادم" actions={2} layout={[{ kind: "hero" }, { kind: "list", rows: 4, heading: true }, { kind: "list", rows: 2, heading: true }]} />;
}
