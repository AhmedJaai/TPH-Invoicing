import { CalendarClock, Landmark, Wallet } from "lucide-react";
import { Money } from "./money";
import { Callout, DataTable, KeyFigure, LinkButton, type Column } from "./ui";
import { formatDay, formatMonth } from "@/lib/riyadh-time";
import type { CashNeedCell, CashNeedRow } from "@/lib/finance/cash-need";
import type { CashNeed } from "@/services/cash-need.service";
import { T } from "@/components/i18n/t";

/**
 * النقدُ المطلوب للأشهر الثلاثة القادمة — الجوابُ أوّلاً (كم، وهل يكفي رصيدُك)، ثمّ من أين جاء الرقم شهراً بشهر
 * وبنداً بندا. وما قُدِّر يُسمّى «تقدير» في خليّته؛ وما لا يُعرف «غير معروف»، لا صفراً.
 */
type Line = CashNeedRow | { key: "TOTAL"; label: string; hint: string; cells: CashNeedCell[]; totalMinor: number };

function CellView({ cell }: { cell: CashNeedCell }) {
  return (
    <span className="block">
      {cell.minor === null ? <span className="text-muted">غير معروف</span> : <Money minor={cell.minor} />}
      {cell.estimate && <span className="ms-1.5 rounded bg-sunken px-1 py-0.5 text-[10px] font-bold text-muted">تقدير</span>}
      {cell.note && <span className="mt-0.5 block text-[11px] font-normal leading-snug text-muted">{cell.note}</span>}
    </span>
  );
}

