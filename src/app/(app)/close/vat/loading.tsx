import { PageSkeleton } from "@/components/page-skeleton";

/** كان يرث هيكلَ `/close` فيُكتب «إقفال الشهر» ثمّ يتبدّل. */
export default function Loading() {
  return <PageSkeleton title="الإقرار الضريبي" stats={3} width="page" />;
}
