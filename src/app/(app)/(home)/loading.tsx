import { PageSkeleton } from "@/components/page-skeleton";
import { SkeletonGreeting } from "@/components/shell-context";
import { greeting, longDate } from "@/services/briefing.service";

/**
 * هيكلُ «اليوم» يحمل ما ستحمله الصفحة: التاريخُ فوق، والتحيّةُ بمقاس العرض —
 * كان يكتب «اليوم» ثمّ يتبدّل إلى «صباح الخير، أحمد» بخطٍّ أكبر. والتحيّةُ لا
 * تحتاج قاعدة، والاسمُ من القشرة.
 */
export default function Loading() {
  return (
    <PageSkeleton
      title={<SkeletonGreeting greeting={greeting()} />}
      eyebrow={longDate()}
      display
      intro={2}
      actions={2}
      layout={[{ kind: "hero", side: 2 }, { kind: "stats", count: 4 }, { kind: "list", rows: 3 }]}
    />
  );
}
