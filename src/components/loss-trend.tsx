import { Sparkline, Badge, type Tone } from "./ui";
import { DIRECTION } from "./inventory-ui";
import { MAX_WEEK_BP, MIN_MEASURED_WEEKS, type TrendJudgement, type TrendPoint, type TrendVerdict } from "@/lib/inventory/waste-trend";
import { T } from "@/components/i18n/t";

/**
 * رسمُ الفاقد عبر الجرود وحكمُه — نقصُ الصنف نسبةً من استهلاكه المتوقَّع، جرداً جرداً (`waste-trend.ts`).
 * أعمدةٌ حقيقيّة لا خطٌّ يُمدّ: أسبوعٌ لم يُقَس فرقُه خانةٌ مقطّعةٌ «—» لا عمودٌ بصفر.
 */

export const VERDICT_LABEL: Record<TrendVerdict, string> = {
  IMPROVING: "يتحسّن",
  WORSENING: "يسوء",
  STEADY: "ثابت",
  TOO_FEW: "لا يكفي للحكم",
};
export const VERDICT_TONE: Record<TrendVerdict, Tone> = { IMPROVING: "ok", WORSENING: "danger", STEADY: "muted", TOO_FEW: "muted" };

/** النسبةُ بالنقطة الأساس نصّاً مَعزولاً: «٪» حرفٌ عربيّ يقلب الإشارة والرقم بلا عزل (`formatBp`). */
export function share(bp: number): string {
  return `⁦${(Math.round(bp / 10) / 10).toFixed(1)}٪⁩`;
}

/** «24/10» — يومُ نهاية الأسبوع بلا سنةٍ ولا اسمِ شهر: عنوانُ عمود. */
function shortDay(day: string): string {
  return `${Number(day.slice(8, 10))}/${Number(day.slice(5, 7))}`;
}

export function TrendBadge({ verdict }: { verdict: TrendVerdict }) {
  return <Badge tone={VERDICT_TONE[verdict]} dot={verdict !== "TOO_FEW"}>{VERDICT_LABEL[verdict]}</Badge>;
}

export function LossBars({ points, label }: { points: readonly TrendPoint[]; label: string }) {
  const max = Math.max(1, ...points.map((p) => Math.min(MAX_WEEK_BP, p.shortageBp ?? 0)));
  return (
    <figure aria-label={label} className="rounded-xl border border-line bg-raised p-4 shadow-raised">
      <ul className="flex h-44 items-stretch gap-1.5 sm:gap-2" role="list">
        {points.map((p) => {
          const v = p.shortageBp;
          const pct = v === null ? 0 : Math.max(2, (Math.min(MAX_WEEK_BP, v) / max) * 100);
          return (
            <li key={p.countId} className="flex min-w-0 flex-1 flex-col text-center" title={v === null ? "لم يُحسب فرقه في هذا الجرد" : undefined}>
              <span className="nums h-4 text-[10px] font-bold leading-4 text-ink-soft">{v === null ? "—" : share(v)}</span>
              <span className="relative mt-1 block flex-1">
                {v === null
                  ? <span className="absolute inset-x-1 bottom-0 h-2 rounded border border-dashed border-line" aria-hidden />
                  : <span className={`absolute inset-x-0 bottom-0 rounded-t-md ${DIRECTION.short.bar} ${p.partial ? "opacity-50" : ""}`} style={{ height: `${pct}%` }} aria-hidden />}
              </span>
              <span className="nums mt-1.5 text-[10px] text-muted">{shortDay(p.periodEnd)}</span>
              <span className="h-3 text-[9px] font-bold leading-3 text-warn">{p.partial ? "جزئي" : ""}</span>
            </li>
          );
        })}
      </ul>
      <figcaption className="mt-2 text-[11px] leading-relaxed text-muted">
        نقصُ كلّ جردٍ مقفل من استهلاكه المتوقَّع، وتاريخُ كلّ عمودٍ يومُ نهاية أسبوعه. الزيادةُ لا تُعدّ فاقداً ولا تُطفئ نقصاً. وفوق المئة بالمئة يُقصّ العمودُ ويُرجَّح أنّ العدَّ خاطئ. والعمودُ الباهتُ «جزئي»: لم يدخل كلُّ ما بيع في حساب ذلك الجرد، فنقصُه مشوب.
      </figcaption>
    </figure>
  );
}

/** الحكمُ جملةً بأرقامه — لا «يتحسّن» وحدها. */
export function TrendSentence({ j, subject }: { j: TrendJudgement; subject: string }) {
  if (j.verdict === "TOO_FEW" || j.earlierBp === null || j.recentBp === null) {
    return (
      <T s="لا يكفي للحكم على {0}: قيس فرقُه في {1} فقط، ويلزم {2} على الأقل. لا يُحكم من نقطةٍ أو نقطتين." a={[subject, <span key="1" className="nums">{j.measured}</span>, <span key="2" className="nums">{MIN_MEASURED_WEEKS}</span>]} />
    );
  }
  const lead = j.verdict === "IMPROVING" ? "يتحسّن" : j.verdict === "WORSENING" ? "يسوء" : "ثابتٌ تقريباً";
  return (
    <T s="{0} {1}: متوسّطُ نقصه {2} من الاستهلاك المتوقَّع في النصف الأوّل من الجرود، و{3} في النصف الأخير." a={[subject, lead, <strong key="2">{share(j.earlierBp)}</strong>, <strong key="3">{share(j.recentBp)}</strong>]} />
  );
}

export function TrendSpark({ points, verdict }: { points: readonly TrendPoint[]; verdict: TrendVerdict }) {
  const spark = Sparkline({ values: points.map((p) => p.shortageBp), tone: VERDICT_TONE[verdict] === "muted" ? "accent" : VERDICT_TONE[verdict], label: "نقص الصنف جرداً جرداً" });
  return spark ?? <span className="text-muted">—</span>;
}

/** تنبيهُ الجزئيّ فوق الحكم — يُقال كم جرداً منها جزئيّ، فلا يُبنى حكمٌ على ما فيه نقص دون علم. */
export function PartialNote({ points }: { points: readonly TrendPoint[] }) {
  const partial = points.filter((p) => p.partial).length;
  if (partial === 0) return null;
  return (
    <p className="mt-2 text-[11px] leading-relaxed text-warn">
      <T s="{0} من {1} جرداً تقريرها جزئي (لم يدخل كل ما بيع في الحساب)، فنقصها قد يكون مشوباً، والحكم أعلاه يشملها." a={[<span key="0" className="nums font-bold">{partial}</span>, <span key="1" className="nums">{points.length}</span>]} />
    </p>
  );
}
