import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — قائمةُ الدخل للطباعة */
export default function Loading() {
  return <PageSkeleton title="تقرير الشهر" stats={3} rows={10} width="page" />;
}
