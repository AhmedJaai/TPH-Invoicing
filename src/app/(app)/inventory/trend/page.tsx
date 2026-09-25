import { formatRiyalsDisplay } from "@/lib/money";
import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { History, Repeat, TrendingUp } from "lucide-react";
import { DataTable, EmptyState, LinkButton, LinkTabs, NoAccess, Section, Stat, StatGrid, type Column } from "@/components/ui";
import { COUNT, DIRECTION, MagnitudeBar, VarianceSplit, formatWeek } from "@/components/inventory-ui";
import { READINESS_LABEL } from "@/lib/inventory/coverage";
import { countNoun } from "@/lib/arabic";
import { Money } from "@/components/money";
import { listCounts, recurringVariances, type RecurringItem } from "@/services/inventory.service";
import { formatBp } from "@/lib/inventory/equation";
import { combineSummaries } from "@/lib/inventory/variance-summary";
import { formatSignedQuantity } from "@/lib/inventory/units";
import { todayInRiyadh } from "@/lib/riyadh-time";

export const dynamic = "force-dynamic";

/**
 * الاتّجاه — تحليلٌ تاريخيّ لا تنبّؤ.
 *
 * والسؤال: **أتتحسّن أم تسوء؟** لا «كم سيكون الأسبوع القادم». وقد
 * كُتب في هذا المستودع من قبل أنّ المقياس لا يقيس نفسه بنفسه؛ وهنا
 * القاعدةُ نفسها: يُعرَض ما وقع، ولا يُمدّ خطٌّ إلى المستقبل.
 */
const WINDOWS = [
  { key: "4", label: "آخر ٤ أسابيع", weeks: 4 },
  { key: "8", label: "آخر ٨ أسابيع", weeks: 8 },
  { key: "13", label: "آخر ٣ أشهر", weeks: 13 },
  { key: "26", label: "آخر ٦ أشهر", weeks: 26 },
];

