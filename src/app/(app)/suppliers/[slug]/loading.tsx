import { PageSkeleton } from "@/components/page-skeleton";

/* ملفُّ المورّد عنوانُه اسمُه — وكان يقع تحته هيكلُ «حسابات المورّدين» */
export default function Loading() {
  return <PageSkeleton title="ملفّ المورّد" stats={2} rows={8} />;
}
