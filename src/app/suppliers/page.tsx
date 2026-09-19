import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import {
  Card, DataTable, EmptyState, LinkButton, Section, Stat, StatGrid, buttonClass,
} from "@/components/ui";
import { SUPPLIER, countNoun, INVOICE, PAYMENT_RECORD, DAY } from "@/lib/arabic";
import { buildInvoiceRequest, groupUnbackedBySupplier } from "@/lib/supplier-requests";
import { loadUnbackedPayments } from "@/services/supplier-followups.service";
import { loadBalanceTotals, loadOverdueBalances } from "@/services/supplier-balance.service";
import { listOpenFindings } from "@/services/supplier-analysis.service";
import { FindingsList, RunAnalysis, type FindingView } from "@/components/ai-analysis";
import { formatDay } from "@/lib/riyadh-time";
import { formatRiyalsDisplay } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * حسابات المورّدين — «كم عليّ ولمن؟» في مكانٍ واحد.
 *
 * ── لماذا صفحةٌ واحدة بدل ثلاث ──
 *
 * كان السؤال الواحد موزّعاً على ثلاث شاشات لا تتّفق:
 *
 *   `/purchases`          سبعُ بطاقاتٍ كلُّها روابط — فهرسٌ لا صفحة.
 *   `/purchases/insights` جدولُ الحسابات، يعدّ **١٢** مورّداً.
 *   `/suppliers`          جدولٌ بثمانية أعمدة، يعدّ **٢٢**.
 *
 * والعدّان صحيحان — الأوّل من له حساب، والثاني كلُّ مسجَّل — لكنّ من
 * يقرأ لا يعرف ذلك، فيرى رقمين لعنوانٍ واحد.
 *
 * وجدولُ الثانية كان يفتتح بـ«التصنيف» و«الرقم الضريبي» و«٥ أسماء
 * بديلة» قبل أن يقول كم على المورّد — أي أنّ أوّلَ ما يُقرأ في صفحة
 * المورّدين بياناتٌ إداريّة لا يُفتَح لها التطبيق. وعمودُ «الصافي» يحمل
 * تارةً رقماً وتارةً جملةً كاملة («دفعتَ له بلا فاتورة: ٢٦٬٧٦٧٫٤٠»)،
 * فلا يُمسَح بالعين ولا يُفرَز.
 *
 * فصارت أربعةَ أعمدة: المورّد · عليك · رصيدٌ لك · آخر تعامل. والإداريُّ
 * في ملفّ المورّد حيث يُطلَب، لا في الجدول حيث يُزاحم.
 *
 * والمصدر واحد: `loadBalanceTotals()` — هي التي تحسب الرقم في الرئيسية
 * وفي التنبيهات، فلا يختلف الجدول عن رأسه ولا عن الصفحة التي قبله.
 */
