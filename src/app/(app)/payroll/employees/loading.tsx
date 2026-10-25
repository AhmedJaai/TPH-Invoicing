import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — من يعمل الآن */
export default function Loading() {
  return <PageSkeleton title="الموظفون" stats={0} rows={10} width="page" />;
}
