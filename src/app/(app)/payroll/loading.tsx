import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — المستحقّ وما حُوّل وما بقي، ثمّ الموظفون */
export default function Loading() {
  return <PageSkeleton title="مسيّر الرواتب" stats={3} rows={10} width="page" />;
}
