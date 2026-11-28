import { PageSkeleton } from "@/components/page-skeleton";

export default function Loading() {
  return (
    /* الحالاتُ الأربع، ثمّ البحثُ وقوائمُه، ثمّ ما ينتظر المراجعة وما وصل مؤخّراً */
    <PageSkeleton
      title="المستندات"
      actions={1}
      layout={[
        { kind: "chips", count: 4 },
        { kind: "filters", selects: 3 },
        { kind: "list", rows: 2, heading: false },
        { kind: "table", rows: 5, heading: true },
      ]}
    />
  );
}
