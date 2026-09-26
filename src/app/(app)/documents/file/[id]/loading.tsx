import { PageSkeleton } from "@/components/page-skeleton";

export default function Loading() {
  return <PageSkeleton title="مستند" stats={0} rows={4} width="page" />;
}
