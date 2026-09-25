import { PageSkeleton } from "@/components/page-skeleton";

/* ملفُّ الصنف عنوانُه اسمُه — والهيكلُ يحمل اسمَ الصفحة لا اسمَ صنفٍ لم يُقرأ بعد */
export default function Loading() {
  return <PageSkeleton title="ملفّ الصنف" stats={2} width="page" />;
}
