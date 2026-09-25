import { PageSkeleton } from "@/components/page-skeleton";

/* عنوانُ الكشف محسوبٌ من اسم المورّد — والهيكلُ يقول ما يُنتظَر */
export default function Loading() {
  return <PageSkeleton title="كشف حساب المورّد" stats={0} rows={10} width="page" />;
}
