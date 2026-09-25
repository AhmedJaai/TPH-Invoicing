import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowDownLeft, ArrowLeft, ArrowUpRight, CalendarRange, CircleAlert, CircleCheck, Clock3, Inbox, Landmark,
  ListFilter, Upload, X,
} from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Badge, DataTable, EmptyState, KeyValue, LinkButton, LinkTabs, NoAccess, Section, buttonClass } from "@/components/ui";
import { BankImport } from "@/components/bank-import";
import { MatchExplain } from "@/components/match-explain";
import { ReconcileQueue } from "@/components/reconcile-queue";
import { CATEGORY_LABEL, type TxCategory } from "@/lib/bank/rules";
import { countNoun, DAY, GROUP, ITEM, TRANSACTION } from "@/lib/arabic";
import { daysSinceRiyadh, formatDay, formatMonth } from "@/lib/riyadh-time";
import { BANK_STALE_DAYS } from "@/lib/attention";
import { formatRiyalsDisplay } from "@/lib/money";
import {
  TX_VIEWS, txLimit, countOpenDoublePaid, loadBankCoverage, loadBankQueue, loadFocusedTx, loadLedger,
  type LedgerRow, type TxView,
} from "@/services/bank-view.service";

export const dynamic = "force-dynamic";

const VIEW_LABEL: Record<TxView, string> = {
  out: "الصادر",
  in: "الوارد",
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
  searchParams: Promise<{ tx?: string; show?: string; month?: string }>;
}) {
  const params = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/login?from=/bank");
  if (!can(user.role, "bank:view")) {
    return (
      <PageShell user={user} width="wide" title="حركة البنك">
        <NoAccess what="كشف البنك" />
      </PageShell>
    );
  }

  const view: TxView = (TX_VIEWS as readonly string[]).includes(params.show ?? "")
    ? (params.show as TxView)
    : "out";
  const month = params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : null;

  const [coverage, queue, ledger, doublePaid, focused] = await Promise.all([
    loadBankCoverage(),
    loadBankQueue(),
    loadLedger(view, month),
    countOpenDoublePaid(),
    params.tx ? loadFocusedTx(params.tx) : Promise.resolve(null),
  ]);

  const canApprove = can(user.role, "payment:approve");
  const canEdit = can(user.role, "bank:edit");
  const empty = coverage.txCount === 0;
  const staleDays = coverage.lastDay ? daysSinceRiyadh(coverage.lastDay) : null;
  const stale = staleDays !== null && staleDays > BANK_STALE_DAYS;
  const queuedTx = queue.groups.reduce((n, g) => n + g.items.length, 0);

  const href = (next: { show?: TxView; month?: string | null }) => {
    const q = new URLSearchParams();
    const s = next.show ?? view;
    const m = next.month === undefined ? month : next.month;
    if (s !== "out") q.set("show", s);
    if (m) q.set("month", m);
    const qs = q.toString();
    return `/bank${qs ? `?${qs}` : ""}#transactions`;
  };

  return (
    <PageShell
      user={user}
      width="wide"
      /* اسمُ الصفحة هو اسمُ لسانها حرفاً بحرف — «فعلٌ واحد باسمٍ واحد» */
      title="حركة البنك"
      intro="ما خرج من حسابك وما دخل إليه كما في الكشف — ما ينتظر قرارك أوّلاً، ثمّ السجلّ كاملاً. وكلُّ مطابقةٍ تقول لماذا ويُتراجَع عنها."
      actions={canEdit ? (
        <LinkButton href="#import" icon={Upload} variant={empty ? "primary" : "secondary"}>
          استورد كشفاً
        </LinkButton>
      ) : undefined}
    >
      {/* ── الحركة التي فُتحت عليها الصفحة — من الطابور أو البحث ── */}
      {focused && <FocusCard tx={focused} canUndo={canApprove} />}
      {params.tx && !focused && (
        <div role="status" className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-warn/25 bg-warn-bg px-4 py-3 text-xs text-ink-soft">
          <CircleAlert className="h-4 w-4 shrink-0 text-warn" strokeWidth={2} aria-hidden />
          <span className="flex-1">لا توجد الحركة المطلوبة — ربما دُمجت بنسختها عند تنظيف المكرَّر.</span>
          <Link href="/bank" className="font-bold text-accent hover:underline">اعرض الصفحة كاملة</Link>
        </div>
      )}

      {empty ? (
        /*
          بلا كشفٍ لا يُعرض «إيداعات مدى ٠٫٠٠» بالأخضر ولا «كلُّها مصنّفة» —
          صفرٌ عن غير علم. يُقال ما ينقص، والاستيرادُ تحته مباشرةً.
        */
        <EmptyState
          icon={Landmark}
          title="استورد أوّلَ كشفٍ لحسابك."
          hint="بلا كشفٍ لا يعرف النظامُ ما خرج ولا ما دخل، ولا أيَّ فاتورةٍ سُدّدت — فلا يُعرَض هنا رقمٌ يُقرأ صفراً. نزّل كشف الحساب من بنكك (Excel أو PDF) وارفعه أدناه؛ تُعرَض عليك معاينةٌ قبل أن يُحفظ شيء."
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
                <span className="block text-[13px] font-bold text-danger">مالٌ خرج مرّتين في يومٍ واحد — {countNoun(doublePaid, ITEM)}</span>
                يُطالَب به الجهةُ ويُسترَدّ، ولا يُصلَح في قيدنا.
              </p>
              <LinkButton href="/attention?item=duplicate-payments" variant="primary" size="sm">احسمه في «يحتاج قرارك»</LinkButton>
            </div>
          )}

          {/* ── ما ينتظر قرارك ── */}
          <Section
            id="queue"
            title="ما ينتظر قرارك"
            icon={Inbox}
            count={queue.groups.length > 0 ? queue.groups.length : undefined}
            hint={queue.groups.length > 0
              ? `${countNoun(queue.groups.length, GROUP)} تضمّ ${countNoun(queuedTx, TRANSACTION)} — سؤالٌ واحد عن كلّ ما يتشابه، وما تؤكّده يصير ذاكرة.`
              : undefined}
          >
            {queue.groups.length > 0 ? (
              <ReconcileQueue groups={queue.groups} suppliers={queue.suppliers} canApprove={canApprove} canEdit={canEdit} />
            ) : (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ok/25 bg-ok-bg px-5 py-4">
                <CircleCheck className="h-6 w-6 shrink-0 text-ok" strokeWidth={2} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-ok">لا حركة في الكشف تنتظر تعريفاً.</p>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    كلُّ ما استُورد عُرف بابُه{coverage.lastDay ? <> حتى <bdi>{formatDay(coverage.lastDay)}</bdi></> : null}
                    {stale ? " — وما بعده لم يُستورَد بعد." : "."} وحوالاتُ المورّدين التي تنتظر فاتورتها في «يحتاج قرارك».
                  </p>
                </div>
                <Link href="/attention" className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-accent hover:underline sm:min-h-0">
                  افتح «يحتاج قرارك» <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                </Link>
              </div>
            )}
          </Section>

          {/* ── السجلّ ── */}
          <Section
            id="transactions"
            title="سجلّ الحركات"
            icon={ListFilter}
            hint="لمن خرج المال وممّن دخل، وأين وقفت كلُّ حركة. والحالُ يُشتقّ من الحركة نفسها لا من ترجيحٍ قديم."
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
                    { href: href({ month: null }), label: "كلّ الأشهر", active: month === null },
                    ...ledger.months.map((m) => ({ href: href({ month: m }), label: formatMonth(m), active: m === month })),
                  ]}
                />
              )}
            </div>

            {ledger.total > ledger.rows.length && (
              <p className="mb-3 flex items-start gap-2 text-xs text-muted">
                <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                <span>يُعرَض أحدثُ {countNoun(txLimit(month), TRANSACTION)} من <span className="nums">{ledger.total}</span> — والبحثُ فيها وحدها. اختر شهراً لترى حركاته كلَّها.</span>
              </p>
            )}

            <DataTable
              rows={ledger.rows}
              keyOf={(t) => t.id}
              searchOf={(t) => [t.who, t.description, CATEGORY_LABEL[t.category], formatDay(t.valueDate), formatRiyalsDisplay(t.amountMinor)].filter(Boolean).join(" ")}
              searchLabel="ابحث بالجهة أو المبلغ أو نصّ البنك"
              empty={
                <EmptyState
                  compact
                  icon={ListFilter}
                  title={`لا حركات في «${VIEW_LABEL[view]}»${month ? ` في ${formatMonth(month)}` : ""}.`}
                  hint="جرّب لساناً آخر أو شهراً آخر."
                  action={<LinkButton href={href({ show: "all", month: null })} size="sm">اعرض الكلّ</LinkButton>}
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
                { key: "kind", header: "الباب", secondary: true, cell: (t) => <CategoryBadge category={t.category} /> },
                {
                  key: "amount", header: "المبلغ", numeric: true,
                  cell: (t) => (
                    <span className={`relative font-bold ${t.direction === "CREDIT" ? "text-ok" : ""}`}>
                      <span className="sr-only">{t.direction === "DEBIT" ? "صادر" : "وارد"} </span>
                      <span dir="ltr">{t.direction === "CREDIT" ? "+" : "−"}<Money minor={t.amountMinor} /></span>
                    </span>
                  ),
                },
                {
                  key: "state", header: "الحال", wrap: true,
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
        hint="الملفّ الذي استُورد من قبل لا يتكرّر — تُقيَّد الحركات الجديدة وحدها، وتُعرَض عليك قبل أن تُحفظ."
      >
        {canEdit
          ? <BankImport openInvoiceCount={coverage.openInvoices} suppliers={queue.suppliers} />
          : <EmptyState compact title="استيراد الكشف خارج صلاحيتك." hint="اطلب من مالك الحساب أن يستورده، أو أن يوسّع صلاحيتك." />}
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
          <p className="text-xs font-bold text-muted">الكشفُ المستورَد</p>
          <p className={`mt-0.5 text-lg font-bold leading-snug ${stale ? "text-warn" : ""}`}>
            {lastDay ? <>حتى <bdi>{formatDay(lastDay)}</bdi></> : "غير معروف"}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
            {stale
              ? <>وقف منذ {countNoun(staleDays, DAY)} — ما بعده لا يعرفه النظام، وكلُّ رقمٍ يقف معه.</>
              : <>من <bdi>{formatDay(firstDay)}</bdi> · {countNoun(txCount, TRANSACTION)}</>}
          </p>
        </div>
      </div>
      <dl className="min-w-0">
        <dt className="text-xs font-bold text-muted">إيداعاتُ الشبكة في هذه الفترة</dt>
        <dd className="mt-0.5 text-lg font-bold text-ok"><Money minor={settledMinor} /></dd>
        <dd className="text-[11px] text-muted">ما دخل من البطاقات — لا «مبيعات»</dd>
      </dl>
      {stale && canEdit && (
        <a href="#import" className={buttonClass("primary")}>
          <Upload className="h-4 w-4" strokeWidth={2} aria-hidden />
          استورد الأحدث
        </a>
      )}
    </div>
  );
}