export function CashNeedPanel({ need }: { need: CashNeed }) {
  const { plan, averages, coverage, balanceMinor, balanceAsOf } = need;
  const first = plan.months[0];
  const last = plan.months[plan.months.length - 1];
  const rows: Line[] = [
    ...plan.rows,
    { key: "TOTAL", label: "المجموع", hint: "", cells: plan.monthTotals.map((minor) => ({ minor, estimate: false })), totalMinor: plan.totalMinor },
  ];
  const columns: Column<Line>[] = [
    {
      key: "label", header: "البند", primary: true,
      cell: (r) => (
        <span className={r.key === "TOTAL" ? "font-bold" : undefined}>
          {r.label}
          {r.hint && <span className="block text-[11px] font-normal text-muted">{r.hint}</span>}
        </span>
      ),
    },
    ...plan.months.map((m, i): Column<Line> => ({ key: m, header: formatMonth(m), numeric: true, cell: (r) => <CellView cell={r.cells[i]} /> })),
    { key: "total", header: "الثلاثة أشهر", numeric: true, cell: (r) => <span className="font-bold"><Money minor={r.totalMinor} /></span> },
  ];
  /* المسيّر أكبرُ بكثير ممّا خرج من البنك للرواتب؟ يُقال، فقد يكون بعضُه يُدفع من خارج الحساب فلا يلزمه رصيد */
  const payrollMonth = plan.rows.find((r) => r.key === "PAYROLL")?.cells[0].minor ?? null;
  const salaryGap = payrollMonth !== null && averages.salaryPerMonthMinor !== null && averages.salaryPerMonthMinor > 0 && payrollMonth > averages.salaryPerMonthMinor * 1.25;
  const withDraws = averages.ownerDrawsPerMonthMinor === null ? null : plan.totalMinor + averages.ownerDrawsPerMonthMinor * plan.months.length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        <KeyFigure
          icon={CalendarClock}
          label="نحتاج في الأشهر الثلاثة"
          period={`${formatMonth(first)} إلى ${formatMonth(last)}`}
          value={<Money minor={plan.totalMinor} currency />}
          sub={plan.estimateMinor > 0 ? <T s="منه {0} تقدير بمتوسط الأشهر الماضية" a={[<Money key="0" minor={plan.estimateMinor} />]} /> : "كلّه معروف"}
        />
        <KeyFigure
          icon={Landmark}
          label="رصيد البنك اليوم"
          value={balanceMinor === null ? <span className="text-xl text-muted">غير معروف</span> : <Money minor={balanceMinor} currency />}
          sub={balanceAsOf ? `حسب كشف ${formatDay(balanceAsOf)}` : "لا كشف مسوّى برصيد"}
          href="/bank"
        />
        {coverage ? (
          <KeyFigure
            icon={Wallet}
            label={coverage.covered ? "يزيد الرصيد على الحاجة" : "ينقصك قبل أن تدخل المبيعات"}
            tone={coverage.covered ? "ok" : "warn"}
            value={<Money minor={Math.abs(coverage.gapMinor)} currency />}
            sub={coverage.covered ? "لو لم يدخل الحساب شيء من المبيعات" : "تغطّيه مبيعات الشبكة التي تُودَع تباعاً"}
          />
        ) : (
          <KeyFigure icon={Wallet} label="الرصيد مقابل الحاجة" value={<span className="text-xl text-muted">غير معروف</span>} sub="يلزم كشف بنك برصيد" href="/bank" />
        )}
      </div>

      <DataTable rows={rows} columns={columns} keyOf={(r) => r.key} />

      <ul className="space-y-1.5 text-xs leading-relaxed text-ink-soft">
        <li>
          {averages.depositsPerMonthMinor !== null
            ? <T s="الرقم مبلغٌ يخرج فقط، ولا يدخله ما سيدخل من المبيعات. للمقارنة: أُودع من مبيعات الشبكة نحو {0} شهرياً في آخر ثلاثة أشهر." a={[<Money key="0" minor={averages.depositsPerMonthMinor} />]} />
            : "الرقم مبلغٌ يخرج فقط، ولا يدخله ما سيدخل من المبيعات."}
        </li>
        {salaryGap && payrollMonth !== null && averages.salaryPerMonthMinor !== null && (
          <li><T s="الرواتب هنا من المسيّر ({0} شهرياً)، بينما خرج من البنك للرواتب نحو {1} شهرياً في آخر ثلاثة أشهر. فإن كان الفرق يُدفع من خارج الحساب فلا يلزمه رصيد." a={[<Money key="0" minor={payrollMonth} />, <Money key="1" minor={averages.salaryPerMonthMinor} />]} /></li>
        )}
        {withDraws !== null && averages.ownerDrawsPerMonthMinor !== null && averages.ownerDrawsPerMonthMinor > 0 && (
          <li><T s="ولا يشمل سحوباتك الشخصية المعتادة (نحو {0} شهرياً)؛ ومعها تصير الحاجة {1}." a={[<Money key="0" minor={averages.ownerDrawsPerMonthMinor} />, <Money key="1" minor={withDraws} />]} /></li>
        )}
        <li>المورّدون والمعتاد غير المسجّل بمتوسط آخر ثلاثة أشهر من كشف البنك، فتتأثر بالدفعات الكبيرة فيها. والرواتب بالراتب المكتوب قبل أي خصم أو إضافة لم تقع بعد.</li>
      </ul>

      {plan.beyond.length > 0 && (
        <Callout tone="accent" icon={CalendarClock} title="بعد الأشهر الثلاثة مباشرة">
          {plan.beyond.map((p) => (
            <span key={`${p.category}:${p.dueMonth}`} className="block">
              <T s="{0}: {1} في {2}{3}. جنّب له من الآن." a={[p.label, <Money key="1" minor={p.estimateMinor} />, <bdi key="2">{p.dueDay ? formatDay(p.dueDay) : formatMonth(p.dueMonth)}</bdi>, p.scheduled ? "" : " (تقدير بمبلغ آخر دفعة)"]} />
            </span>
          ))}
        </Callout>
      )}

      {plan.unknown.length > 0 && (
        <Callout tone="warn" icon={Wallet} title="مبالغ لا تُعرف بعد، فلم تدخل المجموع">
          {plan.unknown.map((u) => <span key={u} className="block">{u}</span>)}
          <span className="mt-2 flex flex-wrap gap-2">
            <LinkButton href="/settings#recurring" size="sm" variant="quiet">المصروفات المتكررة</LinkButton>
            <LinkButton href="/bank" size="sm" variant="quiet">كشف البنك</LinkButton>
          </span>
        </Callout>
      )}
    </div>
  );
}
