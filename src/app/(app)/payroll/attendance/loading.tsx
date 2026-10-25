import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — حضورُ اليوم */
export default function Loading() {
  return <PageSkeleton title="الحضور" stats={0} rows={10} width="page" />;
}
