import { formatRiyalsDisplay } from "@/lib/money";
import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Card, EmptyState, NoAccess, Section, Stat, StatGrid, buttonClass } from "@/components/ui";
import { Money } from "@/components/money";
import { listCounts, recurringVariances } from "@/services/inventory.service";
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
  const worstRate = Math.max(1, ...inWindow.map((c) => c.summary.shortageRateBp ?? 0));

  return (
    <PageShell
      user={user}
      width="wide"
      title="اتّجاه الجرد"
      intro="أتتحسّن أم تسوء؟ — تحليلٌ لما وقع، بلا تنبّؤ."
      actions={<Link href="/inventory/history" className={buttonClass("secondary", "sm")}>سجلّ الجرد</Link>}
    >
      <div className="flex flex-wrap gap-2">
        {WINDOWS.map((w) => (
          <Link
            key={w.key}
            href={`/inventory/trend?window=${w.key}`}
            className={buttonClass(w.key === chosen.key ? "primary" : "secondary", "sm")}
          >
            {w.label}
          </Link>
        ))}
      </div>

      {inWindow.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="لا جردَ مقفَلاً في هذه المدّة."
            hint="يمتلئ الاتّجاه بعد أوّل جردين — فالاتّجاه لا يُرى في نقطةٍ واحدة."
          />
        </div>
      ) : (
        <>
          <div className="mt-6">
            <StatGrid>
              <Stat
                label="النقص"
                minor={total.shortageCostMinor}
                tone={total.shortageCostMinor > 0 ? "danger" : undefined}
                sub={`في ${total.linesShort} سطراً — ولا تُطفئه زيادةٌ في غيره`}
              />
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
              <Stat
                label="أسابيعُ تغطيتُها تامّة"
                value={`${coveredWeeks} من ${counted}`}
                sub={coveredWeeks < counted ? "وما دونها تقاريرُ جزئيّة — الفرقُ فيها ناقصٌ لا صغير" : undefined}
              />
            </StatGrid>
          </div>

          <Section title="أسبوعاً أسبوعاً">
            <ul className="divide-y divide-line rounded-2xl border border-line bg-raised">
              {inWindow.map((c) => {
                /* طولُ الشريط من نسبة النقص — فالأسابيعُ تُقارَن لا الريالات */
                const magnitude = Math.min(100, ((c.summary.shortageRateBp ?? 0) * 100) / worstRate);
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                    <Link href={`/inventory/counts/${c.id}`} className="nums w-44 shrink-0 text-xs font-bold hover:underline">
                      {c.periodStart} → {c.periodEnd}
                    </Link>
                    <span className="hidden h-2 min-w-0 flex-1 rounded-full bg-sunken sm:block" aria-hidden>
                      <span className="block h-2 rounded-full bg-danger" style={{ width: `${magnitude}%` }} />
                    </span>
                    <span className="nums w-28 text-end text-xs">
                      نقص <Money minor={c.summary.shortageCostMinor} tone={c.summary.shortageCostMinor > 0 ? "danger" : undefined} />
                    </span>
                    <span className="nums w-28 text-end text-xs text-muted">
                      زيادة <Money minor={c.summary.overageCostMinor} />
                    </span>
                    <span className="nums w-16 text-end text-xs text-muted">
                      {c.summary.shortageRateBp === null ? "—" : formatBp(-c.summary.shortageRateBp)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section
            title="أصنافٌ يتكرّر فيها الفرق"
            hint="المتكرّرُ الصغير مشكلةٌ في الطريقة — وصفةٌ أو جرعةٌ أو ميزان. والكبيرُ مرّةً واحدة حادثة. والأوّلُ هو ما يُصلَح."
          >
            {recurring.length === 0 ? (
              <Card>
                <p className="text-xs text-muted">لا صنفَ تكرّر فيه فرقٌ في هذه المدّة.</p>
              </Card>
            ) : (
              <ul className="divide-y divide-line rounded-2xl border border-line bg-raised">
                {recurring.map((r) => (
                  <li key={r.productId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                    <Link href={`/inventory/items/${r.productId}`} className="min-w-0 flex-1 text-xs font-bold hover:underline">
                      {r.productName}
                    </Link>
                    <span className="nums text-[11px] text-muted">
                      نقص في {r.negativePeriods} من {r.periods}
                    </span>
                    <span className="nums text-[11px] text-muted">
                      {formatSignedQuantity(-r.shortageMilli, r.baseUnit)}
                    </span>
                    <span className="nums w-16 text-end text-xs text-muted">{formatBp(r.worstBp)}</span>
                    <span className="nums w-24 text-end text-xs">
                      <Money minor={r.shortageCostMinor} tone={r.shortageCostMinor > 0 ? "danger" : undefined} />
                    </span>
                    {r.overageCostMinor > 0 && (
                      <span className="nums w-24 text-end text-[11px] text-muted">
                        وزيادة <Money minor={r.overageCostMinor} />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <p className="mt-6 rounded-xl border border-line bg-sunken px-3 py-2.5 text-[11px] leading-relaxed text-ink-soft">
            الهدرُ المسجَّل مطروحٌ من هذه الأرقام أصلاً — فما تراه هنا هو <strong>الفرقُ غير
            المفسَّر</strong> وحده. وكلّما سُجّل هدرٌ أكثر صار هذا الرقمُ أصدقَ في وصف ما
            لا نعرف سببه.
          </p>
        </>
      )}
    </PageShell>
  );
}