export default async function InventoryTrendPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const params = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/login?from=/inventory/trend");
  if (!can(user.role, "inventory:view") || !can(user.role, "amounts:view")) {
    return (
      <PageShell user={user} width="wide" title="اتّجاه الجرد">
        <NoAccess what="الجرد" />
      </PageShell>
    );
  }

  const chosen = WINDOWS.find((w) => w.key === params.window) ?? WINDOWS[0];
  const since = new Date(Date.parse(`${todayInRiyadh()}T00:00:00Z`) - chosen.weeks * 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const all = await listCounts(80);
  const finalisedAll = all.filter((c) => c.status === "FINALISED").length;
  const inWindow = all.filter((c) => c.status === "FINALISED" && c.periodEnd >= since);
  const recurring = await recurringVariances(since);

  /*
    ── المقاديرُ تُجمَع، لا الصافي ──

    نقصُ أسبوعٍ لا تُطفئه زيادةُ أسبوعٍ آخر. فالمؤشّرُ الأوّل هو النقص،
    ويليه حجمُ الفروق، والصافي يُذكَر ثانويّاً ولا يقود.
  */
  const total = combineSummaries(inWindow.map((c) => c.summary));
  const counted = inWindow.length;
  const coveredWeeks = inWindow.filter((c) => c.readiness === "READY").length;

  const maxWeek = Math.max(1, ...inWindow.map((c) => Math.max(c.summary.shortageCostMinor, c.summary.overageCostMinor)));
  const chrono = [...inWindow].reverse();

  return (
    <PageShell
      user={user}
      width="wide"
      title="اتّجاه الجرد"
      intro="أتتحسّن أم تسوء؟ — تحليلٌ لما وقع، بلا تنبّؤ."
      actions={<LinkButton href="/inventory/history" size="sm" icon={History}>سجلّ الجرد</LinkButton>}
    >
      {/* المدّةُ لا تُختار قبل أن يوجد ما يُحلَّل */}
      {finalisedAll > 0 && (
        <LinkTabs
          label="مدّةُ التحليل"
          items={WINDOWS.map((w) => ({ href: `/inventory/trend?window=${w.key}`, label: w.label, active: w.key === chosen.key }))}
        />
      )}

      {inWindow.length === 0 ? (
        <div className={finalisedAll > 0 ? "mt-6" : ""}>
          <EmptyState
            icon={TrendingUp}
            title={finalisedAll === 0 ? "لا جردَ مقفَلاً بعد — والاتّجاه يحتاج جردين." : "لا جردَ مقفَلاً في هذه المدّة."}
            hint={finalisedAll === 0
              ? "الاتّجاه لا يُرى في نقطةٍ واحدة. أقفِل جردَين أسبوعيَّين فيظهر هنا أيتحسّن النقصُ أم يسوء — ولا يُمَدّ خطٌّ إلى ما لم يقع."
              : `في السجلّ ${countNoun(finalisedAll, COUNT)} مقفَل خارج هذه المدّة — وسِّعها.`}
            action={finalisedAll === 0
              ? <LinkButton href="/inventory" variant="primary" size="sm">إلى الجرد الحالي</LinkButton>
              : <LinkButton href="/inventory/trend?window=26" variant="primary" size="sm">آخر ٦ أشهر</LinkButton>}
          />
        </div>
      ) : (
        <>
          <div className="mt-6">
            <VarianceSplit
              shortage={total.shortageCostMinor}
              overage={total.overageCostMinor}
              linesShort={total.linesShort}
              linesOver={total.linesOver}
              showAmounts
              measured={total.linesMeasured > 0}
              foot={
                <StatGrid>
                  <Stat
                    label="النقصُ من كلفة الاستهلاك"
                    value={total.shortageRateBp === null ? "غير محسوبة" : formatBp(-total.shortageRateBp)}
                    sub={total.consumptionCostComplete ? "كم ضاع ممّا كان ينبغي أن يُصرَف" : "على ما عُرفت كلفتُه — المقامُ ناقص"}
                  />
                  <Stat
                    label="حجمُ الفروق"
                    minor={total.absoluteCostMinor}
                    sub={`نقصٌ وزيادة معاً · الصافي ${formatRiyalsDisplay(total.netCostMinor)}`}
                  />
                  <Stat label="جرداتٌ في المدّة" value={countNoun(counted, COUNT)} sub={`من ${formatWeek(chrono[0].periodStart, chrono[chrono.length - 1].periodEnd)}`} />
                  <Stat
                    label="تغطيتُها تامّة"
                    value={`${coveredWeeks} من ${counted}`}
                    tone={coveredWeeks < counted ? "warn" : undefined}
                    sub={coveredWeeks < counted ? "وما دونها جزئيّة — الفرقُ فيها ناقصٌ لا صغير" : "كلُّ ما بِيع دخل الحساب"}
                  />
                </StatGrid>
              }
            />
          </div>

          <Section
            title="أسبوعاً أسبوعاً"
            hint="النقصُ والزيادةُ شريطان متجاوران لكلّ أسبوع — لا يُطفئ أحدُهما الآخر. والأطولُ من الأكبر في المدّة."
          >
            <ul className="overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
              {chrono.map((c) => (
                <li key={c.id} className="border-b border-line-soft last:border-b-0">
                  <Link href={`/inventory/counts/${c.id}`} className="grid grid-cols-[minmax(0,1fr)] gap-x-5 gap-y-2 px-4 py-3 transition-colors hover:bg-hover sm:grid-cols-[11rem_minmax(0,1fr)_5rem]">
                    <span className="min-w-0">
                      <span className="block text-[13px] font-bold">{formatWeek(c.periodStart, c.periodEnd)}</span>
                      {c.readiness && c.readiness !== "READY" && (
                        <span className="mt-0.5 block text-[11px] text-warn">تقريرٌ {READINESS_LABEL[c.readiness]}</span>
                      )}
                    </span>
                    <span className="min-w-0 space-y-1.5">
                      {(["short", "over"] as const).map((d) => {
                        const minor = d === "short" ? c.summary.shortageCostMinor : c.summary.overageCostMinor;
                        return (
                          <span key={d} className="flex items-center gap-3">
                            <span className={`w-12 shrink-0 text-[11px] font-bold ${DIRECTION[d].text}`}>{DIRECTION[d].label}</span>
                            <span className="min-w-0 flex-1"><MagnitudeBar value={minor} max={maxWeek} direction={d} /></span>
                            <span className="w-24 shrink-0 text-end text-xs">{c.summary.linesMeasured === 0 ? <span className="text-muted">غير معروف</span> : <Money minor={minor} />}</span>
                          </span>
                        );
                      })}
                    </span>
                    <span className="text-xs text-muted sm:text-end">
                      <span className="nums">{c.summary.shortageRateBp === null ? "—" : formatBp(-c.summary.shortageRateBp)}</span>
                      <span className="block text-[10px]">من الاستهلاك</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title="أصنافٌ يتكرّر فيها الفرق"
            hint="المتكرّرُ الصغير مشكلةٌ في الطريقة — وصفةٌ أو جرعةٌ أو ميزان. والكبيرُ مرّةً واحدة حادثة. والأوّلُ هو ما يُصلَح."
          >
            <DataTable
              columns={recurringColumns}
              rows={recurring}
              keyOf={(r) => r.productId}
              hrefOf={(r) => `/inventory/items/${r.productId}`}
              empty={<EmptyState compact icon={Repeat} title="لا صنفَ تكرّر فيه فرقٌ في هذه المدّة." hint="يظهر هنا الصنفُ الذي ينقص أو يزيد في أكثر من جرد." />}
            />
          </Section>

          <p className="mt-6 rounded-xl border border-line bg-sunken/60 px-4 py-3 text-[11px] leading-relaxed text-ink-soft">
            الهدرُ المسجَّل مطروحٌ من هذه الأرقام أصلاً — فما تراه هنا هو <strong>الفرقُ غير المفسَّر</strong> وحده.
            وكلّما سُجّل هدرٌ أكثر صار هذا الرقمُ أصدقَ في وصف ما لا نعرف سببه.
          </p>
        </>
      )}
    </PageShell>
  );
}

const recurringColumns: readonly Column<RecurringItem>[] = [
  { key: "name", header: "الصنف", primary: true, cell: (r) => <span className="font-bold">{r.productName}</span> },
  {
    key: "pattern", header: "النمط",
    cell: (r) => (
      <span className={r.negativePeriods === r.periods && r.periods >= 2 ? "font-bold text-danger" : "text-ink-soft"}>
        نقصٌ في <span className="nums">{r.negativePeriods}</span> من <span className="nums">{r.periods}</span>
      </span>
    ),
  },
  { key: "qty", header: "النقصُ بالكمّيّة", numeric: true, cell: (r) => <span className="nums">{formatSignedQuantity(-r.shortageMilli, r.baseUnit)}</span> },
  { key: "worst", header: "أسوأُ نسبة", numeric: true, secondary: true, cell: (r) => <span className="nums text-muted">{formatBp(r.worstBp)}</span> },
  { key: "shortage", header: "النقص", numeric: true, cell: (r) => <Money minor={r.shortageCostMinor} tone={r.shortageCostMinor > 0 ? "danger" : undefined} /> },
  {
    key: "overage", header: "الزيادة", numeric: true, secondary: true,
    cell: (r) => r.overageCostMinor > 0 ? <span className="text-info"><Money minor={r.overageCostMinor} /></span> : <span className="text-muted">—</span>,
  },
];
