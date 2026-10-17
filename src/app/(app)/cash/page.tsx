import { Suspense } from "react";
import { RunwayLine } from "@/components/cash-runway";
import { SectionBoundary } from "@/components/ui-client";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, CircleCheck, Info, Landmark, Percent, Plus, Repeat, ShieldAlert, TriangleAlert } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Callout, EmptyState, KeyFigure, LinkButton, NoAccess } from "@/components/ui";
import { SUPPLIER, countNoun } from "@/lib/arabic";
import { formatDay } from "@/lib/riyadh-time";
import { loadCashOutlook } from "@/services/cash-outlook.service";
import { CashTimeline } from "@/components/cash-timeline";
import { CashFloor } from "@/components/cash-floor";

export const dynamic = "force-dynamic";

/**
 * النقد القادم — ما يخرج، ومتى، ومقابل أيّ رصيد.
 *
 * إسقاطٌ من المعلوم وحده (`lib/cash-outlook.ts`): دفعةُ الشهر المنقضي،
 * وفواتيرُ هذا الشهر حتى اليوم، والمصروفاتُ المتكرّرة المسجّلة. والوارد
 * لا يُحسَب لأنّ المبيعات غير موصولة — فخطُّ الرصيد حدٌّ أدنى، ويُقال.
 */
