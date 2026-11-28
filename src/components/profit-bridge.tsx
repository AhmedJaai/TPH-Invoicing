import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, Info } from "lucide-react";
import { Money } from "./money";
import { Card } from "./ui";
import { T } from "@/components/i18n/t";
import { formatMonth } from "@/lib/riyadh-time";
import type { ProfitBridge } from "@/lib/finance/bridge";

const SHOWN = 6;

/**
 * «لماذا تغيّر الربح عن الشهر السابق؟» — الأسبابُ مرتّبةً بأثرها، وكلٌّ يفتح صفوفه.
 *
 * شريطٌ يمتدّ من منتصفٍ واحد: ما رفع الربحَ إلى جهة، وما أنقصه إلى الأخرى. اللونُ ليس
 * وحده الحامل: السهمُ والإشارةُ والكلمة («رفع»/«أنقص») مع كلّ صفّ. والقيمتان في الشهرين
 * مكتوبتان تحت الاسم — الجدولُ والرسمُ شيءٌ واحد هنا.
 */
export function ProfitBridgeCard({ bridge, month, previous, profitLabel, hrefOf }: {
  bridge: ProfitBridge;
  month: string;
  previous: string;
  profitLabel: string;
  hrefOf: (id: string) => string | null;
}) {
  const shown = bridge.drivers.slice(0, SHOWN);
  const rest = bridge.drivers.slice(SHOWN);
  const restMinor = bridge.changeMinor - shown.reduce((s, d) => s + d.impactMinor, 0);
  const max = Math.max(1, ...shown.map((d) => Math.abs(d.impactMinor)), Math.abs(restMinor));
  const up = bridge.changeMinor >= 0;

  return (
    <Card padded={false}>
      <div className="border-b border-line-soft px-4 py-3.5 sm:px-5">
        <p className="text-[11px] font-bold text-muted">
          <T s="لماذا تغيّر عن {0}؟" a={[formatMonth(previous)]} />
        </p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[15px] font-bold leading-snug">
          <span className={`inline-flex items-center gap-1 ${up ? "text-ok" : "text-danger"}`}>
            {up ? <ArrowUp className="h-4 w-4 self-center" strokeWidth={2.5} aria-hidden /> : <ArrowDown className="h-4 w-4 self-center" strokeWidth={2.5} aria-hidden />}
            {up ? "ارتفع" : "انخفض"}
          </span>
          <span><T s="{0} بـ{1}" a={[profitLabel.split(" — ")[0], <Money key="1" minor={Math.abs(bridge.changeMinor)} currency />]} /></span>
        </p>
        <p className="mt-0.5 text-[11px] text-muted">
          <T s="الأسباب أدناه مجموعها الفرق نفسه، وكل سبب يفتح الصفوف التي كوّنته في {0}." a={[formatMonth(month)]} />
        </p>
      </div>
      <ol className="divide-y divide-line-soft">
        {shown.map((d) => {
          const href = hrefOf(d.id);
          const raised = d.impactMinor > 0;
          const pct = `${Math.max(2, (Math.abs(d.impactMinor) / max) * 100)}%`;
          const body = (
            <>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-bold">{d.label}</span>
                <span className="block text-[11px] text-muted">
                  {d.previousMinor === null ? <span>لا شيء مسجّل</span> : <Money minor={d.previousMinor} />}
                  <span aria-hidden className="mx-1">←</span>
                  <span className="sr-only"> ثم </span>
                  {d.currentMinor === null ? <span>لا شيء مسجّل</span> : <Money minor={d.currentMinor} />}
                </span>
              </span>
              {/* منتصفٌ واحد: الرافعُ إلى البداية والمُنقِصُ إلى النهاية */}
              <span aria-hidden className="grid grid-cols-2 items-center">
                <span className="flex h-2.5 justify-end">{!raised && <span className="h-full rounded-s-full bg-sand" style={{ width: pct }} />}</span>
                <span className="flex h-2.5 justify-start border-s border-line">{raised && <span className="h-full rounded-e-full bg-accent" style={{ width: pct }} />}</span>
              </span>
              <span className="text-end text-[13px] font-bold">
                <span className="sr-only">{raised ? "رفع الربح " : "أنقص الربح "}</span>
                <Money minor={d.impactMinor} signed />
                <span aria-hidden className="block text-[10px] font-normal text-muted">{raised ? "رفع الربح" : "أنقص الربح"}</span>
              </span>
            </>
          );
          const cls = "grid min-h-12 grid-cols-[minmax(0,1fr)_4.5rem_6.5rem] items-center gap-3 px-4 py-2 sm:grid-cols-[minmax(0,1fr)_8rem_7.5rem] sm:px-5";
          return (
            <li key={d.id}>
              {href ? (
                <Link href={href} className={`${cls} group transition-colors hover:bg-hover`}>
                  {body}
                </Link>
              ) : <div className={cls}>{body}</div>}
            </li>
          );
        })}
        {rest.length > 0 && Math.abs(restMinor) >= 100 && (
          <li className="flex min-h-11 items-center justify-between gap-3 px-4 py-2 text-[12px] text-ink-soft sm:px-5">
            <span><T s="{0} أبواب أخرى" a={[rest.length]} /></span>
            <Money minor={restMinor} signed />
          </li>
        )}
      </ol>
      {bridge.caveats.length > 0 && (
        <ul className="space-y-1 border-t border-line-soft bg-warn-bg/50 px-4 py-2.5 text-[11px] leading-relaxed text-ink-soft sm:px-5">
          {bridge.caveats.map((c) => (
            <li key={c} className="flex items-start gap-1.5"><Info className="mt-0.5 h-3 w-3 shrink-0 text-warn" aria-hidden />{c}</li>
          ))}
        </ul>
      )}
      <Link href={`/finance?month=${previous}`} className="no-print flex min-h-11 items-center justify-end gap-1 border-t border-line-soft px-4 text-[12px] font-bold text-accent hover:bg-hover sm:px-5">
        <T s="افتح {0}" a={[formatMonth(previous)]} />
        <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-0 ltr:rotate-180" aria-hidden />
      </Link>
    </Card>
  );
}
