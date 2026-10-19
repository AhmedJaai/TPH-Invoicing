import { AlarmClock, RotateCcw } from "lucide-react";
import { Money } from "./money";
import { PostAction } from "./post-action";
import { ITEM, countNoun } from "@/lib/arabic";
import type { SnoozedItem } from "@/lib/attention-snooze";
import { formatDay } from "@/lib/riyadh-time";
import { T } from "@/components/i18n/t";

/**
 * «مؤجَّل» — ما أخرجه صاحبُه من العدّ إلى يومٍ سمّاه. يُفتح ولا يُخفى: كلُّ بندٍ
 * بيوم عودته وسببه ومبلغه حين أُجِّل، وزرٌّ يعيده الآن.
 */
export function SnoozedList({ snoozed, canEdit }: { snoozed: readonly SnoozedItem[]; canEdit: boolean }) {
  return (
    <details className="mt-8">
      <summary className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-xs font-bold text-ink-soft hover:text-ink">
        <T s="{0}مؤجّل: {1}، وخارج العدد حتى موعده" a={[<AlarmClock key="0" className="h-4 w-4 text-muted" strokeWidth={2} aria-hidden />, countNoun(snoozed.length, ITEM)]} /></summary>
      <ul className="mt-2 divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised">
        {snoozed.map(({ item, until, note }) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
            <span className="min-w-0 flex-1 basis-56">
              <span className="block text-[13px] font-bold leading-snug">{item.title}</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                <T s="يعود {0}{1}" a={[formatDay(until), note ? ` — «${note}»` : ""]} /></span>
            </span>
            {item.amountMinor !== undefined && <span className="text-sm font-bold"><Money minor={item.amountMinor} /></span>}
            {canEdit && (
              <PostAction url="/api/attention-snooze" body={{ itemId: item.id, until: null }} variant="quiet" done="عاد البند إلى القائمة">
                <T s="{0}أعده الآن" a={[<RotateCcw key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></PostAction>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
