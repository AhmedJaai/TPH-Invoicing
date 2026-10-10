import { PageSkeleton } from "@/components/page-skeleton";

/** كان يرث هيكلَ `/close` فيُكتب «إقفال الشهر» ثمّ يتبدّل. */
export default function Loading() {
  return <PageSkeleton title="إقرار الضريبة" stats={3} width="page" />;
}
