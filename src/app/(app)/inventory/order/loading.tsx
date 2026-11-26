import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) */
export default function Loading() {
  return <PageSkeleton title="قائمة الطلب" stats={0} rows={6} />;
}
