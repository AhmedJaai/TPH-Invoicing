import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — الإيراد والتكلفة والمصروفات، ثمّ قائمةُ الدخل */
export default function Loading() {
  return <PageSkeleton title="الربح" stats={3} rows={8} />;
}
