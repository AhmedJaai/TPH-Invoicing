import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — والأرقامُ الثلاثة ثمّ الأبواب */
export default function Loading() {
  return <PageSkeleton title="أين ذهب المال" stats={3} rows={6} />;
}
