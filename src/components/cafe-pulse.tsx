import Link from "next/link";
import { Activity, ArrowLeft } from "lucide-react";
import { Money } from "./money";
import { Delta } from "./ui";
import { T } from "@/components/i18n/t";
import { timeAgo, countNoun, ORDER } from "@/lib/arabic";
import { formatRiyalsDisplay } from "@/lib/money";
import { formatWeekday } from "@/lib/riyadh-time";
import type { PulseView } from "@/lib/pulse";

const hourLabel = (h: number) => (h === 0 ? "12 ص" : h < 12 ? `${h} ص` : h === 12 ? "12 م" : `${h - 12} م`);

/**
 * «نبض المقهى» أعلى الرئيسيّة — سؤالُ صاحب المقهى الأوّل بعد «ماذا أفعل؟»: كيف يمشي اليوم؟
 *
 * الرقمُ الكبير ما دُفع منذ فتح يوم العمل، وبجانبه الفرقُ عن اليوم نفسه قبل أسبوع **حتى الساعة
 * نفسها** (`lib/pulse.ts`). وتحته الساعاتُ: اليومُ بلون العلامة، والأسبوعُ الماضي ظلاً خلفه — فيُرى
 * أين تأخّر اليومُ وأين سبق. لا زينة: كلُّ عمودٍ رقمٌ يُقرأ بالتحويم وفي الجدول المخفيّ.
 */
export function CafePulse({ pulse }: { pulse: PulseView }) {
  /* اسمُ يوم الأسبوع وحده («الثلاثاء») — الرقمُ بعده في `formatWeekday` يومُ هذا الأسبوع لا الماضي */
  const lastWeekDay = formatWeekday(pulse.businessDay).split(" ")[0];
  const peak = Math.max(pulse.peakMinor, 1);
  const y = pulse.yesterday;
  return (
    <section aria-labelledby="pulse-title" className="relative overflow-hidden rounded-2xl border border-line bg-raised p-5 shadow-raised sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h2 id="pulse-title" className="flex items-center gap-2 text-xs font-bold text-muted">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-soft text-accent">
              <Activity className="h-4 w-4" strokeWidth={2} aria-hidden />
            </span>
            مبيعات اليوم حتى الآن
          </h2>
          <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[2.25rem] font-bold leading-none tracking-tight sm:text-[2.6rem]"><Money minor={pulse.paidMinor} /></span>
            <span className="text-xs text-muted">ر.س شاملة الضريبة</span>
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
            {/* قبل أوّل طلبٍ في اليوم «−١٠٠٪» ضجيج — يُقال ما كان في نظيره حتى الآن وحده */}
            {pulse.vsLastWeekBp !== null && pulse.orders > 0 && <Delta pct={pulse.vsLastWeekBp / 100} favourable={pulse.vsLastWeekBp >= 0} />}
            {pulse.lastWeekToNowMinor !== null
              ? <T s="{0} الماضي حتى الساعة نفسها: {1}" a={[lastWeekDay, <bdi key="1" className="nums" dir="ltr">{formatRiyalsDisplay(pulse.lastWeekToNowMinor)}</bdi>]} />
              : "لا بيانات ليوم الأسبوع نفسه قبل أسبوع للمقارنة"}
          </p>
          <p className="mt-1 text-xs text-muted">
            {pulse.orders > 0
              ? <T s="{0} · متوسط الطلب {1}" a={[countNoun(pulse.orders, ORDER), <bdi key="1" className="nums" dir="ltr">{formatRiyalsDisplay(pulse.avgOrderMinor ?? 0)}</bdi>]} />
              : "لم يُسجَّل طلب بعد في يوم العمل هذا"}
          </p>
        </div>

        {y && (
          <div className="rounded-xl bg-sunken/60 px-4 py-3 text-xs">
            <p className="font-bold text-muted">أمس</p>
            <p className="mt-1 text-lg font-bold"><Money minor={y.paidMinor} /></p>
            <p className="mt-1 flex items-center gap-1.5 text-ink-soft">
              {y.vsUsualBp !== null
                ? <><Delta pct={y.vsUsualBp / 100} favourable={y.vsUsualBp >= 0} /> عن المعتاد ليومه</>
                : countNoun(y.orders, ORDER)}
            </p>
          </div>
        )}
      </div>

      {pulse.hours.length > 0 && (
        <figure className="mt-6">
          <div className="flex h-28 items-end gap-[2px] sm:gap-1" role="img" aria-label="المبيعات بالساعة: اليوم مقارنة باليوم نفسه قبل أسبوع">
            {pulse.hours.map((h) => (
              <div key={h.hour} className="group relative flex h-full min-w-0 flex-1 items-end justify-center">
                {/* الأسبوعُ الماضي ظلٌّ خلف العمود — والساعةُ التي لم تأتِ بعد يبقى ظلُّها وحده */}
                <span className="absolute bottom-0 w-full rounded-t-[4px] bg-line" style={{ height: `${(h.lastWeekMinor / peak) * 100}%` }} aria-hidden />
                {h.todayMinor !== null && (
                  <span className="relative w-[62%] rounded-t-[4px] bg-accent transition-[height] duration-200 ease-out motion-reduce:transition-none" style={{ height: `${Math.max((h.todayMinor / peak) * 100, h.todayMinor > 0 ? 2 : 0)}%` }} aria-hidden />
                )}
                <span className="pointer-events-none absolute bottom-full mb-1 hidden whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] font-bold text-surface shadow-raised group-hover:block">
                  {hourLabel(h.hour)} · اليوم {h.todayMinor === null ? "لم تأتِ" : formatRiyalsDisplay(h.todayMinor)} · قبل أسبوع {formatRiyalsDisplay(h.lastWeekMinor)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-[2px] sm:gap-1" aria-hidden>
            {pulse.hours.map((h, i) => (
              <span key={h.hour} className="min-w-0 flex-1 text-center text-[10px] text-muted">{i % 3 === 0 ? hourLabel(h.hour) : ""}</span>
            ))}
          </div>
          <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted">
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent" aria-hidden /> اليوم</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-line" aria-hidden /> {lastWeekDay} الماضي</span>
              {pulse.syncedAt && <span>· من فودكس، آخر مزامنة {timeAgo(pulse.syncedAt)}</span>}
            </span>
            <Link href="/finance/sales" className="inline-flex min-h-11 items-center gap-1 font-bold text-accent hover:underline hover:underline-offset-4 sm:min-h-0">
              <T s="المبيعات بالتفصيل {0}" a={[<ArrowLeft key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} />
            </Link>
          </figcaption>
          <table className="sr-only">
            <caption>المبيعات بالساعة بالريال</caption>
            <thead><tr><th>الساعة</th><th>اليوم</th><th>قبل أسبوع</th></tr></thead>
            <tbody>
              {pulse.hours.map((h) => (
                <tr key={h.hour}><td>{hourLabel(h.hour)}</td><td>{h.todayMinor === null ? "لم تأتِ" : formatRiyalsDisplay(h.todayMinor)}</td><td>{formatRiyalsDisplay(h.lastWeekMinor)}</td></tr>
              ))}
            </tbody>
          </table>
        </figure>
      )}
    </section>
  );
}
