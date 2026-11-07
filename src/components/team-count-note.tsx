import { Send, Users } from "lucide-react";
import { Callout } from "./ui";
import { formatMoment } from "@/lib/riyadh-time";
import { PRODUCT, countNoun } from "@/lib/arabic";
import { loadTeamCountsWaiting } from "@/services/team-count.service";

/**
 * «عدّه أنس من TPH Team» فوق الجرد المفتوح — مَن عدّ وكم صنفاً، وهل أُرسل التقريرُ واتساب.
 * لا يظهر لجردٍ لم يعدّ فيه أحدٌ من الفريق.
 */
export async function TeamCountNote({ countId }: { countId: string }) {
  const [c] = await loadTeamCountsWaiting(countId);
  if (!c) return null;
  const who = c.counters.map((x) => `${x.name} (${countNoun(x.lines, PRODUCT)})`).join("، ");
  return (
    <Callout tone={c.sent && !c.sent.stale ? "info" : "warn"} icon={Users} className="mb-6" title={`عدّه من TPH Team: ${who}`}>
      <span className="inline-flex items-center gap-1.5">
        <Send className="h-3.5 w-3.5" aria-hidden />
        {!c.sent ? "لم يُرسل تقرير الجرد واتساب بعد." : c.sent.stale ? `أُرسل التقرير ${formatMoment(new Date(c.sent.at))} ثم عُدّل بعده.` : `أُرسل التقرير واتساب ${formatMoment(new Date(c.sent.at))}.`}
      </span>
      {" "}عُدّ {c.counted} من {countNoun(c.total, PRODUCT)}. راجع الفروق ثم أقفل الجرد.
    </Callout>
  );
}
