import Link from "next/link";
import { Activity, ArrowLeft, CircleAlert, CircleCheck, Landmark } from "lucide-react";
import { Money } from "@/components/money";
import { Delta } from "@/components/ui";
import { T } from "@/components/i18n/t";
import { formatDay, formatWeekday } from "@/lib/riyadh-time";
import type { PulseView } from "@/lib/pulse";
import type { WeekDue } from "@/lib/cash-outlook";

/**
 * جوابا الصباح الأوّلان، في الشاشة الأولى على الجوّال: «كيف يمشي البيع؟» و«هل يكفي ما في البنك لما
 * يخرج هذا الأسبوع؟». كانا في أسفل الصفحة (رصيدُ البنك بعد ثلاث شاشات على الجوّال)، والرقمُ الكبيرُ
 * للمبيعات وحده في أعلاها. الأرقامُ هي هي — النبضُ (`loadPulseOnce`) والرصيدُ (`loadCashPosition`)
 * والأسبوعُ (`weekDue`) — وكلُّ بطاقةٍ تفتح موضعَ تفصيلها. والمجهولُ «غير معروف» لا صفر.
 */

export interface CashAnswer {
  balanceMinor: number | null;
  /** يومُ آخر رصيدٍ معروف (`YYYY-MM-DD`) — `null` لا يُعرف. */
  asOfDay: string | null;
  /** أقدمُ من ثلاثة أيّام: لا يُقال «يكفي» بلا تاريخه. */
  stale: boolean;
}

const tile =
  "group flex min-w-0 flex-col rounded-2xl border border-line bg-raised p-4 shadow-raised transition-[border-color,box-shadow] duration-200 ease-out hover:border-accent-line hover:shadow-lifted motion-reduce:transition-none sm:p-5";

export function TodayAnswers({
  pulse,
  cash,
  week,
}: {
  /** `null` لا مبيعاتَ في مرآة فودكس — يُقال ذلك، لا صفر. */
  pulse: PulseView | null;
  /** `null` لا يرى الدورُ البنك — لا تُرسم البطاقة. */
  cash: CashAnswer | null;
  week: WeekDue | null;
}) {
  return (
    <section aria-label="جواب الصباح" className={`grid gap-3 ${cash ? "grid-cols-2" : "grid-cols-1"} sm:gap-4`}>
      <SalesTile pulse={pulse} />
      {cash && <CashTile cash={cash} week={week} />}
    </section>
  );
}

function TileHead({ icon: Icon, label }: { icon: typeof Activity; label: string }) {
  return (
    <span className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold text-muted sm:text-xs">
        <Icon className="h-3.5 w-3.5 shrink-0 text-accent sm:h-4 sm:w-4" strokeWidth={2} aria-hidden />
        <span className="min-w-0">{label}</span>
      </span>
      <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-muted transition-colors group-hover:text-accent" strokeWidth={2} aria-hidden />
    </span>
  );
}

function SalesTile({ pulse }: { pulse: PulseView | null }) {
  if (!pulse) {
    return (
      <Link href="/finance/sales" className={tile}>
        <TileHead icon={Activity} label="مبيعات اليوم" />
        <span className="mt-2 text-base font-bold text-muted">غير معروف</span>
        <span className="mt-1 text-[11px] leading-relaxed text-muted">لا مبيعات في فودكس بعد. افتح المبيعات لترى متى قُرئ آخر مرة.</span>
      </Link>
    );
  }
  const lastWeekDay = formatWeekday(pulse.businessDay).split(" ")[0];
  const y = pulse.lastDay;
  return (
    <Link href="/finance/sales" className={tile}>
      <TileHead icon={Activity} label="مبيعات اليوم حتى الآن" />
      <span className="mt-2 text-[1.45rem] font-bold leading-none tracking-tight sm:text-[2rem]">
        <Money minor={pulse.paidMinor} />
      </span>
      <span className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-snug text-ink-soft sm:text-xs">
        {/* قبل أوّل طلبٍ «−١٠٠٪» ضجيج — يُقال أنّه لم يُطلب شيء بعد */}
        {pulse.orders === 0
          ? "لم يُسجَّل طلب بعد"
          : pulse.vsLastWeekBp !== null
            ? <T s="{0} عن {1} الماضي حتى الساعة نفسها" a={[<Delta key="0" pct={pulse.vsLastWeekBp / 100} favourable={pulse.vsLastWeekBp >= 0} />, lastWeekDay]} />
            : "لا نظير قبل أسبوع للمقارنة"}
      </span>
      {y && y.paidMinor > 0 && (
        <span className="mt-auto flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-line-soft pt-2 text-[11px] text-muted sm:mt-3 sm:text-xs">
          <span className="font-bold text-ink-soft">أمس <Money minor={y.paidMinor} /></span>
          {y.vsBp !== null && (
            <T s="{0} عن {1}" a={[<Delta key="0" pct={y.vsBp / 100} favourable={y.vsBp >= 0} />, y.against === "USUAL" ? "معتاده" : "نظيره"]} />
          )}
        </span>
      )}
    </Link>
  );
}

function CashTile({ cash, week }: { cash: CashAnswer; week: WeekDue | null }) {
  const out = week && week.lines.length > 0 ? week.totalMinor : 0;
  const known = cash.balanceMinor !== null;
  const short = known && week !== null && cash.balanceMinor! < out;
  return (
    <Link href="/cash" className={`${tile} ${short ? "border-danger/40" : ""}`}>
      <TileHead icon={Landmark} label="البنك وهذا الأسبوع" />
      <span className="mt-2 text-[1.45rem] font-bold leading-none tracking-tight sm:text-[2rem]">
        {known ? <Money minor={cash.balanceMinor!} /> : <span className="text-base text-muted">غير معروف</span>}
      </span>
      <span className="mt-2 text-[11px] leading-snug text-ink-soft sm:text-xs">
        {week === null
          ? "ما يخرج هذا الأسبوع لا يظهر لدورك."
          : week.lines.length === 0
            ? "لا مدفوعات مستحقة هذا الأسبوع"
            : <T s="يخرج هذا الأسبوع {0}" a={[<span key="0" className="font-bold text-ink"><Money minor={week.totalMinor} /></span>]} />}
      </span>
      <span className="mt-auto border-t border-line-soft pt-2 text-[11px] leading-snug sm:mt-3 sm:text-xs">
        {!known ? (
          <span className="text-muted">استورد كشفاً فيه عمود الرصيد.</span>
        ) : short ? (
          <span className="inline-flex items-start gap-1 font-bold text-danger">
            <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
            <T s="لا يكفي، ينقصه {0}" a={[<Money key="0" minor={out - cash.balanceMinor!} />]} />
          </span>
        ) : week !== null && out > 0 ? (
          <span className="inline-flex items-start gap-1 text-ok">
            <CircleCheck className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
            <span className="font-bold">
              {cash.stale && cash.asOfDay
                ? <T s="يكفي على رصيد {0}" a={[formatDay(cash.asOfDay)]} />
                : <T s="يكفي، ويتبقى {0}" a={[<Money key="0" minor={cash.balanceMinor! - out} />]} />}
            </span>
          </span>
        ) : (
          <span className="text-muted">{cash.asOfDay ? <T s="آخر رصيد معروف · {0}" a={[formatDay(cash.asOfDay)]} /> : "آخر رصيد معروف"}</span>
        )}
      </span>
    </Link>
  );
}
