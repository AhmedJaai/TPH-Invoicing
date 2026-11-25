import { PageSkeleton } from "@/components/page-skeleton";

/* العنوانُ عنوانُ الصفحة نفسه (يحرسه `nav.test.ts`) — أربعةُ أرقامٍ ثمّ الشهرُ يوماً بيوم */
export default function Loading() {
  return <PageSkeleton title="التوقّع" stats={4} rows={8} />;
}
