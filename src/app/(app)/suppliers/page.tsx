import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock, FileWarning, Hourglass, PiggyBank, Receipt, Sparkles, Store, Wallet } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import {
  Badge, Callout, Card, DataTable, EmptyState, LinkButton, LinkTabs, Monogram, Section, buttonClass, type Column,
} from "@/components/ui";
import { AgeingBar, Figure } from "@/components/supplier-intel";
import { SUPPLIER, countNoun, INVOICE, PAYMENT_RECORD, DAY } from "@/lib/arabic";
import { buildInvoiceRequest, groupUnbackedBySupplier } from "@/lib/supplier-requests";
import { loadUnbackedPayments } from "@/services/supplier-followups.service";
import { loadBalanceTotals, loadOpenInvoiceAges, loadOverdueBalances } from "@/services/supplier-balance.service";
import { loadSupplierDirectory } from "@/services/supplier-intel.service";
import { listOpenFindings } from "@/services/supplier-analysis.service";
import { FindingsList, RunAnalysis, type FindingView } from "@/components/ai-analysis";
import { formatDay } from "@/lib/riyadh-time";
import { needsContract, needsPaperUpload } from "@/lib/supplier-policy-rules";
import { ageOwed, ageTone, type OwedAgeing } from "@/lib/supplier-intel";

export const dynamic = "force-dynamic";

/**
 * حسابات المورّدين — «لمن أدين، وكم، ومنذ متى؟» في مكانٍ واحد.
 *
 * ── ثلاثةُ أرقامٍ ثمّ قائمة ──
 *
 * رأسُ الصفحة ثلاثةُ أجوبة: كم عليك، وكم منه تأخّر، وكم لك عندهم. وتحت
 * الأوّل شريطُ الأعمار — «منذ متى؟» — لأنّ «عليك ١٢ ألفاً» لا يقول أيّه
 * يستحقّ الاتّصال اليوم. والقائمةُ تُصفّى في العنوان (عليك · متأخّر · لك
 * رصيد · بلا تعامل) ويُبحث فيها بالاسم البديل واسم المستفيد في البنك.
 *
 * ── المصدرُ واحد ──
 *
 * «عليك» و«لك» من `loadBalanceTotals()` — التي تحسب الرقم في الرئيسية
 * وفي التنبيهات. والمتأخّرُ من `loadOverdueBalances()` — التي يعدّ بها
 * الطابور. والأعمارُ توزيعٌ لذلك الرقم نفسِه على الفواتير (`ageOwed`)، لا
 * حسابٌ ثانٍ له.
 *
 * ── لماذا صفحةٌ واحدة بدل ثلاث ── (باقٍ من الإصدار الأوّل)
 *
 * كان السؤال موزّعاً على `/purchases` و`/purchases/insights` و`/suppliers`
 * بعدَّين مختلفين لعنوانٍ واحد. والإداريُّ (الرقم الضريبيّ، دورة الفوترة،
 * الأسماء البديلة) في ملفّ المورّد حيث يُطلَب، لا في الجدول حيث يُزاحم.
 */

