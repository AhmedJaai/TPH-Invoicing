import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — بطاقةُ التغطية، وما ينتظر قرارك، ثمّ السجلُّ برقائقه وبحثه */
export default function Loading() {
  return (
    <PageSkeleton
      title="حركات البنك"
      intro={2}
      actions={1}
      layout={[
        { kind: "notice" },
        { kind: "list", rows: 2 },
        { kind: "chips", count: 4 },
        { kind: "chips", count: 8 },
        { kind: "filters" },
        { kind: "table", rows: 8 },
      ]}
    />
  );
}
