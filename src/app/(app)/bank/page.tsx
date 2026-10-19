import { parseLedgerSearch } from "@/lib/bank/ledger-search";
import { BankHeldRows } from "@/components/bank-held-rows";
import { loadOpenHeldRows } from "@/services/bank-held.service";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft, CalendarRange, CircleAlert, CircleCheck, Clock3, Inbox, Landmark,
  ListFilter, Search, Upload,
} from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Badge, DataTable, EmptyState, LinkButton, LinkTabs, NoAccess, Section, buttonClass } from "@/components/ui";
import { CategoryBadge, DirectionIcon } from "@/components/bank-bits";
import { txHref } from "@/lib/inspector";
import { BankImport } from "@/components/bank-import";
import { MatchExplain } from "@/components/match-explain";
import { ReconcileQueue } from "@/components/reconcile-queue";
import { AccountReview } from "@/components/account-review";
import { loadHandPaymentLinks } from "@/services/account-review.service";
import { CATEGORY_LABEL } from "@/lib/bank/rules";
import { countNoun, DAY, GROUP, ITEM, TRANSACTION } from "@/lib/arabic";
import { daysSinceRiyadh, formatDay, formatMonth } from "@/lib/riyadh-time";
import { BANK_STALE_DAYS } from "@/lib/attention";
import { formatRiyalsDisplay } from "@/lib/money";
import {
  TX_VIEWS, txLimit, countOpenDoublePaid, loadBankCoverage, loadBankQueue, loadLedger,
  type LedgerRow, type TxView,
} from "@/services/bank-view.service";
import { T } from "@/components/i18n/t";

export const dynamic = "force-dynamic";

const VIEW_LABEL: Record<TxView, string> = {
  out: "المبالغ الخارجة",
  in: "المبالغ الداخلة",
  fees: "رسوم البنك والشبكة",
  unknown: "غير مصنّفة",
  all: "الكلّ",
};

/**
 * حركة البنك — ثلاثةُ أسئلةٍ بترتيبها:
 *
 *   ١. **إلى أين يصل الكشف؟** كلُّ رقمٍ في النظام على ما قبل آخر يومٍ فيه،
 *      فالتغطيةُ أوّلُ ما يُقرأ، ومعها فعلُ الاستيراد حين تقف.
 *   ٢. **ما الذي ينتظرني؟** الطابور — مجموعةً مجموعة، ولكلٍّ فعلُه.
 *   ٣. **ماذا حدث؟** السجلّ: بحثٌ فوريّ، وألسنةٌ وشهورٌ في العنوان، وكلُّ
 *      مطابقةٍ تقول لماذا ويُتراجَع عنها.
 *
 * ثمّ الاستيراد في آخرها بمرساته `#import` — روابطُ الرئيسية ولوحة الأوامر
 * تهبط إليه.
 */
