import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — وبطاقةُ التغطية ثمّ السجلّ */
export default function Loading() {
  return <PageSkeleton title="حركات البنك" stats={1} rows={8} />;
}
