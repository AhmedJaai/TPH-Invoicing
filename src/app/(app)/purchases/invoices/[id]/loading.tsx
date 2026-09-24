import { PageSkeleton } from "@/components/page-skeleton";

/*
  هيكلُ ملفّ الفاتورة — وبدونه يقع هيكلُ «الفواتير» فوقه، فيقرأ صاحبُ المقهى
  عنوانَ القائمة ثمّ يراه يتبدّل إلى رقم فاتورة.
*/
export default function Loading() {
  return <PageSkeleton title="فاتورة" stats={0} />;
}
