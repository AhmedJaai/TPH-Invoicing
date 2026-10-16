import { BellOff, Clock, RotateCcw } from "lucide-react";
import { PostAction } from "./post-action";

/**
 * فعلا الملاحظة المحسوبة: «ذكّرني بعد أسبوع» و«أسكِتها» — ولمن أسكت «أعِدها».
 *
 * الملاحظةُ تحذيرٌ لا حكم: صاحبُها يعرف ما لا يعرفه النظام (كان المقهى مغلقاً،
 * الزيادةُ متّفقٌ عليها). والإسكاتُ يُتراجَع عنه من الإشعار، ويُكتب في السجلّ.
 */
export function SignalControls({
  signalKey,
  silenced = false,
  dismissLabel = "أسكتها",
  snoozeDays = 7,
}: {
  signalKey: string;
  /** أُسكتت من قبل — فيُعرض «أعِدها» وحده. */
  silenced?: boolean;
  dismissLabel?: string;
  snoozeDays?: number;
}) {
  if (silenced) {
    return (
      <PostAction url="/api/signal" body={{ key: signalKey, action: "reopen" }} variant="quiet" done="أعيدت الملاحظة">
        <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        أعدها
      </PostAction>
    );
  }
  return (
    <>
      <PostAction
        url="/api/signal"
        body={{ key: signalKey, action: "snooze", days: snoozeDays }}
        undo={{ body: { key: signalKey, action: "reopen" } }}
        variant="quiet"
      >
        <Clock className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        ذكّرني بعد {snoozeDays === 7 ? "أسبوع" : `${snoozeDays} يوماً`}
      </PostAction>
      <PostAction
        url="/api/signal"
        body={{ key: signalKey, action: "dismiss" }}
        undo={{ body: { key: signalKey, action: "reopen" } }}
        variant="quiet"
      >
        <BellOff className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        {dismissLabel}
      </PostAction>
    </>
  );
}
