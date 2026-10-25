import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — الرصيدُ والمستحقّ والضريبة والنقد */
export default function Loading() {
  return <PageSkeleton title="الوضع الآن" stats={4} rows={6} />;
}
