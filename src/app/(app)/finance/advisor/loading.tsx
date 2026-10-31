import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — المحادثةُ والخطّة */
export default function Loading() {
  return <PageSkeleton title="المستشار" rows={4} />;
}
