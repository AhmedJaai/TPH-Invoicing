import { PageSkeleton } from "@/components/page-skeleton";

export default function Loading() {
  return <PageSkeleton title="حركة بنكية" stats={0} rows={3} width="page" />;
}
