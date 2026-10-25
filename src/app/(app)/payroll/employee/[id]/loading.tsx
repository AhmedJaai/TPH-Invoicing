import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — ملفُّ الموظف */
export default function Loading() {
  return <PageSkeleton title="الموظف" stats={3} rows={8} width="page" />;
}
