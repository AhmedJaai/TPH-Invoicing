import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — البنودُ الجاهزة ثمّ الباقية */
export default function Loading() {
  return <PageSkeleton title="ربط بنود الفواتير" stats={2} rows={10} />;
}
