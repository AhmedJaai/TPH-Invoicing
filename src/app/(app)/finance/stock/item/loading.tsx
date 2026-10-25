import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — المشترى والمباع لهذا الصنف */
export default function Loading() {
  return <PageSkeleton title="صنف" stats={3} rows={8} />;
}
