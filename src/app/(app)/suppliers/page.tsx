import { Suspense } from "react";
import { SupplierLeverage } from "@/components/supplier-leverage";
import { SectionBoundary } from "@/components/ui-client";
import { whatsappHref } from "@/lib/supplier-edit";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock, FileWarning, Hourglass, PiggyBank, Receipt, Sparkles, Store, Wallet } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { AccountReview } from "@/components/account-review";
import { Money } from "@/components/money";
import {
  Badge, Callout, Card, DataTable, EmptyState, LinkButton, LinkTabs, Monogram, Section, type Column,
} from "@/components/ui";
import { AgeingBar, Figure } from "@/components/supplier-intel";
import { SUPPLIER, countNoun, INVOICE, PAYMENT_RECORD, DAY } from "@/lib/arabic";
import { buildInvoiceRequest, groupUnbackedBySupplier, invoiceRequestKey } from "@/lib/supplier-requests";
import { loadInvoiceRequestMarks, loadUnbackedPayments } from "@/services/supplier-followups.service";
import { RequestInvoiceLink } from "@/components/request-invoice-link";
import { loadBalanceTotals, loadOpenInvoiceAges, loadOverdueBalances } from "@/services/supplier-balance.service";
import { loadSupplierDirectory } from "@/services/supplier-intel.service";
import { listOpenFindings } from "@/services/supplier-analysis.service";
import { FindingsList, RunAnalysis, type FindingView } from "@/components/ai-analysis";
import { formatDay } from "@/lib/riyadh-time";
import { needsContract, needsPaperUpload } from "@/lib/supplier-policy-rules";
import { ageOwed, ageTone, type OwedAgeing } from "@/lib/supplier-intel";
import { txHref } from "@/lib/inspector";
import { T } from "@/components/i18n/t";

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
  searchParams: Promise<{ unbacked?: string; view?: string; sort?: string }>;
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
          title="لا يوجد مورّدون بعد."
          hint="يُضاف المورّد تلقائياً حين يقرأ النظام أول فاتورة منه، أو بالضغط على «مورّد جديد» في شاشة الرفع."
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
    { id: "all" as const, label: "الكل", count: rows.length },
    ...(showAmounts
      ? [
          { id: "owed" as const, label: "عليك", count: rows.filter(inView.owed).length },
          { id: "overdue" as const, label: "متأخر", count: rows.filter(inView.overdue).length },
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
      sortBy: (r) => r.nameAr,
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
                  : !r.issuesInvoices ? "لا يصدر فواتير، ويُسدَّد له عند الشراء"
                  : r.invoiceCount > 0 ? "فواتيره مسدّدة" : "دفعات بلا فواتير"}
              {r.contract && <Badge tone="warn">يحتاج عقد توريد</Badge>}
              {r.paper && <Badge>فواتيره ورقية</Badge>}
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
            /* «من أكبرُ دَين؟»: ما عليك موجباً، وما لك سالباً، ومن لا تعاملَ معه مجهولٌ يقع آخراً لا صفراً */
            sortBy: (r) => (r.owedMinor > 0 ? r.owedMinor : r.creditLeftMinor > 0 ? -r.creditLeftMinor : r.idle ? null : 0),
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
                r.openCount > 0 ? (
                  /* فاتورةٌ مفتوحة يقابلها مالٌ لم يُنسب — ليس «متّزناً» يُترك */
                  <span className="text-[11px] font-bold text-warn">متوازن على الورق</span>
                ) : (
                  <span className="text-[11px] text-muted">{r.idle ? "—" : "متوازن"}</span>
                )
              ),
          },
          {
            key: "age",
            header: "أقدم مبلغ مستحق",
            sortBy: (r) => r.ageing.oldestOwedDays,
            sortFirst: "desc",
            cell: (r) =>
              r.ageing.oldestOwedDays === null ? (
                <span className="text-muted">—</span>
              ) : (
                <Badge tone={ageTone(r.ageing.oldestOwedDays) === "muted" ? undefined : ageTone(r.ageing.oldestOwedDays)} dot>
                  <T s="منذ {0}" a={[countNoun(r.ageing.oldestOwedDays, DAY)]} /></Badge>
              ),
          },
        ] satisfies Column<Row>[])
      : []),
    {
      key: "last",
      header: "آخر تعامل",
      secondary: true,
      sortBy: (r) => r.lastActivity ?? null,
      sortFirst: "desc",
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
        ? "لمن تدين، وبكم، ومنذ متى، بعد خصم ما دفعته لكل مورّد وما بقي لك عنده."
        : "المورّدون وفواتيرهم المفتوحة وآخر تعامل معهم. المبالغ لا تظهر لدورك."}
      actions={
        showAmounts && can(user.role, "payment:approve") ? (
          <>
            <AccountReview />
            {totals.owedMinor > 0 && <LinkButton href="/payments" variant="primary" icon={Wallet}>خطّط الدفعة</LinkButton>}
          </>
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
                ? `${countNoun(totals.owedSuppliers, SUPPLIER)} · عن ${countNoun(totals.openInvoiceCount, INVOICE)} مفتوحة، بعد خصم ما دفعته لهم`
                : "كل فاتورة مفتوحة يغطيها ما دفعته."}
            >
              <AgeingBar buckets={allBuckets} />
            </Figure>
            <Figure
              icon={Hourglass}
              label="متأخر أكثر من 60 يوماً"
              href="/suppliers?view=overdue"
              tone={overdueMinor > 0 ? "danger" : "ok"}
              value={<Money minor={overdueMinor} />}
              sub={overdueMinor > 0
                ? `عند ${countNoun(overdue.length, SUPPLIER)} · أقدمها منذ ${countNoun(oldestOverdue, DAY)}`
                : "لا مبلغ متأخر أكثر من ستين يوماً بعد خصم أرصدتك."}
            />
            <Figure
              icon={PiggyBank}
              label="رصيد لك عندهم"
              href="/suppliers?view=credit"
              value={<Money minor={totals.creditLeftMinor} />}
              sub={totals.creditLeftMinor > 0
                ? `${countNoun(totals.creditSuppliers, SUPPLIER)} · مبالغ دفعتها ولم تصلك فواتيرها، وستُخصم من فواتيرهم القادمة`
                : "كل مبلغ دفعته وصلتك فاتورته."}
            />
          </div>
        ) : (
          /* مورّدون مسجَّلون ولا فاتورةَ ولا دفعة: «عليك صفر» كذبٌ عن غير علم */
          <Callout
            tone="accent"
            icon={Sparkles}
            title="لا يعرف النظام بعد لمن تدين"
            action={<LinkButton href="/upload" variant="primary" size="sm">ارفع مستنداً</LinkButton>}
          >
            لم تُسجَّل أي فاتورة أو دفعة لأي مورّد. ارفع فواتيرهم واستورد كشف البنك، ليظهر هنا ما عليك وما لك ومنذ متى.
          </Callout>
        )
      )}

      {showAmounts && knows && (
        <SectionBoundary what="أرقام التفاوض">
          <Suspense fallback={null}>
            <SupplierLeverage />
          </Suspense>
        </SectionBoundary>
      )}

      {showAmounts && unbackedTotal > 0 && !unbackedView && (
        <Callout
          tone="info"
          icon={FileWarning}
          className="mt-4"
          action={<LinkButton href="/suppliers?unbacked=1#unbacked" size="sm">اعرض الدفعات واطلب فواتيرها</LinkButton>}
        >
          <T s="{0}، {1}. بدون فاتورة ضريبية لا يمكن خصم ضريبة المدخلات." a={[<strong key="0" className="text-ink"><T s="{0} دفعتها ولم تصلك مستنداتها" a={[countNoun(unbackedPayments.length, PAYMENT_RECORD)]} /></strong>, <Money key="1" minor={unbackedTotal} />]} /></Callout>
      )}

      {unbackedView && showAmounts && <UnbackedSection groups={unbackedGroups} count={unbackedPayments.length} canRequest={can(user.role, "supplier:edit")} />}

      {/* ── القائمة ── */}
      <Section
        title="المورّدون"
        icon={Store}
        count={rows.length}
        hint={showAmounts ? "يظهر أولاً من تدين له بأكبر مبلغ. ابحث بالاسم، أو بالاسم الذي يظهر به في كشف البنك." : undefined}
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
          <Callout tone="warn" icon={Clock} className="mb-3" title="مطلوب من بعض المورّدين">
            {needContract.length > 0 && (
              <p id="no-contract" className="scroll-mt-24">
                <T s="{0}، لأنهم لا يصدرون فواتير ضريبية، وبدون عقد مكتوب لا يمكن خصم الضريبة ولا إثبات المصروف: {1}. وإن كان المورّد لا يحتاج عقداً فأوقف ذلك من صفحته." a={[<span key="0" className="font-bold text-ink"><T s="{0} يحتاج عقد توريد" a={[countNoun(needContract.length, SUPPLIER)]} /></span>, needContract.map((r, i) => (
                  <span key={r.id}>
                    {i > 0 && " · "}
                    <Link href={`/suppliers/${r.slug}?tab=profile`} className="font-medium underline underline-offset-4 hover:text-ink">{r.nameAr}</Link>
                  </span>
                ))]} /></p>
            )}
            {paperOnly.length > 0 && (
              <p className={needContract.length > 0 ? "mt-1" : ""}>
                <T s="{0}: فاتورته في يدك، وكل المطلوب أن تصوّرها وترفعها: {1}." a={[<span key="0" className="font-bold text-ink"><T s="{0} فواتيره ورقية" a={[countNoun(paperOnly.length, SUPPLIER)]} /></span>, paperOnly.map((r) => r.nameAr).join(" · ")]} /></p>
            )}
          </Callout>
        )}

        <DataTable
          rows={shown}
          keyOf={(r) => r.id}
          hrefOf={(r) => `/suppliers/${r.slug}`}
          searchOf={(r) => [r.nameAr, r.nameEn, r.slug, r.vatNumber, r.aliases].filter(Boolean).join(" ")}
          searchLabel="ابحث باسم المورّد أو اسمه في البنك"
          sort={params.sort ?? null}
          columns={columns}
          empty={
            <EmptyState
              compact
              icon={Store}
              title={
                view === "owed" ? "لا يوجد مورّد تدين له بشيء."
                : view === "overdue" ? "لا مبلغ متأخر أكثر من ستين يوماً."
                : view === "credit" ? "لا يوجد رصيد لك عند أي مورّد."
                : view === "idle" ? "تعاملت مع كل المورّدين المسجّلين."
                : "لا مورّدين في هذه القائمة."
              }
              hint={view === "owed" || view === "overdue" ? "كل فاتورة مفتوحة يغطيها ما دفعته، بحسب الفواتير والدفعات المسجّلة." : undefined}
              action={<LinkButton href="/suppliers" size="sm">كل المورّدين</LinkButton>}
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
          hint="يقرأ التحليل فواتير المورّد ودفعاته وكشوفه، ويقترح ما يصحّح حسابه. الأرقام يحسبها النظام، ولا يُسجَّل أي اقتراح حتى تعتمده."
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
              title="لا توجد اقتراحات تنتظر قرارك."
              hint="شغّل التحليل على المورّدين الذين بينك وبينهم رصيد. يقارن فواتيرهم بدفعاتهم وكشوفهم ويقترح التصحيحات، ولا يُسجَّل شيء حتى تعتمده."
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
async function UnbackedSection({ groups, count, canRequest }: { groups: ReturnType<typeof groupUnbackedBySupplier>; count: number; canRequest: boolean }) {
  const marks = await loadInvoiceRequestMarks();
  return (
    <div id="unbacked" className="scroll-mt-28">
      <Section
        title="دفعات غير مربوطة بفواتير"
        icon={FileWarning}
        count={count}
        hint={`عند ${countNoun(groups.filter((g) => g.supplierId).length, SUPPLIER)}. بدون فاتورة ضريبية لا يمكن خصم ضريبة المدخلات. والمورّد الذي لا يصدر فواتير يُطلب منه عقد توريد بدلاً منها، وتُحسب دفعته هنا كغيرها لأن المبلغ خرج فعلاً.`}
        action={<LinkButton href="/suppliers" size="sm" variant="quiet">كل الحسابات</LinkButton>}
      >
        {groups.length === 0 ? (
          <EmptyState compact title="لا توجد دفعات بلا فاتورة." hint="لكل ما دُفع مستند." />
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 xl:grid-cols-2">
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
                        {g.supplierId ? " بلا فاتورة" : " المورّد غير معروف. افتح الحركة البنكية وحدّده"}
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
                          <T s="{0} · من أصل {1}{2}" a={[formatDay(p.paidOn), <Money key="1" minor={p.amountMinor} />, p.bankTransactionId && (
                            <>
                              {" · "}
                              <Link href={txHref(p.bankTransactionId)} className="inline-flex min-h-11 items-center font-medium text-accent hover:underline sm:min-h-0">
                                الحركة البنكية
                              </Link>
                            </>
                          )]} /></span>
                        <span className="font-bold"><Money minor={p.unbackedMinor} /></span>
                      </li>
                    ))}
                  </ul>
                  {g.supplierId && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <RequestInvoiceLink
                        href={whatsappHref(g.supplierPhone, buildInvoiceRequest(g))}
                        supplierId={g.supplierId}
                        label={g.payments.every((p) => !p.issuesInvoices) ? "اطلب عقد التوريد (واتساب)" : "اطلب الفاتورة (واتساب)"}
                        requestedDaysAgo={marks.get(invoiceRequestKey(g) ?? "") ?? null}
                        canMark={canRequest}
                      />
                      {g.supplierSlug && <LinkButton href={`/suppliers/${g.supplierSlug}`} size="sm">صفحة المورّد</LinkButton>}
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
