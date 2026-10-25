import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — المشترى والمباع والمتوقّع والمفقود، ثمّ الأصناف */
export default function Loading() {
  return <PageSkeleton title="المشترى والمباع" stats={4} rows={10} />;
}
