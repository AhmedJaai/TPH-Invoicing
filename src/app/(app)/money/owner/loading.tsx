import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — والجوابُ ثمّ الأشهرُ ثمّ الحركات */
export default function Loading() {
  return <PageSkeleton title="بينك وبين المقهى" eyebrow=" " layout={[{ kind: "hero" }, { kind: "table", rows: 5, heading: true }, { kind: "chips", count: 4 }, { kind: "table", rows: 6, heading: true }]} />;
}
