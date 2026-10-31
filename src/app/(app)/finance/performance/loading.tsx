import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — أربعةُ أرقامٍ ثمّ المعتادُ والجدول */
export default function Loading() {
  return <PageSkeleton title="الأداء" stats={4} rows={6} />;
}
