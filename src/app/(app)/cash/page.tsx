import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, CircleAlert, Info, Landmark, Plus, Repeat, Store, TriangleAlert } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Callout, EmptyState, KeyFigure, LinkButton, NoAccess } from "@/components/ui";
import { SUPPLIER, countNoun } from "@/lib/arabic";
import { formatDay } from "@/lib/riyadh-time";
import { loadCashOutlook } from "@/services/cash-outlook.service";
import type { OutlookBucket } from "@/lib/cash-outlook";

export const dynamic = "force-dynamic";

/**
 * النقد القادم — ما يخرج، ومتى، ومقابل أيّ رصيد.
 *
 * إسقاطٌ من المعلوم وحده (`lib/cash-outlook.ts`): دفعةُ الشهر المنقضي،
 * وفواتيرُ هذا الشهر حتى اليوم، والمصروفاتُ المتكرّرة المسجّلة. والوارد
 * لا يُحسَب لأنّ المبيعات غير موصولة — فخطُّ الرصيد حدٌّ أدنى، ويُقال.
 */
export default async function CashPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/cash");
  if (!can(user.role, "bank:view")) {
    return (
      <PageShell user={user} width="wide" title="النقد القادم">
        <NoAccess what="النقد القادم" />
      </PageShell>
    );
  }

  const o = await loadCashOutlook();
  const overdue = o.buckets.find((b) => b.id === "overdue");
  const nextRun = o.buckets.find((b) => b.id === "next-run");
  const balanceKnown = o.balanceMinor !== null;

  return (
    <PageShell
      user={user}
      width="wide"
      title="النقد القادم"
      intro="ما يخرج من الحساب في الأسابيع القادمة ممّا هو معلوم وحده — دفعاتُ المورّدين والمصروفاتُ المتكرّرة — مقابل آخر رصيدٍ معروف."
      actions={
        <LinkButton href="/settings#recurring" icon={Plus} variant="secondary">
          مصروفٌ متكرّر
        </LinkButton>
      }
    >
      {/* ── الأرقام الثلاثة ── */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        <KeyFigure
          icon={Landmark}
          label="آخرُ رصيدٍ معروف"
          value={balanceKnown ? <Money minor={o.balanceMinor as number} /> : <span className="text-xl text-muted">غير معروف</span>}
          sub={balanceKnown ? `في ${formatDay(o.balanceAsOf)} — وما دخل وخرج بعده لم يُحسب` : "لا كشفَ يحمل الرصيد. استورد كشفاً فيه عمودُ الرصيد، أو أدخله عند الإقفال."}
          href={balanceKnown ? "/bank" : "/bank#import"}
        />
        <KeyFigure
          icon={TriangleAlert}
          tone={overdue ? "danger" : undefined}
          label="متأخّرٌ الآن"
          value={<Money minor={overdue?.totalMinor ?? 0} />}
          sub={overdue ? `${countNoun(overdue.lines.length, SUPPLIER)} من دفعة الشهر الماضي لم يُحوَّل لهم` : "لا شيء متأخّر من دفعة الشهر الماضي."}
          href="/payments"
        />
        <KeyFigure
          icon={CalendarClock}
          label="يخرج حتى آخر الشهر القادم"
          value={<Money minor={o.totalMinor} />}
          sub={
            balanceKnown && o.buckets.length > 0
              ? o.shortfallAt
                ? "يقصر عنه الرصيدُ المعروف — انظر أين أدناه."
                : "يغطّيه الرصيدُ المعروف."
              : "مجموعُ ما في الجدول الزمنيّ أدناه."
          }
        />
      </div>

      <Callout tone="info" icon={Info} className="mt-4">
        <strong className="text-ink">إسقاطٌ لا توقّع:</strong> الواردُ غير محسوب لأنّ مبيعات فودكس غير موصولة، والمصروفُ الذي لم يُسجَّل متكرّراً لا يظهر.
        فالرصيدُ بعد كلّ مرحلةٍ حدٌّ أدنى لما سيبقى.
        {o.heldMinor > 0 && <> ومحجوزٌ <Money minor={o.heldMinor} /> حتى تصل الفواتيرُ الصحيحة — لا يُحسب هنا.</>}
      </Callout>

      {/* ── الجدول الزمنيّ ── */}
      <section className="mt-10">
        <h2 className="mb-4 text-base font-bold">ما يخرج، ومتى</h2>
        {o.buckets.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="لا خروجَ معروفاً في الأسابيع القادمة."
            hint="لا دفعة مورّدين مفتوحة، ولا مصروفات متكرّرة مسجّلة. سجّل الإيجار والرواتب متكرّرةً ليظهر خروجُها هنا في يومه."
            action={<LinkButton href="/settings#recurring" variant="primary" icon={Plus}>سجّل مصروفاً متكرّراً</LinkButton>}
          />
        ) : (
          <ol className="relative space-y-4">
            {o.buckets.map((b, i) => (
              <BucketCard key={b.id} bucket={b} last={i === o.buckets.length - 1} shortfall={o.shortfallAt === b.id} />
            ))}
          </ol>
        )}
      </section>

      {o.recurringCount === 0 && o.buckets.length > 0 && (
        <Callout
          tone="accent"
          icon={Repeat}
          className="mt-6"
          title="الإيجار والرواتب لا يظهران بعد"
          action={<LinkButton href="/settings#recurring" variant="primary" size="sm" icon={Plus}>سجّلها</LinkButton>}
        >
          لا مصروف متكرّراً مسجّلاً — فالجدولُ أعلاه دفعاتُ المورّدين وحدها. سجّل ما يتكرّر كلَّ شهرٍ بيومه فيدخل الإسقاط.
        </Callout>
      )}

      {nextRun && (
        <p className="mt-6 text-xs leading-relaxed text-muted">
          دفعةُ الشهر القادم تُبنى من الفواتير المسجّلة حتى اليوم وتكبر مع كلّ فاتورةٍ تصل — ودفعةُ الشهر الماضي تُعتمَد من{" "}
          <Link href="/payments" className="font-bold text-accent hover:underline">دفعة الشهر</Link>.
        </p>
      )}
    </PageShell>
  );
}