type View = "all" | "owed" | "overdue" | "credit" | "idle";
const VIEWS: readonly View[] = ["all", "owed", "overdue", "credit", "idle"];

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ unbacked?: string; view?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/suppliers");

  const showAmounts = can(user.role, "amounts:view");
  const params = await searchParams;
  const unbackedView = params.unbacked === "1";
  const wanted = VIEWS.find((v) => v === params.view) ?? "all";

  const [{ rows: balances, totals }, overdue, ages, unbackedPayments, open, directory] = await Promise.all([
    loadBalanceTotals(),
    showAmounts ? loadOverdueBalances() : Promise.resolve([]),
    loadOpenInvoiceAges(),
    showAmounts ? loadUnbackedPayments() : Promise.resolve([]),
    showAmounts ? listOpenFindings() : Promise.resolve([]),
    loadSupplierDirectory(),
  ]);

  if (directory.length === 0) {
    return (
      <PageShell user={user} width="wide" title="حسابات المورّدين">
        <EmptyState
          icon={Store}
          title="لا مورّدين بعد."
          hint="يُنشَأ المورّد حين تُقرأ أوّل فاتورة منه — أو تختاره «مورّداً جديداً» في شاشة الرفع."
          action={<LinkButton href="/upload" variant="primary">ارفع مستنداً</LinkButton>}
        />
      </PageShell>
    );
  }

  const balanceOf = new Map(balances.map((b) => [b.supplierId, b]));
  const unbackedGroups = groupUnbackedBySupplier(unbackedPayments);
  const unbackedTotal = unbackedPayments.reduce((s, p) => s + p.unbackedMinor, 0);

  const rows = directory
    .map((m) => {
      const b = balanceOf.get(m.id);
      const owedMinor = b?.owedMinor ?? 0;
      const ageing: OwedAgeing = ageOwed(ages.get(m.id) ?? [], owedMinor);
      return {
        ...m,
        owedMinor,
        creditLeftMinor: b?.creditLeftMinor ?? 0,
        openCount: b?.openCount ?? 0,
        ageing,
        idle: m.invoiceCount === 0 && m.paymentCount === 0,
        contract: needsContract(m),
        paper: needsPaperUpload(m),
      };
    })
    /*
      الترتيب يتبع العمل: من عليك له أوّلاً وبالأكبر، ثمّ من لك عنده، ثمّ
      من تعاملتَ معه أخيراً، والساكنون آخراً.
    */
    .sort((a, b) =>
      b.owedMinor - a.owedMinor ||
      b.creditLeftMinor - a.creditLeftMinor ||
      Number(a.idle) - Number(b.idle) ||
      (b.lastActivity ?? "").localeCompare(a.lastActivity ?? "") ||
      a.nameAr.localeCompare(b.nameAr, "ar"),
    );

  type Row = (typeof rows)[number];
  const inView: Record<View, (r: Row) => boolean> = {
    all: () => true,
    owed: (r) => r.owedMinor > 0,
    overdue: (r) => r.ageing.overdueMinor > 0,
    credit: (r) => r.creditLeftMinor > 0,
    idle: (r) => r.idle,
  };
  /* من لا يرى المال لا تُعرَض له ألسنةُ المال — ولا يُفتح أحدُها من العنوان */
  const view: View = showAmounts || wanted === "all" || wanted === "idle" ? wanted : "all";
  const shown = rows.filter(inView[view]);

  /* رأسُ الصفحة: هل يعرف النظام شيئاً؟ مورّدون بلا فاتورةٍ ولا دفعة ليسوا «عليك صفر» */
  const knows = balances.length > 0;
  const allBuckets = rows.reduce<[number, number, number, number]>(
    (acc, r) => [acc[0] + r.ageing.buckets[0], acc[1] + r.ageing.buckets[1], acc[2] + r.ageing.buckets[2], acc[3] + r.ageing.buckets[3]],
    [0, 0, 0, 0],
  );
  const overdueMinor = overdue.reduce((s, o) => s + o.owedMinor, 0);
  const oldestOverdue = overdue.reduce((m, o) => Math.max(m, o.oldestDays), 0);

  const needContract = rows.filter((r) => r.contract);
  const paperOnly = rows.filter((r) => r.paper);

  const findings: FindingView[] = open.map((f) => ({
    id: f.id, supplierId: f.supplierId, supplierName: f.supplierName, supplierSlug: f.supplierSlug,
    kind: f.kind, severity: f.severity, title: f.title, explanation: f.explanation,
    amountMinor: f.amountMinor, action: f.action,
    refs: f.refs.map((r) => ({ label: r.label, type: r.type })),
    createdAt: f.createdAt.toISOString(),
  }));
  const worth = rows.filter((r) => r.owedMinor > 0 || r.creditLeftMinor > 0);

  const tabs = [
    { id: "all" as const, label: "الكلّ", count: rows.length },
    ...(showAmounts
      ? [
          { id: "owed" as const, label: "عليك", count: rows.filter(inView.owed).length },
          { id: "overdue" as const, label: "متأخّر", count: rows.filter(inView.overdue).length },
          { id: "credit" as const, label: "لك رصيد", count: rows.filter(inView.credit).length },
        ]
      : []),
    { id: "idle" as const, label: "بلا تعامل", count: rows.filter(inView.idle).length },
  ];

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "المورّد",
      primary: true,
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-3">
          <Monogram name={r.nameAr} className="h-9 w-9 text-sm" />
          <span className="min-w-0">
            <Link href={`/suppliers/${r.slug}`} className="relative block truncate font-bold hover:text-accent">
              {r.nameAr}
            </Link>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-normal text-muted">
              {r.idle
                ? "لا فاتورة ولا دفعة بعد"
                : r.openCount > 0
                  ? `${countNoun(r.openCount, INVOICE)} مفتوحة`
                  : r.invoiceCount > 0 ? "فواتيره مسدَّدة" : "دفعاتٌ بلا فواتير"}
              {r.contract && <Badge tone="warn">يحتاج عقداً</Badge>}
              {r.paper && <Badge>فواتيرُه ورقيّة</Badge>}
            </span>
          </span>
        </span>
      ),
    },
    /*
      أعمدةُ المال لا تُعرض لمن لا يرى المال: شَرطتان في كلّ صفّ تُقرآن
      «لا دَين» — وهي «لا تُعرَض لك».
    */
    ...(showAmounts
      ? ([
          {
            /*
              عمودٌ واحد للحساب بجهته — «عليك» أو «لك» كلمةً بجانب الرقم. كانا
              عمودين نصفُ خاناتهما شَرطة، فتطول البطاقةُ على الجوّال بلا خبر.
            */
            key: "balance",
            header: "الحساب",
            numeric: true,
            cell: (r) =>
              r.owedMinor > 0 ? (
                <span className="inline-flex items-baseline gap-1.5 font-bold">
                  <Money minor={r.owedMinor} tone="warn" />
                  <span className="text-[10px] text-warn">عليك</span>
                </span>
              ) : r.creditLeftMinor > 0 ? (
                <span className="inline-flex items-baseline gap-1.5 font-bold">
                  <Money minor={r.creditLeftMinor} />
                  <span className="text-[10px] text-ok">لك</span>
                </span>
              ) : (
                <span className="text-[11px] text-muted">{r.idle ? "—" : "متّزن"}</span>
              ),
          },
          {
            key: "age",
            header: "أقدم دَين",
            cell: (r) =>
              r.ageing.oldestOwedDays === null ? (
                <span className="text-muted">—</span>
              ) : (
                <Badge tone={ageTone(r.ageing.oldestOwedDays) === "muted" ? undefined : ageTone(r.ageing.oldestOwedDays)} dot>
                  منذ {countNoun(r.ageing.oldestOwedDays, DAY)}
                </Badge>
              ),
          },
        ] satisfies Column<Row>[])
      : []),
    {
      key: "last",
      header: "آخر تعامل",
      secondary: true,
      cell: (r) =>
        r.lastActivity ? (
          <span className="whitespace-nowrap text-ink-soft">
            {formatDay(r.lastActivity)}
            <span className="ms-1.5 text-[11px] text-muted">{r.lastActivityKind === "INVOICE" ? "فاتورة" : "دفعة"}</span>
          </span>
        ) : (
          <span className="text-muted">لا تعامل بعد</span>
        ),
    },
  ];

  return (
    <PageShell
      user={user}
      width="wide"
      title="حسابات المورّدين"
      intro={showAmounts
        ? "لمن تدين، وكم، ومنذ متى — بعد خصم ما دفعتَه لكلٍّ منهم، وما بقي لك عندهم."
        : "المورّدون وفواتيرُهم المفتوحة وآخرُ تعاملٍ معهم — والمبالغُ خارج صلاحيتك."}
      actions={
        showAmounts && can(user.role, "payment:approve") && totals.owedMinor > 0 ? (
          <LinkButton href="/payments" variant="primary" icon={Wallet}>خطّط الدفعة</LinkButton>
        ) : undefined
      }
    >
      {/* ── الأجوبة الثلاثة ── */}
      {showAmounts && (
        knows ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <Figure
              className="col-span-2 lg:col-span-1"
              icon={Receipt}
              label="عليك للمورّدين"
              href="/suppliers?view=owed"
              tone={totals.owedMinor > 0 ? "warn" : undefined}
              value={<Money minor={totals.owedMinor} currency />}
              sub={totals.owedMinor > 0
                ? `${countNoun(totals.owedSuppliers, SUPPLIER)} · على ${countNoun(totals.openInvoiceCount, INVOICE)} مفتوحة، بعد خصم ما دفعتَه لهم`
                : "لا فاتورة مفتوحة إلّا وقد غطّاها ما دفعتَه."}
            >
              <AgeingBar buckets={allBuckets} />
            </Figure>
            <Figure
              icon={Hourglass}
              label="متأخّرٌ أكثر من 60 يوماً"
              href="/suppliers?view=overdue"
              tone={overdueMinor > 0 ? "danger" : "ok"}
              value={<Money minor={overdueMinor} />}
              sub={overdueMinor > 0
                ? `عند ${countNoun(overdue.length, SUPPLIER)} · أقدمُه منذ ${countNoun(oldestOverdue, DAY)}`
                : "لا دَين تجاوز ستّين يوماً بعد خصم أرصدتك."}
            />
            <Figure
              icon={PiggyBank}
              label="رصيدٌ لك عندهم"
              href="/suppliers?view=credit"
              value={<Money minor={totals.creditLeftMinor} />}
              sub={totals.creditLeftMinor > 0
                ? `${countNoun(totals.creditSuppliers, SUPPLIER)} · مالٌ دفعتَه ولم تصلك فاتورتُه — يُخصَم من فواتيرهم القادمة`
                : "لا مال دفعتَه إلّا وفاتورتُه عندك."}
            />
          </div>
        ) : (
          /* مورّدون مسجَّلون ولا فاتورةَ ولا دفعة: «عليك صفر» كذبٌ عن غير علم */
          <Callout
            tone="accent"
            icon={Sparkles}
            title="لا يعرف النظام بعدُ لمن تدين"
            action={<LinkButton href="/upload" variant="primary" size="sm">ارفع مستنداً</LinkButton>}
          >
            لا فاتورةَ ولا دفعةَ مقيّدة لأيّ مورّد. ارفع فواتيرهم واستورد كشف البنك، فيظهر هنا ما عليك وما لك ومنذ متى.
          </Callout>
        )
      )}

      {showAmounts && unbackedTotal > 0 && !unbackedView && (
        <Callout
          tone="info"
          icon={FileWarning}
          className="mt-4"
          action={<LinkButton href="/suppliers?unbacked=1#unbacked" size="sm">اعرضها واطلب فواتيرها</LinkButton>}
        >
          <strong className="text-ink">{countNoun(unbackedPayments.length, PAYMENT_RECORD)} دفعتَها ولم يصل مستندُها</strong>{" "}
          — <Money minor={unbackedTotal} />. بلا فاتورةٍ ضريبية لا يُخصَم مدخلُها.
        </Callout>
      )}

      {unbackedView && showAmounts && <UnbackedSection groups={unbackedGroups} count={unbackedPayments.length} />}

      {/* ── القائمة ── */}
      <Section
        title="المورّدون"
        icon={Store}
        count={rows.length}
        hint={showAmounts ? "من عليك له أوّلاً وبالأكبر. ابحث بالاسم، أو بالاسم الذي يظهر به في كشف البنك." : undefined}
      >
        <div className="mb-3">
          <LinkTabs
            label="تصفية المورّدين"
            items={tabs.map((t) => ({
              href: t.id === "all" ? "/suppliers" : `/suppliers?view=${t.id}`,
              label: t.label,
              count: t.count,
              active: view === t.id,
            }))}
          />
        </div>

        {(needContract.length > 0 || paperOnly.length > 0) && view === "all" && (
          <Callout tone="warn" icon={Clock} className="mb-3" title="ما يُطلَب من مورّدين">
            {needContract.length > 0 && (
              <p id="no-contract" className="scroll-mt-24">
                <span className="font-bold text-ink">{countNoun(needContract.length, SUPPLIER)} يحتاج عقد توريد</span> — لا يصدرون فواتير ضريبية،
                وبلا عقدٍ مكتوب لا خصمَ ضريبة ولا إثباتَ مصروف:{" "}
                {needContract.map((r, i) => (
                  <span key={r.id}>
                    {i > 0 && " · "}
                    <Link href={`/suppliers/${r.slug}?tab=profile`} className="font-medium underline underline-offset-4 hover:text-ink">{r.nameAr}</Link>
                  </span>
                ))}
                . ومن لا يحتاج عقداً تُطفئه من ملفّه.
              </p>
            )}
            {paperOnly.length > 0 && (
              <p className={needContract.length > 0 ? "mt-1" : ""}>
                <span className="font-bold text-ink">{countNoun(paperOnly.length, SUPPLIER)} فواتيرُه ورقيّة</span> — فاتورتُه موجودةٌ باليد، والمطلوبُ
                تصويرُها ورفعُها: {paperOnly.map((r) => r.nameAr).join(" · ")}.
              </p>
            )}
          </Callout>
        )}

        <DataTable
          rows={shown}
          keyOf={(r) => r.id}
          hrefOf={(r) => `/suppliers/${r.slug}`}
          searchOf={(r) => [r.nameAr, r.nameEn, r.slug, r.vatNumber, r.aliases].filter(Boolean).join(" ")}
          searchLabel="ابحث باسم المورّد أو اسمه في البنك"
          columns={columns}
          empty={
            <EmptyState
              compact
              icon={Store}
              title={
                view === "owed" ? "لا مورّد عليك له شيء."
                : view === "overdue" ? "لا دَين تجاوز ستّين يوماً."
                : view === "credit" ? "لا رصيد لك عند أحد."
                : view === "idle" ? "كلُّ مورّدٍ مسجَّل تعاملتَ معه."
                : "لا مورّدين في هذه القائمة."
              }
              hint={view === "owed" || view === "overdue" ? "كلُّ فاتورةٍ مفتوحة غطّاها ما دفعتَه — بحسب ما قُيّد من فواتير ودفعات." : undefined}
              action={<LinkButton href="/suppliers" size="sm">كلُّ المورّدين</LinkButton>}
            />
          }
        />
      </Section>

      {/* ── اقتراحات التحليل: تُكشَف بقدر، وتُحلَّل بضغطة ── */}
      {showAmounts && (findings.length > 0 || can(user.role, "supplier:edit")) && (
        <Section
          title="اقتراحات التحليل"
          icon={Sparkles}
          count={findings.length > 0 ? findings.length : undefined}
          hint="يقرأ التحليلُ فواتير المورّد ودفعاته وكشوفه ويقترح ما يصحّح حسابه. الأرقامُ يحسبها الخادم، ولا يُكتب شيءٌ حتى تُقرّه."
          action={
            can(user.role, "supplier:edit") && worth.length > 0 ? (
              <RunAnalysis
                suppliers={worth.map((w) => ({ id: w.id, name: w.nameAr }))}
                label={`حلّل حسابات ${countNoun(worth.length, SUPPLIER)}`}
              />
            ) : undefined
          }
        >
          {findings.length === 0 ? (
            <EmptyState
              compact
              icon={Sparkles}
              title="لا اقتراح ينتظر قرارك."
              hint="شغّل التحليل على من بينك وبينه رصيد — يقارن فواتيره بدفعاته وكشفه، ويقترح ولا يكتب."
            />
          ) : (
            <FindingsList findings={findings} canApprove={can(user.role, "payment:approve")} showSupplier collapseAfter={3} />
          )}
        </Section>
      )}
    </PageShell>
  );
}

