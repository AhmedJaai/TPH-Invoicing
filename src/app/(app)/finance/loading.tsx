import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — الأشهر، وصافي الربح برسمه، ثمّ قائمةُ الدخل */
export default function Loading() {
  return (
    <PageSkeleton
      title="الربح"
      intro={2}
      actions={2}
      layout={[{ kind: "chips", count: 7 }, { kind: "hero" }, { kind: "table", rows: 8, heading: true }]}
    />
  );
}