/** الحركة المطلوبة — بطاقةٌ فوق الصفحة بأدلّتها كاملةً وبابِ التراجع. */
function FocusCard({ tx, canUndo }: { tx: NonNullable<Awaited<ReturnType<typeof loadFocusedTx>>>; canUndo: boolean }) {
  return (
    <section aria-labelledby="focus-title" className="mb-8 overflow-hidden rounded-2xl border border-accent-line bg-raised shadow-lifted">
      <header className="flex flex-wrap items-start gap-3 border-b border-line-soft px-4 py-4 sm:px-5">
        <DirectionIcon direction={tx.direction} large />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-accent">الحركة المطلوبة</p>
          <h2 id="focus-title" className="mt-0.5 text-base font-bold" dir="auto">{tx.who || tx.description?.trim().slice(0, 60) || "حركة بلا وصف"}</h2>
        </div>
        <p className={`text-[1.6rem] font-bold leading-none ${tx.direction === "CREDIT" ? "text-ok" : ""}`}>
          <span dir="ltr" className="inline-flex">{tx.direction === "CREDIT" ? "+" : "−"}<Money minor={tx.amountMinor} /></span>{" "}
          <span className="text-xs font-bold text-muted">ر.س</span>
        </p>
        <Link href="/bank" aria-label="أغلق الحركة المطلوبة" className="grid h-11 w-11 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink sm:h-9 sm:w-9">
          <X className="h-4 w-4" strokeWidth={2} aria-hidden />
        </Link>
      </header>
      <div className="grid gap-5 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="space-y-4">
          <KeyValue
            items={[
              { label: "التاريخ", value: <bdi>{formatDay(tx.valueDate)}</bdi> },
              { label: "الاتّجاه", value: tx.direction === "DEBIT" ? "صادر من الحساب" : "وارد إلى الحساب" },
              { label: "الباب", value: <CategoryBadge category={tx.category} /> },
              { label: "نوع العمليّة", value: tx.transactionType ?? "غير معروف" },
            ]}
          />
          <div>
            <p className="text-[11px] font-medium text-muted">نصُّ البنك</p>
            <p className="mt-1 rounded-lg bg-sunken px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-soft" dir="auto">{tx.description ?? "—"}</p>
          </div>
        </div>
        <MatchExplain match={tx.match} canUndo={canUndo} inline />
      </div>
    </section>
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
        <Badge tone="warn" dot>تنتظر قرارك — في الطابور أعلاه</Badge>
      </a>
    ) : (
      <Link href="/attention" className="relative z-10 inline-flex min-h-11 items-center sm:min-h-0">
        <Badge tone="warn" dot>تنتظر قرارك — في «يحتاج قرارك»</Badge>
      </Link>
    );
  }
  return <span className="text-[11px] text-muted">لا تحتاج مطابقة</span>;
}