export default async function BankPage({
  searchParams,
}: {
  searchParams: Promise<{ tx?: string; show?: string; month?: string; q?: string }>;
}) {
  const params = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/login?from=/bank");
  if (!can(user.role, "bank:view")) {
    return (
      <PageShell user={user} width="wide" title="حركات البنك">
        <NoAccess what="كشف البنك" />
      </PageShell>
    );
  }

  const view: TxView = (TX_VIEWS as readonly string[]).includes(params.show ?? "")
    ? (params.show as TxView)
    : "out";
  const month = params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : null;
  const search = parseLedgerSearch(params.q);

  /* الرابطُ القديم `/bank?tx=` يفتح ملفَّ الحركة — تبقى الإشاراتُ المحفوظة تعمل */
  if (params.tx) redirect(txHref(params.tx));

  const [coverage, queue, ledger, doublePaid, handLinks, held] = await Promise.all([
    loadBankCoverage(),
    loadBankQueue(),
    loadLedger(view, month, search),
    countOpenDoublePaid(),
    can(user.role, "payment:approve") ? loadHandPaymentLinks() : Promise.resolve([]),
    loadOpenHeldRows(),
  ]);

  const canApprove = can(user.role, "payment:approve");
  const canEdit = can(user.role, "bank:edit");
  const empty = coverage.txCount === 0;
  const staleDays = coverage.lastDay ? daysSinceRiyadh(coverage.lastDay) : null;
  const stale = staleDays !== null && staleDays > BANK_STALE_DAYS;
  const queuedTx = queue.groups.reduce((n, g) => n + g.items.length, 0);

  const href = (next: { show?: TxView; month?: string | null; q?: null }) => {
    const q = new URLSearchParams();
    const s = next.show ?? view;
    const m = next.month === undefined ? month : next.month;
    if (s !== "out") q.set("show", s);
    if (m) q.set("month", m);
    /* البحثُ يبقى مع تبديل اللسان والشهر — ويُمسَح بزرّه */
    if (search && next.q !== null) q.set("q", search.text);
    const qs = q.toString();
    return `/bank${qs ? `?${qs}` : ""}#transactions`;
  };

  return (
    <PageShell
      user={user}
      width="wide"
      /* اسمُ الصفحة هو اسمُ لسانها حرفاً بحرف — «فعلٌ واحد باسمٍ واحد» */
      title="حركات البنك"
      intro="كل ما خرج من حسابك وما دخل إليه كما يظهر في كشف البنك. في الأعلى ما ينتظر قرارك، ثم سجل الحركات كاملاً. لكل مطابقة سببها، ويمكنك التراجع عنها."
      actions={canEdit ? (
        <LinkButton href="#import" icon={Upload} variant={empty ? "primary" : "secondary"}>
          استورد كشفاً
        </LinkButton>
      ) : undefined}
    >
      {empty ? (
        /*
          بلا كشفٍ لا يُعرض «إيداعات مدى ٠٫٠٠» بالأخضر ولا «كلُّها مصنّفة» —
          صفرٌ عن غير علم. يُقال ما ينقص، والاستيرادُ تحته مباشرةً.
        */
        <EmptyState
          icon={Landmark}
          title="استورد أول كشف حساب."
          hint="بدون كشف الحساب لا يعرف النظام ما خرج من حسابك وما دخل إليه، ولا أي فاتورة سُدّدت، لذلك لا تظهر هنا أرقام. نزّل كشف الحساب من تطبيق بنكك (Excel أو PDF) وارفعه أدناه، وستظهر لك معاينة قبل حفظ أي شيء."
          action={canEdit ? <LinkButton href="#import" variant="primary" icon={Upload}>ابدأ الاستيراد</LinkButton> : undefined}
        />
      ) : (
        <>
          <CoverageBand
            firstDay={coverage.firstDay}
            lastDay={coverage.lastDay}
            txCount={coverage.txCount}
            staleDays={stale ? staleDays : null}
            settledMinor={coverage.settledMinor}
            canEdit={canEdit}
          />

          {/* «مالٌ خرج مرّتين» مكانُ حسمه واحد — وهذه إحالةٌ إليه لا نسخةٌ منه */}
          {doublePaid > 0 && (
            <div id="double-paid" className="mt-4 flex scroll-mt-28 flex-wrap items-center gap-3 rounded-xl border border-danger/25 bg-danger-bg px-4 py-3">
              <CircleAlert className="h-[18px] w-[18px] shrink-0 text-danger" strokeWidth={2} aria-hidden />
              <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink-soft">
                <T s="{0}يمكنك مطالبة الجهة التي استلمت المبلغ بإعادته، فلا يمكن تصحيحه بقيد في النظام." a={[<span key="0" className="block text-[13px] font-bold text-danger"><T s="مبلغ خرج مرتين في يوم واحد: {0}" a={[countNoun(doublePaid, ITEM)]} /></span>]} /></p>
              <LinkButton href="/attention?item=duplicate-payments" variant="primary" size="sm">قرّر بشأنه في «يحتاج قرارك»</LinkButton>
            </div>
          )}

          {/* ── ما ينتظر قرارك ── */}
          <Section
            id="queue"
            title="ما ينتظر قرارك"
            icon={Inbox}
            count={queue.groups.length + held.length > 0 ? queue.groups.length + held.length : undefined}
            hint={queue.groups.length > 0
              ? `${countNoun(queue.groups.length, GROUP)} تضم ${countNoun(queuedTx, TRANSACTION)}. نسألك سؤالاً واحداً عن الحركات المتشابهة، ويتذكر النظام ما تؤكده.`
              : undefined}
          >
            {/*
              حوالةٌ في الطابور سدادُها مقيَّدٌ بيد — «لا فاتورة مفتوحة» صحيحٌ حرفاً
              وخطأٌ معنىً: فاتورتُها أُغلقت بتلك الدفعة. فيُقال ذلك فوق الطابور، وبابُه بجانبه.
            */}
            {handLinks.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-accent-line bg-accent-soft/50 px-4 py-3">
                <p className="min-w-0 flex-1 text-xs leading-relaxed">
                  <T s="{0}: {1}. أُغلقت الفاتورة بذلك السداد، فلم يجد النظام فاتورة مفتوحة يطابقها. اربط الحركة بذلك السداد ولا تسجّله مرة ثانية." a={[<span key="0" className="font-bold">
                    {handLinks.length === 1 ? "حركة سبق أن سجّلت سدادها يدوياً" : `${countNoun(handLinks.length, TRANSACTION)} سبق أن سجّلت سداد كل منها يدوياً`}
                  </span>, handLinks.map((l) => `${l.supplierName} ${formatRiyalsDisplay(l.transferMinor)}`).join("، ")]} /></p>
                <AccountReview size="sm" variant="primary" />
              </div>
            )}
            <BankHeldRows rows={held} canEdit={canEdit} />
            {queue.groups.length > 0 ? (
              <ReconcileQueue groups={queue.groups} suppliers={queue.suppliers} canApprove={canApprove} canEdit={canEdit} />
            ) : (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ok/25 bg-ok-bg px-5 py-4">
                <CircleCheck className="h-6 w-6 shrink-0 text-ok" strokeWidth={2} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-ok">لا توجد في الكشف حركات تنتظر التصنيف.</p>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    <T s="صُنّفت كل الحركات المستوردة{0}{1} أما حوالات المورّدين التي تنتظر فواتيرها فتجدها في «يحتاج قرارك»." a={[coverage.lastDay ? <> <T s=" حتى {0}" a={[<bdi key="0">{formatDay(coverage.lastDay)}</bdi>]} /></> : null, stale ? "، وما بعد ذلك لم يُستورد بعد." : "."]} /></p>
                </div>
                <Link href="/attention" className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-accent hover:underline sm:min-h-0">
                  <T s="افتح «يحتاج قرارك» {0}" a={[<ArrowLeft key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></Link>
              </div>
            )}
          </Section>

          {/* ── السجلّ ── */}
          <Section
            id="transactions"
            title="سجل الحركات"
            icon={ListFilter}
            hint="لمن خرج المال ومن أين دخل، وحالة كل حركة. تُحسب الحالة دائماً من الحركة نفسها."
          >
            <div className="mb-3 space-y-2">
              <LinkTabs
                label="نوع الحركة"
                items={TX_VIEWS
                  .filter((v) => v !== "unknown" || ledger.counts.unknown > 0 || view === "unknown")
                  .map((v) => ({ href: href({ show: v }), label: VIEW_LABEL[v], count: ledger.counts[v], active: v === view }))}
              />
              {ledger.months.length > 1 && (
                <LinkTabs
                  label="الشهر"
                  items={[
                    { href: href({ month: null }), label: "كل الأشهر", active: month === null },
                    ...ledger.months.map((m) => ({ href: href({ month: m }), label: formatMonth(m), active: m === month })),
                  ]}
                />
              )}
            </div>

            {/* بحثٌ في الحركات كلِّها عند الخادم — لا في الصفوف المرسومة وحدها */}
            <form action="/bank#transactions" className="mb-3 flex flex-wrap items-center gap-2" role="search">
              <label className="relative flex min-w-0 flex-1 basis-64 items-center sm:max-w-md">
                <Search className="pointer-events-none absolute start-3 h-4 w-4 text-muted" strokeWidth={2} aria-hidden />
                <input
                  name="q"
                  type="search"
                  defaultValue={search?.text ?? ""}
                  placeholder="ابحث في كل الحركات: بالمبلغ أو الاسم أو نص البنك"
                  aria-label="ابحث في كل الحركات بالمبلغ أو الاسم أو نص البنك"
                  dir="auto"
                  className="min-h-11 w-full rounded-lg border border-line-input bg-raised ps-9 pe-3 text-sm sm:min-h-9"
                />
              </label>
              {view !== "out" && <input type="hidden" name="show" value={view} />}
              {month && <input type="hidden" name="month" value={month} />}
              <button type="submit" className={buttonClass("secondary", "sm")}>ابحث</button>
              {search && <LinkButton href={href({ q: null })} size="sm" variant="quiet">امسح البحث</LinkButton>}
            </form>

            {search ? (
              <p className="mb-3 text-xs text-ink-soft" role="status">
                <T s="{0} «{1}»{2} في «{3}»{4}{5}{6}" a={[ledger.total === 0 ? "لا توجد حركات مطابقة" : <><T s="{0} نتيجة مطابقة" a={[<span key="0" className="nums">{ledger.total}</span>]} /></>, <bdi key="1">{search.text}</bdi>, search.amount ? " (مبلغ أو نص)" : "", VIEW_LABEL[view], month ? ` في ${formatMonth(month)}` : " في كل الأشهر", ledger.total > ledger.rows.length && <><T s=". المعروض هو أحدث {0}، فضيّق البحث أو اختر شهراً" a={[<span key="0" className="nums">{ledger.rows.length}</span>]} /></>, view !== "all" && <> · <Link href={href({ show: "all" })} className="font-bold text-accent hover:underline">ابحث في كل الأنواع</Link></>]} /></p>
            ) : ledger.total > ledger.rows.length && (
              <p className="mb-3 flex items-start gap-2 text-xs text-muted">
                <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                <span><T s="المعروض هو أحدث {0} من {1}. ابحث في كل الحركات من الأعلى، أو اختر شهراً لترى حركاته." a={[countNoun(txLimit(month), TRANSACTION), <span key="1" className="nums">{ledger.total}</span>]} /></span>
              </p>
            )}

            <DataTable
              rows={ledger.rows}
              keyOf={(t) => t.id}
              hrefOf={(t) => txHref(t.id)}
              searchOf={(t) => [t.who, t.description, CATEGORY_LABEL[t.category], formatDay(t.valueDate), formatRiyalsDisplay(t.amountMinor)].filter(Boolean).join(" ")}
              searchLabel="تصفية المعروض"
              empty={
                <EmptyState
                  compact
                  icon={ListFilter}
                  title={search ? `لا توجد حركات تطابق «${search.text}».` : `لا توجد حركات في «${VIEW_LABEL[view]}»${month ? ` في ${formatMonth(month)}` : ""}.`}
                  hint="جرّب نوعاً أو شهراً آخر."
                  action={<LinkButton href={href({ show: "all", month: null })} size="sm">اعرض الكل</LinkButton>}
                />
              }
              columns={[
                {
                  key: "who", header: "الجهة", primary: true,
                  cell: (t) => (
                    <span className="flex min-w-0 items-start gap-2.5">
                      <DirectionIcon direction={t.direction} />
                      <span className="min-w-0">
                        <span className="block truncate font-bold" dir="auto">{t.who || t.description?.trim().slice(0, 60) || "حركة بلا وصف"}</span>
                        <span className="mt-0.5 block max-w-[26rem] truncate text-[11px] font-normal text-muted" dir="auto" title={t.description ?? undefined}>
                          {t.description}
                        </span>
                      </span>
                    </span>
                  ),
                },
                { key: "date", header: "التاريخ", cell: (t) => <bdi className="whitespace-nowrap text-ink-soft">{formatDay(t.valueDate)}</bdi> },
                { key: "kind", header: "التصنيف", secondary: true, cell: (t) => <CategoryBadge category={t.category} /> },
                {
                  key: "amount", header: "المبلغ", numeric: true,
                  cell: (t) => (
                    <span className={`relative font-bold ${t.direction === "CREDIT" ? "text-ok" : ""}`}>
                      <span className="sr-only">{t.direction === "DEBIT" ? "خارج" : "داخل"} </span>
                      <span dir="ltr">{t.direction === "CREDIT" ? "+" : "−"}<Money minor={t.amountMinor} /></span>
                    </span>
                  ),
                },
                {
                  key: "state", header: "الحالة", wrap: true,
                  cell: (t) => <span id={`tx-${t.id}`} className="block scroll-mt-28"><StateCell tx={t} queued={queue.queuedIds.has(t.id)} canUndo={canApprove} /></span>,
                },
              ]}
            />
          </Section>
        </>
      )}

      {/* ── الاستيراد — `#import` مرساةٌ تهبط إليها روابطُ الرئيسية ولوحة الأوامر ── */}
      <Section
        id="import"
        title="استيراد كشف"
        icon={Upload}
        hint="لا يُستورد الملف نفسه مرتين، فتُسجَّل الحركات الجديدة فقط، وستظهر لك معاينة قبل الحفظ."
      >
        {canEdit
          ? <BankImport openInvoiceCount={coverage.openInvoices} suppliers={queue.suppliers} />
          : <EmptyState compact title="ليست لديك صلاحية استيراد الكشف." hint="اطلب من مالك الحساب أن يستورده بنفسه أو أن يمنحك الصلاحية." />}
      </Section>
    </PageShell>
  );
}

/* ─────────────────────────── القطع ─────────────────────────── */

/**
 * إلى أين يصل الكشف — أوّلُ ما يُقرأ، لأنّ كلَّ رقمٍ في النظام يقف معه.
 * وكان يُقال «١٤٤٠ حركة» ولا يُقال إنّ آخرها قبل ثلاثة أسابيع.
 */
function CoverageBand({
  firstDay, lastDay, txCount, staleDays, settledMinor, canEdit,
}: {
  firstDay: string | null;
  lastDay: string | null;
  txCount: number;
  staleDays: number | null;
  settledMinor: number;
  canEdit: boolean;
}) {
  const stale = staleDays !== null;
  return (
    <div className={`flex flex-wrap items-center gap-x-6 gap-y-4 rounded-2xl border px-4 py-4 shadow-raised sm:px-5 ${stale ? "border-warn/30 bg-warn-bg" : "border-line bg-raised"}`}>
      <div className="flex min-w-[15rem] flex-1 items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${stale ? "bg-raised text-warn" : "bg-accent-soft text-accent"}`}>
          {stale ? <CircleAlert className="h-5 w-5" strokeWidth={2} aria-hidden /> : <CalendarRange className="h-5 w-5" strokeWidth={2} aria-hidden />}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-muted">آخر كشف مستورد</p>
          <p className={`mt-0.5 text-lg font-bold leading-snug ${stale ? "text-warn" : ""}`}>
            {lastDay ? <><T s="حتى {0}" a={[<bdi key="0">{formatDay(lastDay)}</bdi>]} /></> : "غير معروف"}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
            {stale
              ? <><T s="يتوقف الكشف عند {0}. لا يعرف النظام ما بعد هذا التاريخ، وكل الأرقام مبنية على ما قبله." a={[countNoun(staleDays, DAY)]} /></>
              : <><T s="من {0} · {1}" a={[<bdi key="0">{formatDay(firstDay)}</bdi>, countNoun(txCount, TRANSACTION)]} /></>}
          </p>
        </div>
      </div>
      <dl className="min-w-0">
        <dt className="text-xs font-bold text-muted">إيداعات الشبكة في هذه الفترة</dt>
        <dd className="mt-0.5 text-lg font-bold text-ok"><Money minor={settledMinor} /></dd>
        <dd className="text-[11px] text-muted">ما دخل من البطاقات، وهو ليس «المبيعات»</dd>
      </dl>
      {stale && canEdit && (
        <a href="#import" className={buttonClass("primary")}>
          <T s="{0}استورد الأحدث" a={[<Upload key="0" className="h-4 w-4" strokeWidth={2} aria-hidden />]} /></a>
      )}
    </div>
  );
}

/** حالُ الحركة في السجلّ — والفعلُ بجانبه حيث يوجد. */
function StateCell({ tx, queued, canUndo }: { tx: LedgerRow; queued: boolean; canUndo: boolean }) {
  const m = tx.match;
  if (m.matched || m.disposition !== null || m.outcome === "NOT_A_PAYMENT") {
    return <MatchExplain match={m} canUndo={canUndo} title={tx.who ?? undefined} />;
  }
  if (tx.pending) {
    return queued ? (
      <a href="#queue" className="relative z-10 inline-flex min-h-11 items-center sm:min-h-0">
        <Badge tone="warn" dot>تنتظر قرارك، وهي في القائمة أعلاه</Badge>
      </a>
    ) : (
      <Link href="/attention" className="relative z-10 inline-flex min-h-11 items-center sm:min-h-0">
        <Badge tone="warn" dot>تنتظر قرارك في «يحتاج قرارك»</Badge>
      </Link>
    );
  }
  return <span className="text-[11px] text-muted">لا تحتاج إلى مطابقة</span>;
}
