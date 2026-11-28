import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — «هذا الشهر» ثمّ ما يتكرّر */
export default function Loading() {
  return <PageSkeleton title="الخصومات المتكررة" eyebrow=" " actions={1} layout={[{ kind: "list", rows: 3 }, { kind: "table", rows: 4, heading: true }]} />;
}
