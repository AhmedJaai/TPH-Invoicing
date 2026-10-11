import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) */
export default function Loading() {
  return <PageSkeleton title="الاشتراكات والمتكرّر" stats={3} rows={6} />;
}
