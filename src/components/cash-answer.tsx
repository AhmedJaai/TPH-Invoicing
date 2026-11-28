import Link from "next/link";
import { CircleAlert, CircleCheck, CircleHelp, Percent, Repeat, ShieldAlert, Store, TrendingDown, TriangleAlert, Upload, Users, type LucideIcon } from "lucide-react";
import { Money } from "./money";
import { Badge, LinkButton, type Tone } from "./ui";
import { formatDay, formatMonth, formatWeekday } from "@/lib/riyadh-time";
import type { AnswerDay, CashAnswer, Confidence } from "@/lib/cash-answer";
import type { Commitment, CommitmentKind } from "@/lib/commitments";

/**
 * جوابُ «النقد القادم» في أوّل الشاشة — هل يكفي المال حتى آخر الشهر؟ ومتى يضيق؟ —
 * ثمّ الأيّامُ نفسها التي بُني منها، كلُّ سطرٍ إلى مصدره. البناءُ في `lib/cash-answer.ts`.
 */

const ICON: Record<CommitmentKind, LucideIcon> = { SUPPLIER_RUN: Store, RECURRING: Repeat, VAT: Percent, EXPIRY: CircleHelp, PAYROLL: Users };
const CONFIDENCE: Record<Confidence, { label: string; tone: Tone }> = {
  HIGH: { label: "الثقة عالية", tone: "ok" },
  MEDIUM: { label: "الثقة متوسطة", tone: "warn" },
  LOW: { label: "الثقة منخفضة", tone: "danger" },
};

export function dayLabel(day: string): string {
  /* `formatWeekday` يحمل رقمَ اليوم («الأحد 27») — والتاريخُ كاملاً بعده، فيُؤخذ اسمُ اليوم وحده */
  return day === "now" ? "الآن" : `${formatWeekday(day).replace(/\s*\d+$/, "")} ${formatDay(day)}`;
}

function topItem(d: AnswerDay | undefined): Commitment | undefined {
  return d?.items.find((c) => c.amountMinor !== null);
}

