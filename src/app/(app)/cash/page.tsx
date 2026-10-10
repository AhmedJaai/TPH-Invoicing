import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, CircleCheck, Info, Landmark, Plus, Repeat, TriangleAlert } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Callout, EmptyState, KeyFigure, LinkButton, NoAccess } from "@/components/ui";
import { SUPPLIER, countNoun } from "@/lib/arabic";
import { formatDay } from "@/lib/riyadh-time";
import { loadCashOutlook } from "@/services/cash-outlook.service";
import { CashTimeline } from "@/components/cash-timeline";

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
  /* المحاسبُ لا يعتمد الدفعة — فسطرُ المورّد يفتح حساباته لا صفحةً تقول «خارج صلاحيتك» */
  const canPay = can(user.role, "payment:approve");
  const payHref = canPay ? "/payments" : "/suppliers";
  const buckets = o.buckets.map((b) => ({ ...b, lines: b.lines.map((l) => (l.kind === "SUPPLIER" ? { ...l, href: payHref } : l)) }));
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
      <div className={`grid grid-cols-[minmax(0,1fr)] gap-3 ${overdue ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <KeyFigure
          icon={Landmark}
          label="آخرُ رصيدٍ معروف"
          value={balanceKnown ? <Money minor={o.balanceMinor as number} /> : <span className="text-xl text-muted">غير معروف</span>}
          sub={balanceKnown ? `في ${formatDay(o.balanceAsOf)} — وما دخل وخرج بعده لم يُحسب` : "لا كشفَ يحمل الرصيد. استورد كشفاً فيه عمودُ الرصيد، أو أدخله عند الإقفال."}
          href={balanceKnown ? "/bank" : "/bank#import"}
        />
        {/* الصفرُ المعلوم سطرٌ هادئ لا بطاقة «0.00» — البطاقةُ لما فيه جواب */}
        {overdue && (
          <KeyFigure
            icon={TriangleAlert}
            tone="danger"
            label="متأخّرٌ الآن"
            value={<Money minor={overdue.totalMinor} />}
            sub={`${countNoun(overdue.lines.length, SUPPLIER)} من دفعة الشهر الماضي لم يُحوَّل لهم`}
            href={payHref}
          />
        )}
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

      {!overdue && (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted">
          <CircleCheck className="h-3.5 w-3.5 shrink-0 text-ok" strokeWidth={2} aria-hidden />
          لا شيء متأخّر من دفعة الشهر الماضي
        </p>
      )}

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
          <CashTimeline buckets={buckets} balanceMinor={o.balanceMinor} runMonth={o.runMonth} canPay={canPay} />
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
          دفعةُ الشهر القادم تُبنى من الفواتير المسجّلة حتى اليوم وتكبر مع كلّ فاتورةٍ تصل
          {canPay ? (
            <>
              {" "}— ودفعةُ الشهر الماضي تُعتمَد من{" "}
              <Link href="/payments" className="font-bold text-accent hover:underline">دفعة الشهر</Link>.
            </>
          ) : (
            " — ويعتمدها المالك."
          )}
        </p>
      )}
    </PageShell>
  );
}
