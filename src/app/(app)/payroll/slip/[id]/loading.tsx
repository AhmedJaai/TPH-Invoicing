import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — القسيمة */
export default function Loading() {
  return <PageSkeleton title="قسيمة الراتب" stats={0} rows={8} width="page" />;
}
