import Link from "next/link";
import { isNull } from "drizzle-orm";
import { GitCompareArrows } from "lucide-react";
import { db } from "@/db";
import { vatFilings } from "@/db/schema";
import { Money } from "./money";
import { Section } from "./ui";
import { formatDay } from "@/lib/riyadh-time";
import { compareFiledQuarters, shareText, type FiledQuarter } from "@/lib/vat-compare";
import { parseVatPeriod, quarterLabel } from "@/lib/vat-return";

function labelOf(q: FiledQuarter): string {
  const p = parseVatPeriod(q.periodKey);
  return p && p.kind === "quarter" ? quarterLabel(p) : q.periodKey;
}

const unknown = <span className="text-[11px] text-muted">غير محفوظ</span>;

/**
 * الأرباعُ المقدَّمة جنباً إلى جنب (`lib/vat-compare.ts`) — من لقطات «قدّمتُه» كما قُدِّمت،
 * لا من حسابِ اليوم. يظهر حين يُقدَّم ربعان، وتحته أكبرُ ما حرّك الصافي بينهما.
 */
export async function FiledQuartersSection() {
  const rows = await db.select().from(vatFilings).where(isNull(vatFilings.voidedAt));
  const c = compareFiledQuarters(rows);
  if (c.quarters.length < 2 || !c.latest) return null;
  const { previous, current, netChangeMinor, drivers } = c.latest;
  const shown = c.quarters.slice(-4);

  const line = (label: string, pick: (q: FiledQuarter) => React.ReactNode, strong = false) => (
    <tr className="border-t border-line-soft">
      <th scope="row" className={`px-3 py-2 text-start text-xs ${strong ? "font-bold" : "font-medium text-ink-soft"}`}>{label}</th>
      {shown.map((q) => (
        <td key={q.periodKey} className={`px-3 py-2 text-end text-[13px] ${strong ? "font-bold" : ""}`}>{pick(q)}</td>
      ))}
    </tr>
  );

  return (
    <Section
      id="quarters"
      title="الأرباع المقدّمة جنباً إلى جنب"
      icon={GitCompareArrows}
      hint="كما قدّمت للهيئة — من لقطة «قدّمته»، لا من حساب اليوم."
    >
      <div className="scroll-x overflow-x-auto rounded-xl border border-line bg-raised">
        <table className="w-full min-w-[30rem] border-collapse">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 text-start text-[11px] font-bold text-muted">البند</th>
              {shown.map((q) => (
                <th key={q.periodKey} scope="col" className="px-3 py-2 text-end text-[11px] font-bold text-muted">
                  <Link href={`/close/vat?period=${q.periodKey}`} className="hover:text-accent hover:underline">{labelOf(q)}</Link>
                  <span className="block font-normal">قدّم {formatDay(q.filedOn)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {line("ضريبة المبيعات", (q) => <Money minor={q.outputVatMinor} />)}
            {line("خصم الفواتير", (q) => (q.fromInvoicesMinor === null ? unknown : <Money minor={q.fromInvoicesMinor} />))}
            {line("خصم ضريبة الرسوم", (q) => (q.fromFeesMinor === null ? unknown : <Money minor={q.fromFeesMinor} />))}
            {line("خصم ما اخترته", (q) => (q.fromSelectedMinor === null ? unknown : <Money minor={q.fromSelectedMinor} />))}
            {line("مجموع المدخلات", (q) => <Money minor={q.inputVatMinor} />)}
            {line("المدخلات من المخرجات", (q) => (q.inputShareBp === null
              ? <span className="text-[11px] text-muted">لا مخرجات</span>
              : <bdi className="nums" dir="ltr">{shareText(q.inputShareBp)}</bdi>))}
            {line("الصافي (سالب: رصيد لك)", (q) => <Money minor={q.netMinor} signed />, true)}
          </tbody>
        </table>
      </div>

      <div className="mt-3 rounded-xl border border-line bg-raised px-4 py-3 text-xs leading-relaxed">
        <p className="font-bold">
          {netChangeMinor === 0
            ? `صافي ${labelOf(current)} يساوي صافي ${labelOf(previous)}.`
            : <>صافي {labelOf(current)} {netChangeMinor > 0 ? "أعلى" : "أدنى"} من {labelOf(previous)} بـ<Money minor={Math.abs(netChangeMinor)} /> — أكبر ما حرّكه:</>}
        </p>
        {drivers.length > 0 && (
          <ul className="mt-2 space-y-1 text-ink-soft">
            {drivers.map((d) => (
              <li key={d.label} className="flex flex-wrap items-baseline justify-between gap-2">
                <span>{d.label}</span>
                <span className="font-bold text-ink">
                  {d.effectMinor > 0 ? "رفعه " : "خفضه "}<Money minor={Math.abs(d.effectMinor)} />
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-muted">
          لمعرفة أيّ مورّد أو حوالة وراء الباب افتح الربع من رأس الجدول — فواتيره وحركاته بأسمائها هناك.
        </p>
      </div>
    </Section>
  );
}
