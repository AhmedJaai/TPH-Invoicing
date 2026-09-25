import { PageSkeleton } from "@/components/page-skeleton";

/* ثلاثةُ أرقامٍ ثمّ الجدول — كما تُرسَم القائمة */
export default function Loading() {
  return <PageSkeleton title="الفواتير" stats={3} rows={8} />;
}
