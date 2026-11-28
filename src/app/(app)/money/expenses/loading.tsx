import { PageSkeleton } from "@/components/page-skeleton";

/* الأشهرُ ثمّ رقمُ الشهر ثمّ التصنيفات ثمّ القيود — بترتيب الصفحة */
export default function Loading() {
  return <PageSkeleton title="المصروفات" actions={2} layout={[{ kind: "chips", count: 6 }, { kind: "stats", count: 2 }, { kind: "list", rows: 5, heading: true }, { kind: "table", rows: 8, heading: true }]} />;
}
