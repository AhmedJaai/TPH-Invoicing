import { PageSkeleton } from "@/components/page-skeleton";

/* عنوانُ الحزمة محسوبٌ من شهرها — والهيكلُ يقول ما يُنتظَر */
export default function Loading() {
  return <PageSkeleton title="حزمة المحاسب" stats={0} rows={10} width="page" />;
}
