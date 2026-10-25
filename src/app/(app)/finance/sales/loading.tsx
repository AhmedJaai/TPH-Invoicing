import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — ما دفعه الزبائن والطلبات، ثمّ يوماً بيوم */
export default function Loading() {
  return <PageSkeleton title="المبيعات" stats={4} rows={8} />;
}
