import { Send, Users } from "lucide-react";
import { Callout } from "./ui";
import { formatMoment } from "@/lib/riyadh-time";
import { PRODUCT, countNoun } from "@/lib/arabic";
import Link from "next/link";
import { loadSavedForReference, loadTeamCountsWaiting } from "@/services/team-count.service";

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

/**
 * ما عدّه الفريقُ خارج اختيارك — محفوظٌ مع الجرد للرجوع إليه، ولا يدخل الحسابَ ولا الفرق (أحمد،
 * ٨ نوفمبر ٢٠٢٦: «خلّه يعدّ كلّ شيء… وما اخترته يُقارَن ويُحسب، والباقي يُحفظ للمرجع»). ويبقى بعد
 * الإقفال في أسطر الجرد، ويصير افتتاحيَّ الأسبوع التالي إن أدخلتَ الصنفَ في النطاق.
 */
export async function SavedForReference({ countId }: { countId: string }) {
  const rows = await loadSavedForReference(countId);
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="saved-ref-title" className="mt-8 rounded-2xl border border-line bg-sunken/50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="saved-ref-title" className="text-sm font-bold">عُدّ للحفظ — خارج المقارنة ({rows.length})</h3>
        <Link href="?step=scope" className="inline-flex min-h-11 items-center text-xs font-bold text-accent hover:underline sm:min-h-0">أدخل صنفاً في المقارنة</Link>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted">عدّها الفريق وليست من الأصناف التي اخترتها: محفوظة مع هذا الجرد للرجوع إليها، ولا يُحسب لها متوقَّع ولا فرق.</p>
      <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-x-6 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.productId} className="flex items-baseline justify-between gap-3 border-b border-line py-2 text-sm">
            <span className="min-w-0 truncate">{r.name}</span>
            <span className="shrink-0 text-end">
              <span className="block font-bold">{r.counted}</span>
              {r.entered && r.entered !== r.counted && <span className="block text-[11px] text-muted">{r.entered}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
