import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — النموذجُ ثمّ ما أضفته */
export default function Loading() {
  return <PageSkeleton title="ما لا يظهر في الكشف" stats={0} rows={5} width="page" />;
}
