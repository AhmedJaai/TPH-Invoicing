import { PageSkeleton } from "@/components/page-skeleton";

export default function Loading() {
  return <PageSkeleton title="حركة بنك" stats={0} rows={3} width="page" />;
}
