import { PageSkeleton } from "@/components/page-skeleton";

/* بعرض الصفحة نفسها (`page`) — فلا تقفز منطقةُ الالتقاط حين تصل */
export default function Loading() {
  return <PageSkeleton title="ارفع مستنداً" stats={0} rows={2} width="page" />;
}