export default async function CashPage({ searchParams }: { searchParams: Promise<{ vat?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/cash");
  if (!can(user.role, "bank:view")) {
    return (
      <PageShell user={user} width="wide" title="النقد القادم">
        <NoAccess what="النقد القادم" />
      </PageShell>
    );
  }

  const withVat = (await searchParams).vat !== "off";
  const o = await loadCashOutlook({ withVat });
  /* المحاسبُ لا يعتمد الدفعة — فسطرُ المورّد يفتح حساباته لا صفحةً تقول «خارج صلاحيتك» */
  const canPay = can(user.role, "payment:approve");
  const payHref = canPay ? "/payments" : "/suppliers";
  /* صفحةُ الإقرار لمن يُقفل الشهر — وغيرُه يقرأ السطرَ ولا يُرسَل إلى «خارج صلاحيتك» */
  const canVat = can(user.role, "month:close");
  const buckets = o.buckets.map((b) => ({
    ...b,
    lines: b.lines.map((l) => (l.kind === "SUPPLIER" ? { ...l, href: payHref } : l.kind === "VAT" && !canVat ? { ...l, href: "/cash" } : l)),
  }));
  const overdue = o.buckets.find((b) => b.id === "overdue");
  const nextRun = o.buckets.find((b) => b.id === "next-run");
  const balanceKnown = o.balanceMinor !== null;

  return (
    <PageShell
      user={user}
      width="wide"
      title="النقد القادم"
      intro="المبالغ المعروفة التي ستخرج من الحساب في الأسابيع القادمة، وهي دفعات المورّدين والمصروفات المتكررة وضريبة القيمة المضافة، مقارنةً بآخر رصيد معروف."
      actions={
        <LinkButton href="/settings#recurring" icon={Plus} variant="secondary">
          مصروف متكرر
        </LinkButton>
      }
    >
      {/* ── الأرقام الثلاثة ── */}
      <div className={`grid grid-cols-[minmax(0,1fr)] gap-3 ${overdue ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <KeyFigure
          icon={Landmark}
          label="آخر رصيد معروف"
          value={balanceKnown ? <Money minor={o.balanceMinor as number} /> : <span className="text-xl text-muted">غير معروف</span>}
          sub={balanceKnown ? `في ${formatDay(o.balanceAsOf)}، ولا يشمل ما دخل وخرج بعد ذلك` : "لا يوجد كشف فيه الرصيد. استورد كشفاً يحتوي على عمود الرصيد، أو أدخله عند الإقفال."}
          href={balanceKnown ? "/bank" : "/bank#import"}
        >
          {/* سطرٌ يُحسب بعد الرسم، وعطبُه لا يُسقط الصفحة */}
          {balanceKnown && (
            <SectionBoundary what="الأيام المتبقية من النقد">
              <Suspense fallback={null}>
                <RunwayLine />
              </Suspense>
            </SectionBoundary>
          )}
        </KeyFigure>
        {/* الصفرُ المعلوم سطرٌ هادئ لا بطاقة «0.00» — البطاقةُ لما فيه جواب */}
        {overdue && (
          <KeyFigure
            icon={TriangleAlert}
            tone="danger"
            label="متأخر الآن"
            value={<Money minor={overdue.totalMinor} />}
            sub={overdueSub(overdue.lines)}
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
                ? "لا يكفيه الرصيد المعروف. شاهد التفاصيل أدناه."
                : "يكفيه الرصيد المعروف."
              : "مجموع ما في الجدول الزمني أدناه."
          }
        />
      </div>

      {!overdue && (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted">
          <CircleCheck className="h-3.5 w-3.5 shrink-0 text-ok" strokeWidth={2} aria-hidden />
          لا توجد مبالغ متأخرة من دفعة الشهر الماضي
        </p>
      )}

      <Callout tone="info" icon={Info} className="mt-4">
        <strong className="text-ink">تقدير وليس توقعاً:</strong> لا تُحسب المبالغ الواردة لأن مبيعات فودكس غير مربوطة، ولا تظهر المصروفات التي لم تُسجَّل كمتكررة.
        لذلك فالرصيد بعد كل مرحلة هو الحد الأدنى المتوقع بقاؤه.
        {o.heldMinor > 0 && <> وهناك <Money minor={o.heldMinor} /> محجوزة حتى تصل الفواتير الصحيحة، ولا تدخل في الحساب هنا.</>}
      </Callout>

      {/* ── حدُّ الرصيد: تحذيرٌ بما يكسره — لا يمنع دفعةً ولا يغيّر رقماً ── */}
      {o.breach && (
        <Callout
          tone="danger"
          icon={ShieldAlert}
          className="mt-3"
          title={`الرصيد سينزل تحت حدّك عند «${o.breach.title}»`}
          action={<LinkButton href="#floor" variant="secondary" size="sm">غيّر الحدّ</LinkButton>}
        >
          يبقى بعدها <Money minor={o.breach.afterMinor} /> وحدّك <Money minor={o.floorMinor ?? 0} />، أي ينقصك <Money minor={o.breach.shortMinor} /> إن لم يدخل شيء
          (المبالغ الواردة غير محسوبة). أكبر البنود:{" "}
          {o.breach.causes.map((c, i) => (
            <span key={c.label}>{i > 0 && " · "}{c.label} <Money minor={c.amountMinor} /></span>
          ))}
          . جرّب تأجيل أحد البنود في الجدول أدناه لترى أثره.
        </Callout>
      )}

      {/* ── الضريبة: ما دخل الإسقاط، وما يُجنَّب له، وما لا يُعرف — وزرٌّ يعيد الرقمَ كما كان ── */}
      {o.vatIncluded.length > 0 && (
        <Callout
          tone="warn"
          icon={Percent}
          className="mt-3"
          title="هذا التقدير يشمل ضريبة القيمة المضافة"
          action={<LinkButton href="/cash?vat=off" variant="secondary" size="sm">اعرضه بدون الضريبة</LinkButton>}
        >
          {o.vatIncluded.map((v) => (
            <span key={v.periodKey} className="block">
              {v.label}: <Money minor={v.amountMinor ?? 0} /> {v.accruing ? "حتى اليوم (تزيد مع المبيعات)" : "لم يُسجَّل تقديم إقرارها"} — آخر موعد لها <bdi>{formatDay(v.deadline)}</bdi>.{" "}
              {canVat && <Link href={`/close/vat?period=${v.periodKey}`} className="font-bold text-accent hover:underline">حسابها</Link>}
            </span>
          ))}
          لذلك زاد «يخرج حتى آخر الشهر القادم» ونقص «يبقى بعدها» بمقدارها.
        </Callout>
      )}
      {o.vatOff.some((v) => (v.amountMinor ?? 0) > 0) && (
        <Callout
          tone="info"
          icon={Percent}
          className="mt-3"
          title="التقدير معروض بدون الضريبة"
          action={<LinkButton href="/cash" variant="primary" size="sm">أدخل الضريبة</LinkButton>}
        >
          المستبعد بناءً على طلبك:{" "}
          {o.vatOff.filter((v) => (v.amountMinor ?? 0) > 0).map((v, i) => (
            <span key={v.periodKey}>{i > 0 && " · "}{v.label} <Money minor={v.amountMinor ?? 0} /> (موعدها <bdi>{formatDay(v.deadline)}</bdi>)</span>
          ))}
          .
        </Callout>
      )}
      {o.vatAhead.length > 0 && (
        <Callout tone="accent" icon={Percent} className="mt-3" title="جنّب للضريبة">
          {o.vatAhead.map((v) => (
            <span key={v.periodKey} className="block">
              {v.label}: <Money minor={v.amountMinor ?? 0} /> {v.accruing ? "حتى اليوم، وتزيد مع كل يوم بيع" : ""} · تُسدَّد قبل <bdi>{formatDay(v.deadline)}</bdi>.{" "}
              {canVat && <Link href={`/close/vat?period=${v.periodKey}`} className="font-bold text-accent hover:underline">حسابها</Link>}
            </span>
          ))}
          موعدها بعد الفترة التي يغطيها الجدول أدناه، فلا تُطرح من «يبقى بعدها»، لكنها مبلغ سيخرج لاحقاً.
        </Callout>
      )}
      {o.vatUnknown.length > 0 && (
        <Callout tone="warn" icon={Percent} className="mt-3" title="ضريبة قادمة مبلغها غير معروف">
          {o.vatUnknown.map((v) => (
            <span key={v.periodKey} className="block">
              {v.label} (موعدها <bdi>{formatDay(v.deadline)}</bdi>): أحد شهورها بلا كشف بنك، فمبيعاته غير معروفة ولن يُكتب مبلغ الضريبة المستحقة.{" "}
              {canVat && <Link href={`/close/vat?period=${v.periodKey}`} className="font-bold text-accent hover:underline">ما الناقص</Link>}
            </span>
          ))}
        </Callout>
      )}

      {/* ── الجدول الزمنيّ ── */}
      <section className="mt-10">
        <h2 className="mb-4 text-base font-bold">ما يخرج، ومتى</h2>
        {o.buckets.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="لا توجد مبالغ معروفة ستخرج في الأسابيع القادمة."
            hint="لا توجد دفعة مورّدين مفتوحة ولا مصروفات متكررة مسجّلة. سجّل الإيجار والرواتب كمصروفات متكررة لتظهر هنا في موعدها."
            action={<LinkButton href="/settings#recurring" variant="primary" icon={Plus}>سجّل مصروفاً متكرراً</LinkButton>}
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
          لا توجد مصروفات متكررة مسجّلة، فالجدول أعلاه يعرض دفعات المورّدين فقط. سجّل ما يتكرر كل شهر بيومه ليدخل في التقدير.
        </Callout>
      )}

      <section id="floor" className="mt-10 scroll-mt-24 rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
        <h2 className="text-base font-bold">حدّ الرصيد الأدنى</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
          {o.floorMinor === null
            ? "لم تحدّد حدّاً أدنى، فلن ينبّهك النظام عند انخفاض الرصيد. اكتب الرصيد الذي لا تريد أن ينزل الحساب تحته، وسيُظهر لك أول موعد ينزل فيه تحته وسببه."
            : !balanceKnown
              ? "الحد الأدنى محدد، لكن الرصيد غير معروف، فلا يمكن تقييم الوضع ولا يظهر أي تنبيه. استورد كشفاً فيه الرصيد."
              : o.breach
                ? "التقدير ينزل تحت الحد الأدنى. التفاصيل في أعلى الصفحة."
                : "المبالغ المعروفة لا تنزل بالرصيد تحت الحد الأدنى حتى آخر الشهر القادم، ولا تشمل المصروفات غير المسجّلة."}
        </p>
        <div className="mt-4">
          {can(user.role, "bank:edit")
            ? <CashFloor floorMinor={o.floorMinor} />
            : <p className="text-xs text-muted">{o.floorMinor === null ? "يحدده المالك أو المحاسب." : <>الحد الحالي <Money minor={o.floorMinor} />.</>}</p>}
        </div>
      </section>

      {nextRun && (
        <p className="mt-6 text-xs leading-relaxed text-muted">
          تُبنى دفعة الشهر القادم من الفواتير المسجّلة حتى اليوم، وتزيد مع كل فاتورة جديدة
          {canPay ? (
            <>
              {". "}أما دفعة الشهر الماضي فتُعتمد من{" "}
              <Link href="/payments" className="font-bold text-accent hover:underline">دفعة الشهر</Link>.
            </>
          ) : (
            "، ويعتمدها المالك."
          )}
        </p>
      )}
    </PageShell>
  );
}

/** ما في «متأخّرٌ الآن»: مورّدو الدفعة، وضريبةٌ فات موعدُ إقرارها إن وُجدت. */
function overdueSub(lines: readonly { kind: string }[]): string {
  const suppliers = lines.filter((l) => l.kind === "SUPPLIER").length;
  const vat = lines.some((l) => l.kind === "VAT");
  const parts = [
    ...(suppliers > 0 ? [`${countNoun(suppliers, SUPPLIER)} من دفعة الشهر الماضي لم تُحوَّل مستحقاتهم`] : []),
    ...(vat ? ["ضريبة فات موعد إقرارها"] : []),
  ];
  return parts.join(" · ");
}