const CATEGORY_TONE: Partial<Record<TxCategory, "warn" | "info" | "accent" | "muted" | "ok">> = {
  UNKNOWN: "warn",
  SUPPLIER: "accent",
  POS_SETTLEMENT: "ok",
  POS_FEE: "muted",
  POS_VAT: "muted",
  BANK_FEE: "muted",
  BANK_VAT: "muted",
  PERSONAL: "info",
};

function CategoryBadge({ category }: { category: TxCategory }) {
  return <Badge tone={CATEGORY_TONE[category]}>{CATEGORY_LABEL[category] ?? category}</Badge>;
}

/**
 * السهمُ مع كلمةٍ مخفيّة للقارئ — اللونُ لا يأتي وحده.
 *
 * و`relative` على الوعاء شرط: `sr-only` موضعُه مطلق، وبلا سلفٍ مموضَع يفلت
 * من وعاء الجدول المُمرَّر فيطيل الصفحةَ كلَّها بطول الجدول (قيس: ٨٤٥٢ بكسلاً
 * لصفحةٍ محتواها ألفان).
 */
function DirectionIcon({ direction, large = false }: { direction: "DEBIT" | "CREDIT"; large?: boolean }) {
  const out = direction === "DEBIT";
  const Icon = out ? ArrowUpRight : ArrowDownLeft;
  return (
    <span
      title={out ? "صادر" : "وارد"}
      className={`relative grid shrink-0 place-items-center rounded-full ${large ? "h-10 w-10" : "mt-0.5 h-7 w-7"} ${out ? "bg-sunken text-ink-soft" : "bg-ok-bg text-ok"}`}
    >
      <Icon className={large ? "h-5 w-5" : "h-3.5 w-3.5"} strokeWidth={2.25} aria-hidden />
      <span className="sr-only">{out ? "صادر" : "وارد"}</span>
    </span>
  );
}
