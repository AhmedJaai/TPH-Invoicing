import { PageSkeleton } from "@/components/page-skeleton";

export default function Loading() {
  return <PageSkeleton title="حسابات المورّدين" stats={3} rows={8} />;
}
