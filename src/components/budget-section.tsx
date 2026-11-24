import { PiggyBank } from "lucide-react";
import { Badge, Meter, Section, EmptyState, type Tone } from "@/components/ui";
import { Money } from "@/components/money";
import { BudgetEditor } from "@/components/budget-editor";
import { T } from "@/components/i18n/t";
import { BUDGET_LINES, budgetLabel, loadBudgetView } from "@/services/budget.service";
import type { BudgetState } from "@/lib/finance/budget";
import { formatMonth } from "@/lib/riyadh-time";

const STATE: Record<BudgetState, { label: string; tone: Tone }> = {
  OVER: { label: "تجاوز الميزانية", tone: "danger" },
  AHEAD: { label: "أسرع من الميزانية", tone: "warn" },
  NEAR: { label: "قارب الحد", tone: "warn" },
  UNKNOWN: { label: "غير معروف", tone: "muted" },
  UNDER: { label: "ضمن الميزانية", tone: "ok" },
};

/**
 * «الميزانية» في «الربح» — ما كتبتَه لكلّ باب مقابلَ ما صُرف فيه هذا الشهر (`loadBudgetView`).
 * وفي الشهر الجاري يُقاس بحصّة ما مضى منه لا بالشهر كلّه.
 */
export async function BudgetSection({ month, canEdit }: { month: string; canEdit: boolean }) {
  const v = await loadBudgetView(month);
  const editor = canEdit ? (
    /* مطويٌّ دائماً: ثمانيةُ حقولٍ فارغة في كلّ زيارةٍ لصفحة الربح ضجيجٌ لمن لم يقرّر ميزانية */
    <details className="mt-4 group">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs font-bold text-accent sm:min-h-6">
        {v.lines.length === 0 ? "اكتب ميزانية الشهر" : "عدّل الميزانية"}
      </summary>
      <div className="mt-3">
        <BudgetEditor fromMonth={month} fromLabel={formatMonth(month)} lines={BUDGET_LINES.map((l) => ({ line: l, label: budgetLabel(l), currentMinor: v.current[l] ?? null }))} />
      </div>
    </details>
  ) : null;

  return (
    <Section id="budget" title={`الميزانية — ${formatMonth(month)}`} icon={PiggyBank}
      hint={v.open ? "ما صُرف حتى اليوم مقابل ما كتبته لكل باب. وفي الشهر الجاري يُقاس بحصة ما مضى من الشهر." : "ما صُرف في الشهر مقابل ما كتبته لكل باب."}>
      {v.lines.length === 0 ? (
        <EmptyState compact icon={PiggyBank} title="لا ميزانية مكتوبة لهذا الشهر." hint="اكتب لكل باب حداً شهرياً، كتكلفة المبيعات والرواتب والإيجار، ليظهر هنا ما صُرف مقابله، ويصلك تنبيه حين يتجاوزه." />
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
          {v.lines.map((l) => {
            const s = STATE[l.state];
            return (
              <li key={l.line} className="rounded-xl border border-line bg-raised p-4 shadow-raised">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] font-bold">{l.label}</p>
                  <Badge tone={s.tone === "muted" ? undefined : s.tone} dot>{s.label}</Badge>
                </div>
                <p className="mt-2 text-lg font-bold">
                  {l.actualMinor === null ? <span className="text-sm font-medium text-muted">غير معروف</span> : <Money minor={l.actualMinor} />}
                  <span className="ms-1 text-xs font-medium text-muted"><T s="من {0}" a={[<Money key="0" minor={l.budgetMinor} />]} /></span>
                </p>
                <div className="mt-2">
                  <Meter value={l.actualMinor ?? 0} max={l.budgetMinor} tone={s.tone === "muted" ? "accent" : s.tone} label={`ما صُرف من ميزانية ${l.label}`} />
                </div>
                <p className="mt-1.5 text-[11px] text-muted">
                  {l.remainingMinor === null ? "لا يُعرف ما صُرف بعد" : l.remainingMinor >= 0
                    ? <T s="يبقى {0}" a={[<Money key="0" minor={l.remainingMinor} />]} />
                    : <span className="font-bold text-danger"><T s="تجاوز بـ{0}" a={[<Money key="0" minor={-l.remainingMinor} />]} /></span>}
                  {l.paceMinor !== null && <> · <T s="حصة ما مضى من الشهر {0}" a={[<Money key="0" minor={l.paceMinor} />]} /></>}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {editor}
    </Section>
  );
}
