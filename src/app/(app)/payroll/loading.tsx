import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — الأشهر، والمستحقّ وما حُوّل وما بقي، والتقدّم، ثمّ الموظفون */
export default function Loading() {
  return (
    <PageSkeleton
      title="مسيّر الرواتب"
      width="page"
      intro={2}
      actions={2}
      layout={[{ kind: "chips", count: 7 }, { kind: "stats", count: 3 }, { kind: "meter" }, { kind: "table", rows: 10, heading: true }]}
    />
  );
}