/* ───────────────────── دفعاتٌ لم تُنسب ───────────────────── */

/**
 * «لمن دفعنا بلا فاتورة؟» — يفتحها بندُ الطابور (`?unbacked=1#unbacked`).
 * مورّداً مورّداً، ومع كلٍّ رسالةُ طلبه جاهزة.
 */
function UnbackedSection({ groups, count }: { groups: ReturnType<typeof groupUnbackedBySupplier>; count: number }) {
  return (
    <div id="unbacked" className="scroll-mt-28">
      <Section
        title="دفعاتٌ لم تُنسب إلى فاتورة"
        icon={FileWarning}
        count={count}
        hint={`عند ${countNoun(groups.filter((g) => g.supplierId).length, SUPPLIER)}. بلا فاتورةٍ ضريبية لا يُخصَم مدخلُها. ومن لا يصدر فواتير يُطلَب منه عقدُ توريد بدلها — وهو معدودٌ هنا كغيره، فالمال خرج.`}
        action={<LinkButton href="/suppliers" size="sm" variant="quiet">كلّ الحسابات</LinkButton>}
      >
        {groups.length === 0 ? (
          <EmptyState compact title="لا دفعة بلا فاتورة." hint="كلّ ما دُفع له مستندُه." />
        ) : (
          <ul className="grid gap-3 xl:grid-cols-2">
            {groups.map((g) => (
              <li key={g.supplierId ?? "none"} id={g.supplierSlug ? `unbacked-${g.supplierSlug}` : undefined} className="scroll-mt-28">
                <Card>
                  <div className="flex items-start gap-3">
                    <Monogram name={g.supplierName} className="h-9 w-9 text-sm" />
                    <span className="min-w-0 flex-1">
                      {g.supplierSlug ? (
                        <Link href={`/suppliers/${g.supplierSlug}`} className="block truncate text-sm font-bold hover:text-accent">{g.supplierName}</Link>
                      ) : (
                        <span className="block text-sm font-bold">{g.supplierName}</span>
                      )}
                      <span className="block text-[11px] text-muted">
                        {countNoun(g.payments.length, PAYMENT_RECORD)}
                        {g.supplierId ? " بلا فاتورة" : " لم تُعرَف جهتها — افتح حركتها وحدّد مورّدها"}
                      </span>
                    </span>
                    <span className="shrink-0 text-end">
                      <span className="block text-[11px] text-muted">بلا مستند</span>
                      <span className="block text-[15px] font-bold"><Money minor={g.totalMinor} tone="warn" /></span>
                    </span>
                  </div>
                  <ul className="mt-3 divide-y divide-line-soft rounded-lg border border-line-soft bg-sunken/40">
                    {g.payments.map((p) => (
                      <li key={p.paymentId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-[11px]">
                        <span className="min-w-0 text-muted">
                          {formatDay(p.paidOn)} · من أصل <Money minor={p.amountMinor} />
                          {p.bankTransactionId && (
                            <>
                              {" · "}
                              <Link href={`/bank?tx=${p.bankTransactionId}`} className="inline-flex min-h-11 items-center font-medium text-accent hover:underline sm:min-h-0">
                                حركتها
                              </Link>
                            </>
                          )}
                        </span>
                        <span className="font-bold"><Money minor={p.unbackedMinor} /></span>
                      </li>
                    ))}
                  </ul>
                  {g.supplierId && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a
                        href={`https://wa.me/?text=${encodeURIComponent(buildInvoiceRequest(g))}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonClass("primary", "sm")}
                      >
                        {g.payments.every((p) => !p.issuesInvoices) ? "اطلب عقد التوريد (واتساب)" : "اطلب الفاتورة (واتساب)"}
                      </a>
                      {g.supplierSlug && <LinkButton href={`/suppliers/${g.supplierSlug}`} size="sm">ملفّه</LinkButton>}
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
