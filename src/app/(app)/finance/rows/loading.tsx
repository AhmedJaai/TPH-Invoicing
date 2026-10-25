import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — سطورُ الرقم */
export default function Loading() {
  return <PageSkeleton title="تفصيل الرقم" stats={0} rows={10} />;
}
