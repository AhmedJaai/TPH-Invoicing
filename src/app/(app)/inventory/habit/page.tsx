import { redirect } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Callout, DataTable, EmptyState, LinkButton, NoAccess, type Column } from "@/components/ui";
import { formatRange } from "@/lib/riyadh-time";
import {
  HABIT_MIN_DAYS_PER_WEEK, HABIT_MIN_WEEKS, HABIT_WEEKS, WEEKDAY_LABEL, unitsText, type ItemHabit,
} from "@/lib/sales/weekday-habit";
import { loadWeekdayHabit } from "@/services/weekday-habit.service";
import { T } from "@/components/i18n/t";

export const dynamic = "force-dynamic";

/** كم صنفاً يُعرض — الأكثرُ بيعاً أوّلاً؛ والباقي يُقال عددُه. */
const SHOWN = 40;

/**
 * عادةُ البيع — كم يُباع عادةً من كلّ صنفٍ في كلّ يومٍ من الأسبوع (`lib/sales/weekday-habit.ts`).
 * وسيطُ ما بيع فعلاً بأدناه وأعلاه؛ **لا تنبّؤ** ولا خطٌّ إلى المستقبل.
 */
export default async function HabitPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/inventory/habit");
  if (!can(user.role, "inventory:view")) {
    return (
      <PageShell user={user} title="نمط البيع">
        <NoAccess what="الجرد" />
      </PageShell>
    );
  }

  const h = await loadWeekdayHabit();
  const canImport = can(user.role, "inventory:count");

  const columns: readonly Column<ItemHabit>[] = [
    { key: "item", header: "الصنف", primary: true, cell: (i) => <span className="font-bold" dir="auto">{i.itemName}</span> },
    ...WEEKDAY_LABEL.map((label, wd): Column<ItemHabit> => ({
      key: `d${wd}`,
      header: label,
      numeric: true,
      cell: (i) => {
        const s = i.byWeekday[wd];
        if (s.medianMilli === null || s.minMilli === null || s.maxMilli === null) return <span className="text-[11px] text-muted">غير معروف</span>;
        return (
          <span className="block">
            <span className="nums block font-bold">{unitsText(s.medianMilli)}</span>
            <span className="nums block text-[11px] font-normal text-muted" dir="ltr">{unitsText(s.minMilli)}–{unitsText(s.maxMilli)}</span>
          </span>
        );
      },
    })),
  ];

  return (
    <PageShell
      user={user}
      width="wide"
      title="نمط البيع"
      intro="كم يُباع عادةً من كل صنف في كل يوم من أيام الأسبوع. الرقم الكبير هو الوسيط لما بيع فعلاً، وتحته أقل كمية وأكثرها. هذا نمط بيع وليس توقعاً، ويفيدك في التحضير والطلب."
    >
      {!h.ready ? (
        <EmptyState
          icon={CalendarRange}
          title={`لا يمكن تحديد نمط البيع بعد: ${h.usableWeeks.length} من ${HABIT_MIN_WEEKS} أسابيع`}
          hint={`يلزم ${HABIT_MIN_WEEKS} أسابيع على الأقل من آخر ${HABIT_WEEKS} (${formatRange(h.windowStart, h.windowEnd)})، في كل منها ${HABIT_MIN_DAYS_PER_WEEK} أيام بمبيعات مستوردة. ${h.droppedWeeks.length > 0 ? `${h.droppedWeeks.length} منها ناقصة الأيام أو بلا ملف.` : ""}`}
          action={canImport ? <LinkButton href="/inventory/import" variant="primary" size="sm">استورد مبيعات فودكس</LinkButton> : undefined}
        />
      ) : (
        <>
          <Callout tone="info" icon={CalendarRange} title={`مبني على ${h.usableWeeks.length} أسابيع: ${formatRange(h.windowStart, h.windowEnd)}`}>
            <T s="تُحسب أسطر المنتجات فقط، دون الإضافات والمبيعات الملغاة والمرتجعة. اليوم الذي لا توجد فيه أي عملية بيع في الملف لا يدخل الحساب، لأنه يوم إغلاق أو بياناته ناقصة. أما اليوم الذي بيعت فيه أصناف أخرى ولم يُبع فيه هذا الصنف فيُحسب صفراً حقيقياً.{0}" a={[h.droppedWeeks.length > 0 && ` استُبعد ${h.droppedWeeks.length} من أسابيع الفترة لنقص أيامها.`]} /></Callout>
          <div className="mt-5">
            <DataTable columns={columns} rows={h.items.slice(0, SHOWN)} keyOf={(i) => i.itemId} searchOf={(i) => i.itemName} />
          </div>
          {h.items.length > SHOWN && (
            <p className="mt-3 text-[11px] text-muted"><T s="يعرض أكثر {0} صنفاً مبيعاً من أصل {1}." a={[SHOWN, h.items.length]} /></p>
          )}
        </>
      )}
    </PageShell>
  );
}