export function CashAnswerHero({ a, canImport }: { a: CashAnswer; canImport: boolean }) {
  const month = formatMonth(a.monthEnd.month);
  const next = formatMonth(a.horizonEnd.month);
  const dayOf = (day: string) => a.days.find((d) => d.day === day);
  const thisMonth = (day: string) => day === "now" || day.slice(0, 7) <= a.monthEnd.month;

  let tone: Tone;
  let Icon: LucideIcon;
  let head: React.ReactNode;
  let sub: React.ReactNode;
  if (a.balanceMinor === null) {
    tone = "muted";
    Icon = CircleHelp;
    head = "لا يمكن الحكم: الرصيد غير معروف";
    sub = "لا يوجد كشف يظهر فيه الرصيد. استورد كشفاً فيه عمود الرصيد، وتبقى الالتزامات أدناه بمبالغها.";
  } else if (a.firstShort && thisMonth(a.firstShort.day)) {
    const top = topItem(dayOf(a.firstShort.day));
    tone = "danger";
    Icon = CircleAlert;
    head = a.firstShort.day === "now" ? "لا. الرصيد المعروف لا يكفي ما فات موعده" : <>لا. ينقص المال <bdi>{dayLabel(a.firstShort.day)}</bdi></>;
    sub = <>ينقصك <b className="text-danger"><Money minor={a.firstShort.shortMinor} /></b> إن لم يدخل شيء قبله{top && <>، وأكبر ما يخرج يومها {top.label} <Money minor={top.amountMinor ?? 0} /></>}.</>;
  } else if (a.firstShort) {
    const top = topItem(dayOf(a.firstShort.day));
    tone = "warn";
    Icon = TrendingDown;
    head = <>نعم حتى آخر {month}، ثم يضيق <bdi>{dayLabel(a.firstShort.day)}</bdi></>;
    sub = <>يبقى آخر {month} <b className="text-ink"><Money minor={a.monthEnd.afterMinor ?? 0} /></b> على الأقل، ثم ينقصك <b className="text-danger"><Money minor={a.firstShort.shortMinor} /></b> إن لم يدخل شيء{top && <>، بسبب {top.label} <Money minor={top.amountMinor ?? 0} /></>}.</>;
  } else if (a.firstBelowFloor) {
    tone = "warn";
    Icon = ShieldAlert;
    head = <>يكفي، لكنه ينزل تحت حدّك <bdi>{dayLabel(a.firstBelowFloor.day)}</bdi></>;
    sub = <>يبقى بعدها <b className="text-ink"><Money minor={a.firstBelowFloor.afterMinor} /></b> على الأقل. <Link href="#floor" className="font-bold text-accent hover:underline">غيّر الحد</Link> أو جرّب تأجيل دفعة أدناه.</>;
  } else if (a.days.length === 0) {
    tone = "ok";
    Icon = CircleCheck;
    head = `لا التزامات معروفة حتى آخر ${next}`;
    sub = "لا دفعة مورّدين مفتوحة ولا مصروف متكرر ولا رواتب مسجّلة. هذا لا يعني أن شيئاً لن يخرج: سجّل ما يتكرر ليظهر هنا.";
  } else {
    tone = "ok";
    Icon = CircleCheck;
    head = `نعم، يكفي حتى آخر ${next}`;
    sub = a.tightest
      ? <>أضيق يوم <bdi className="font-bold text-ink">{dayLabel(a.tightest.day)}</bdi>، ويبقى بعده <b className="text-ink"><Money minor={a.tightest.afterMinor} /></b> على الأقل.</>
      : "المبالغ المعروفة لا تُنقص الرصيد في هذه الفترة.";
  }
  const skin: Record<Tone, string> = {
    ok: "bg-ok-bg text-ok", warn: "bg-warn-bg text-warn", danger: "bg-danger-bg text-danger", muted: "bg-sunken text-muted", info: "bg-info-bg text-info", accent: "bg-accent-soft text-accent",
  };
  const conf = CONFIDENCE[a.confidence];

  return (
    <section aria-labelledby="cash-answer" className="overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
      <div className="flex items-start gap-3 p-4 sm:gap-4 sm:p-6">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl sm:h-12 sm:w-12 ${skin[tone]}`}>
          <Icon className="h-6 w-6" strokeWidth={2} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-muted">هل يكفي المال حتى آخر {month}؟ ومتى يضيق؟</p>
          <h2 id="cash-answer" className={`mt-1 text-[1.4rem] font-bold leading-snug sm:text-[1.7rem] ${tone === "danger" ? "text-danger" : "text-ink"}`}>{head}</h2>
          <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-ink-soft">{sub}</p>
          {a.balanceMinor === null && canImport && (
            <div className="mt-3"><LinkButton href="/bank#import" variant="primary" icon={Upload}>استورد كشف البنك</LinkButton></div>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-[minmax(0,1fr)] border-t border-line-soft sm:grid-cols-3">
        <Fact label="آخر رصيد معروف" href={a.balanceMinor === null ? "/bank#import" : "/bank"}
          value={a.balanceMinor === null ? <span className="text-muted">غير معروف</span> : <Money minor={a.balanceMinor} />}
          note={a.balanceMinor === null ? "لا كشف فيه الرصيد" : a.balanceAsOf ? <>في <bdi>{formatDay(a.balanceAsOf)}</bdi></> : "يومه غير معروف"} />
        <Fact label="أضيق يوم" href={a.tightest ? `#day-${a.tightest.day}` : undefined}
          value={a.tightest ? <span className={a.tightest.afterMinor < 0 ? "text-danger" : ""}><Money minor={a.tightest.afterMinor} /></span> : <span className="text-muted">{a.balanceMinor === null ? "غير معروف" : "لا يوجد"}</span>}
          note={a.tightest ? <>يبقى بعد <bdi>{dayLabel(a.tightest.day)}</bdi> على الأقل</> : a.balanceMinor === null ? "يحتاج رصيداً معروفاً" : "لا يخرج مبلغ معروف"} />
        <Fact label={`آخر ${next}`}
          value={a.horizonEnd.afterMinor === null ? <span className="text-muted">غير معروف</span> : <span className={a.horizonEnd.afterMinor < 0 ? "text-danger" : ""}><Money minor={a.horizonEnd.afterMinor} /></span>}
          note={a.monthEnd.afterMinor === null ? "بعد كل ما هو معروف" : <>وآخر {month}: <Money minor={a.monthEnd.afterMinor} /></>} />
      </dl>

      <div className="flex flex-col gap-2 border-t border-line-soft bg-sunken/50 px-4 py-3 sm:flex-row sm:items-start sm:px-6">
        <span className="shrink-0"><Badge tone={conf.tone} dot>{conf.label}</Badge></span>
        <ul className="min-w-0 flex-1 space-y-0.5 text-xs leading-relaxed text-ink-soft">
          {a.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </div>
    </section>
  );
}

function Fact({ label, value, note, href }: { label: string; value: React.ReactNode; note: React.ReactNode; href?: string }) {
  const body = (
    <>
      <dt className="text-[11px] font-bold text-muted">{label}</dt>
      <dd className="mt-1 text-lg font-bold leading-tight">{value}</dd>
      <dd className="mt-0.5 text-[11px] text-muted">{note}</dd>
    </>
  );
  const cls = "block min-h-11 border-line-soft px-4 py-3 sm:border-s sm:px-6 sm:first:border-s-0 max-sm:border-t max-sm:first:border-t-0";
  return href
    ? <div className={cls}><Link href={href} className="block rounded-lg transition-colors hover:text-accent">{body}</Link></div>
    : <div className={cls}>{body}</div>;
}

/** الأيّامُ يوماً بيوم — ما يخرج، والرصيدُ بعده، وأضيقُها معلَّم. */
export function CashDays({ a, hrefFor }: { a: CashAnswer; hrefFor: (c: Commitment) => string | null }) {
  return (
    <ol className="divide-y divide-line-soft overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
      {a.days.map((d) => {
        const tight = a.tightest?.day === d.day;
        const short = d.afterMinor !== null && d.afterMinor < 0;
        const first = a.firstShort?.day === d.day;
        return (
          <li key={d.day} id={`day-${d.day}`} className={`scroll-mt-28 grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[9.5rem_minmax(0,1fr)_9rem] sm:px-5 ${short ? "bg-danger-bg/60" : tight ? "bg-accent-soft/60" : ""}`}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:block">
              <p className={`text-[13px] font-bold ${d.day === "now" ? "text-danger" : ""}`}><bdi>{dayLabel(d.day)}</bdi></p>
              <p className="flex flex-wrap gap-1 sm:mt-1">
                {d.day === "now" && <Badge tone="danger">فات موعده</Badge>}
                {first && <Badge tone="danger" dot>هنا ينقص</Badge>}
                {tight && !first && <Badge tone="accent" dot>أضيق يوم</Badge>}
              </p>
            </div>
            <ul className="min-w-0">
              {d.items.map((c) => <Item key={c.id} c={c} href={hrefFor(c)} />)}
            </ul>
            <div className="flex items-baseline justify-between gap-3 border-t border-line-soft pt-2 sm:block sm:border-0 sm:pt-0 sm:text-end">
              <p className="text-[13px] font-bold">
                {d.outMinor > 0 ? <>− <Money minor={d.outMinor} /></> : <span className="text-[11px] font-medium text-warn">مبلغ غير معروف</span>}
                {d.outMinor > 0 && d.unknownCount > 0 && <span className="block text-[11px] font-medium text-warn">+ مبلغ غير معروف</span>}
              </p>
              {d.afterMinor !== null && (
                <p className={`text-[11px] sm:mt-1 ${short ? "font-bold text-danger" : "text-muted"}`}>
                  يبقى ≥ <Money minor={d.afterMinor} />
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Item({ c, href }: { c: Commitment; href: string | null }) {
  const Icon = ICON[c.kind];
  const body = (
    <>
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sunken text-ink-soft">
        <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-[13px] leading-snug">{c.label}</span>
        {c.sub && <span className="block text-[11px] leading-snug text-muted">{c.sub}</span>}
      </span>
      {c.amountMinor === null
        ? <span className="shrink-0 text-[11px] font-bold text-warn">غير معروف</span>
        : <span className="nums-col shrink-0 text-[13px] text-ink-soft"><Money minor={c.amountMinor} /></span>}
    </>
  );
  const cls = "flex min-h-11 items-center gap-3 rounded-lg px-1";
  return (
    <li>
      {href ? <Link href={href} className={`${cls} transition-colors hover:bg-hover hover:text-accent`}>{body}</Link> : <div className={cls}>{body}</div>}
    </li>
  );
}

/** ما مضى يومُه ولم يُطرح — يُسمّى، فلا يُظنّ أنّه نُسي. */
export function SkippedPast({ items }: { items: readonly Commitment[] }) {
  if (items.length === 0) return null;
  return (
    <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-muted">
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" strokeWidth={2} aria-hidden />
      <span>
        لم يُطرح لأن يومه مضى هذا الشهر ولم يُسجَّل دفعه (ربما دُفع ولم يُربط):{" "}
        {items.map((c, i) => <span key={c.id}>{i > 0 && "، "}{c.label} {c.amountMinor !== null && <Money minor={c.amountMinor} />}</span>)}.{" "}
        <Link href="/money/expenses" className="inline-flex min-h-11 items-center font-bold text-accent hover:underline sm:min-h-0">راجع المصروفات</Link>
      </span>
    </p>
  );
}