export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ unbacked?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/suppliers");

  const showAmounts = can(user.role, "amounts:view");
  const unbackedView = (await searchParams).unbacked === "1";

  const [{ rows: balances, totals }, overdue, unbackedPayments, open, meta] = await Promise.all([
    loadBalanceTotals(),
    loadOverdueBalances(),
    showAmounts ? loadUnbackedPayments() : Promise.resolve([]),
    showAmounts ? listOpenFindings() : Promise.resolve([]),
    db
      .select({
        id: suppliers.id,
        slug: suppliers.slug,
        nameAr: suppliers.nameAr,
        issuesInvoices: suppliers.issuesInvoices,
        contractOnFile: suppliers.contractOnFile,
        contractRequired: suppliers.contractRequired,
        paperInvoices: suppliers.paperInvoices,
        invoiceCount: sql<number>`(
          select count(*)::int from invoices i where i.supplier_id = suppliers.id
        )`,
        lastActivity: sql<string | null>`(
          select to_char(max(d), 'YYYY-MM-DD') from (
            select max(i.invoice_date) d from invoices i where i.supplier_id = suppliers.id
            union all
            select max(p.paid_at) d from payments p where p.supplier_id = suppliers.id
          ) x
        )`,
      })
      .from(suppliers)
      .where(eq(suppliers.isActive, true))
      .orderBy(asc(suppliers.nameAr)),
  ]);

  if (meta.length === 0) {
    return (
      <PageShell user={user} width="wide" title="المورّدون">
        <EmptyState
          title="لا مورّدين بعد."
          hint="يُنشَأ المورّد حين تُقرأ أوّل فاتورة منه — أو تختاره «مورّداً جديداً» في شاشة الرفع."
          action={<LinkButton href="/upload" variant="primary">ارفع مستنداً</LinkButton>}
        />
      </PageShell>
    );
  }

  const balanceOf = new Map(balances.map((b) => [b.supplierId, b]));
  const overdueOf = new Map(overdue.map((o) => [o.supplierId, o]));
  const unbackedGroups = groupUnbackedBySupplier(unbackedPayments);
  const unbackedTotal = unbackedPayments.reduce((s, p) => s + p.unbackedMinor, 0);

  /*
    الترتيب يتبع العمل: من عليك له أوّلاً وبالأكبر، ثمّ من لك عنده، ثمّ
    الساكنون. وكان أبجديّاً — فيتصدّر الجدولَ من لا شيء بينك وبينه.
  */
  const rows = meta
    .map((m) => {
      const b = balanceOf.get(m.id);
      return {
        ...m,
        owedMinor: b?.owedMinor ?? 0,
        creditLeftMinor: b?.creditLeftMinor ?? 0,
        openCount: b?.openCount ?? 0,
        oldestDays: overdueOf.get(m.id)?.oldestDays ?? null,
      };
    })
    .sort((a, b) =>
      b.owedMinor - a.owedMinor ||
      b.creditLeftMinor - a.creditLeftMinor ||
      a.nameAr.localeCompare(b.nameAr, "ar"),
    );

  /*
    من أُعلن أنّه لا يُطلَب منه عقد يخرج، ومن فواتيرُه ورقيّةٌ يخرج كذلك:
    الأولى قرارُ صاحب العمل، والثانية تقول إنّ الفاتورة موجودةٌ ولم
    تُرفَع — فمطلبُها رفعُ الورقة لا عقدُ توريد. (الهجرة 035)
  */
  const needContract = meta.filter(
    (r) => !r.issuesInvoices && !r.contractOnFile && r.contractRequired && !r.paperInvoices,
  );
  /* ومن فواتيرُه ورقيّة يُذكَر بمطلبه هو: ارفع الورقة. */
  const paperOnly = meta.filter((r) => r.paperInvoices);

  const findings: FindingView[] = open.map((f) => ({
    id: f.id, supplierId: f.supplierId, supplierName: f.supplierName, supplierSlug: f.supplierSlug,
    kind: f.kind, severity: f.severity, title: f.title, explanation: f.explanation,
    amountMinor: f.amountMinor, action: f.action,
    refs: f.refs.map((r) => ({ label: r.label, type: r.type })),
    createdAt: f.createdAt.toISOString(),
  }));

  const nameOf = new Map(meta.map((m) => [m.id, m.nameAr]));

  const worth = balances
    .filter((r) => r.owedMinor > 0 || r.creditMinor > 0)
    .sort((a, b) => (b.owedMinor + b.creditMinor) - (a.owedMinor + a.creditMinor));

  return (
    <PageShell
      user={user}
      width="wide"
      title="حسابات المورّدين"
      intro="كم على المقهى لكلّ مورّد بعد خصم ما دُفع له، وكم بقي له عندهم."
    >
      {showAmounts && (
        <StatGrid>
          <Stat
            label="عليك للمورّدين"
            minor={totals.owedMinor}
            tone={totals.owedMinor > 0 ? "warn" : "ok"}
            sub={`${countNoun(totals.owedSuppliers, SUPPLIER)} · على ${countNoun(totals.openInvoiceCount, INVOICE)} مفتوحة`}
          />
          <Stat
            label="رصيدٌ لك عند المورّدين"
            minor={totals.creditLeftMinor}
            sub={`${countNoun(totals.creditSuppliers, SUPPLIER)} · مالٌ دفعتَه ولم تصلك فاتورته`}
          />
          <Stat
            label="دفعات لم تُنسب إلى فاتورة"
            minor={unbackedTotal}
            /*
              العدد يفتح ما يعدّه بعينه — لا صفحة البنك ولا الجدول العامّ.
              وهو التعريف نفسه الذي يقرؤه التنبيه وصفحةُ البنك بعد التوحيد.
            */
            href="/suppliers?unbacked=1#unbacked"
            sub={`${countNoun(unbackedPayments.length, PAYMENT_RECORD)} · افتحها واطلب مستنداتها`}
          />
        </StatGrid>
      )}

      {/*
        رقمان متقاربان في شاشةٍ واحدة يُقرآن الشيءَ نفسه ما لم يُقَل
        الفرق. و«رصيدٌ لك» محسوبٌ بالمورّد — فمن عليك له يُخصَم رصيدُه من
        دَينه ولا يظهر هنا؛ و«لم تُنسب» محسوبٌ بالدفعة، فتُعَدّ كلُّ دفعةٍ
        بلا مستندٍ ولو كان صاحبُها مديناً لك. والفرق بينهما ليس خطأً.
      */}
      {showAmounts && unbackedTotal > 0 && totals.creditLeftMinor > 0 && unbackedTotal !== totals.creditLeftMinor && (
        <p className="mt-2.5 text-xs leading-relaxed text-muted">
          ولِمَ يختلف الرقمان؟ «رصيدٌ لك» بالمورّد — فمن عليك له خُصم رصيدُه من دَينه أوّلاً؛
          و«لم تُنسب» بالدفعة، تُعَدّ فيها كلُّ دفعةٍ بلا مستند. والفرق بينهما ما خُصم:{" "}
          <span className="nums font-bold">{formatRiyalsDisplay(totals.offsetMinor)}</span> ريالاً.
        </p>
      )}

      {unbackedView && showAmounts && (
        <div id="unbacked" className="scroll-mt-28">
          <Section
            title="دفعاتٌ لم تُنسب إلى فاتورة"
            hint={`${countNoun(unbackedPayments.length, PAYMENT_RECORD)} عند ${countNoun(
              unbackedGroups.filter((g) => g.supplierId).length, SUPPLIER,
            )}. بلا فاتورةٍ ضريبية لا يُخصَم مدخلُها. ومن لا يصدر فواتير يُطلَب منه عقدُ توريد بدلها — وهو معدودٌ هنا كغيره، فالمال خرج.`}
            action={<LinkButton href="/suppliers" size="sm" variant="quiet">كلّ الحسابات</LinkButton>}
          >
            {unbackedGroups.length === 0 && (
              <p className="text-xs text-ok">لا دفعة بلا فاتورة — كلّ ما دُفع له مستندُه.</p>
            )}
            <ul className="grid gap-2.5 xl:grid-cols-2">
              {unbackedGroups.map((g) => (
                <li
                  key={g.supplierId ?? "none"}
                  id={g.supplierSlug ? `unbacked-${g.supplierSlug}` : undefined}
                  className="scroll-mt-28"
                >
                  <Card>
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        {g.supplierSlug ? (
                          <Link href={`/suppliers/${g.supplierSlug}`} className="block text-sm font-bold underline-offset-4 hover:underline">
                            {g.supplierName}
                          </Link>
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
                        <span className="nums block text-sm font-bold text-warn"><Money minor={g.totalMinor} /></span>
                      </span>
                    </div>
                    <ul className="mt-2 space-y-1 border-s-2 border-line ps-2.5">
                      {g.payments.map((p) => (
                        <li key={p.paymentId} className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <span className="min-w-0 text-muted">
                            <bdi className="nums">{p.paidOn}</bdi> · من أصل <Money minor={p.amountMinor} />
                            {p.bankTransactionId && (
                              <>
                                {" · "}
                                <Link href={`/bank?tx=${p.bankTransactionId}`} className="inline-flex min-h-11 items-center underline underline-offset-4 sm:min-h-0">
                                  حركتها
                                </Link>
                              </>
                            )}
                          </span>
                          <span className="nums font-bold"><Money minor={p.unbackedMinor} /></span>
                        </li>
                      ))}
                    </ul>
                    {g.supplierId && (
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        <a
                          href={`https://wa.me/?text=${encodeURIComponent(buildInvoiceRequest(g))}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={buttonClass("primary", "sm")}
                        >
                          {g.payments.every((p) => !p.issuesInvoices)
                            ? "اطلب عقد التوريد (واتساب)"
                            : "اطلب الفاتورة (واتساب)"}
                        </a>
                        {g.supplierSlug && <LinkButton href={`/suppliers/${g.supplierSlug}`} size="sm">ملفّه</LinkButton>}
                      </div>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}

      <Section
        title="كلّ مورّد"
        hint="من عليك له أوّلاً وبالأكبر. والبيانات الضريبية ودورةُ الفوترة والأسماء البديلة في ملفّ المورّد."
      >
        {needContract.length > 0 && (
          <div id="no-contract" className="mb-3 scroll-mt-24 rounded-xl border border-warn/40 bg-warn-bg px-4 py-3">
            <p className="text-xs leading-relaxed">
              <span className="font-bold text-warn">
                {countNoun(needContract.length, SUPPLIER)} يحتاج عقد توريد:
              </span>{" "}
              {needContract.map((r) => r.nameAr).join(" · ")} — لا يصدرون فواتير ضريبية، وبلا عقدٍ
              مكتوب لا خصم ضريبة ولا إثبات مصروف.{" "}
              <span className="text-muted">
                ومن لا يحتاج عقداً تُطفئه من ملفّه: «ما يُطلَب من هذا المورّد».
              </span>
            </p>
          </div>
        )}

        {paperOnly.length > 0 && (
          <div className="mb-3 rounded-xl border border-line bg-sunken px-4 py-3">
            <p className="text-xs leading-relaxed">
              <span className="font-bold">
                {countNoun(paperOnly.length, SUPPLIER)} فواتيرُه ورقيّة:
              </span>{" "}
              {paperOnly.map((r) => r.nameAr).join(" · ")} — فاتورتُه موجودةٌ باليد ولم تُرفَع،
              فالمطلوبُ تصويرُها ورفعُها لا طلبُ عقدٍ منه.
            </p>
          </div>
        )}

        <DataTable
          rows={rows}
          keyOf={(r) => r.id}
          hrefOf={(r) => `/suppliers/${r.slug}`}
          columns={[
            {
              key: "name",
              header: "المورّد",
              primary: true,
              cell: (r) => (
                <Link href={`/suppliers/${r.slug}`} className="font-bold underline-offset-4 hover:underline">
                  {r.nameAr}
                </Link>
              ),
            },
            {
              key: "owed",
              header: "عليك",
              numeric: true,
              cell: (r) =>
                !showAmounts ? "—"
                : r.owedMinor > 0 ? (
                  <span className="font-bold text-warn"><Money minor={r.owedMinor} /></span>
                ) : (
                  <span className="text-muted">—</span>
                ),
            },
            {
              key: "credit",
              header: "رصيدٌ لك",
              numeric: true,
              cell: (r) =>
                !showAmounts ? "—"
                : r.creditLeftMinor > 0 ? (
                  <span className="font-bold"><Money minor={r.creditLeftMinor} /></span>
                ) : (
                  <span className="text-muted">—</span>
                ),
            },
            {
              key: "open",
              header: "فواتير مفتوحة",
              numeric: true,
              secondary: true,
              cell: (r) =>
                r.openCount > 0 ? <span className="nums">{r.openCount}</span> : <span className="text-muted">—</span>,
            },
            {
              key: "last",
              header: "آخر تعامل",
              cell: (r) => (
                <span className="whitespace-nowrap text-muted">
                  {r.lastActivity ? formatDay(r.lastActivity) : "لا تعامل بعد"}
                  {r.oldestDays !== null && r.oldestDays >= 60 && (
                    <span className="ms-1.5 font-bold text-warn">
                      ⚠ أقدم دَينٍ {countNoun(r.oldestDays, DAY)}
                    </span>
                  )}
                </span>
              ),
            },
          ]}
        />
      </Section>

      {showAmounts && (
        <Section
          title="اقتراحات تنتظر قرارك"
          hint="يقرأ التحليل فواتير المورّد ودفعاته وكشوفه، ويقترح ما يصحّح حسابه. والأرقام يحسبها الخادم، ولا يُكتب شيء حتى تُقرّه."
          action={
            can(user.role, "supplier:edit") ? (
              <RunAnalysis suppliers={worth.map((w) => ({ id: w.supplierId, name: nameOf.get(w.supplierId) ?? "" }))} label={`حلّل ${worth.length} مورّداً`} />
            ) : undefined
          }
        >
          <FindingsList
            findings={findings}
            canApprove={can(user.role, "payment:approve")}
            showSupplier
          />
        </Section>
      )}
    </PageShell>
  );
}