const DOT = { danger: "bg-danger", warn: "bg-warn", neutral: "bg-accent" } as const;

function BucketCard({ bucket: b, last, shortfall }: { bucket: OutlookBucket; last: boolean; shortfall: boolean }) {
  return (
    <li className="relative ps-8">
      {!last && <span aria-hidden className="absolute start-[11px] top-6 -bottom-4 w-px bg-line" />}
      <span aria-hidden className={`absolute start-1 top-1.5 h-4 w-4 rounded-full border-4 border-surface ${DOT[b.tone]}`} />
      <article className="overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line-soft px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold">{b.title}</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{b.when}</p>
          </div>
          <div className="text-end">
            <p className="text-lg font-bold"><Money minor={b.totalMinor} /></p>
            {b.afterMinor !== null && (
              <p className={`mt-0.5 text-[11px] ${b.afterMinor < 0 ? "font-bold text-danger" : "text-muted"}`}>
                يبقى بعدها ≥ <Money minor={b.afterMinor} />
              </p>
            )}
          </div>
        </header>
        {shortfall && (
          <p className="flex items-center gap-2 bg-danger-bg px-4 py-2 text-xs font-bold text-danger sm:px-5">
            <CircleAlert className="h-4 w-4" strokeWidth={2} aria-hidden />
            هنا يقصر الرصيدُ المعروف عمّا يخرج.
          </p>
        )}
        <ul className="divide-y divide-line-soft">
          {b.lines.map((l) => (
            <li key={l.id}>
              <Link href={l.href} className="flex min-h-12 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-hover sm:px-5">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sunken text-ink-soft">
                  {l.kind === "SUPPLIER" ? <Store className="h-3.5 w-3.5" strokeWidth={2} aria-hidden /> : <Repeat className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {l.label}
                  {l.sub && <span className="ms-2 text-[11px] text-muted">{l.sub}</span>}
                </span>
                <span className="nums-col shrink-0 text-[13px] font-bold"><Money minor={l.amountMinor} /></span>
              </Link>
            </li>
          ))}
        </ul>
      </article>
    </li>
  );
}
