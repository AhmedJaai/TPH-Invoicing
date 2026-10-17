import { redirect } from "next/navigation";
import Link from "next/link";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { ArrowLeft, BookOpen, ClipboardCheck, FileSpreadsheet, History, Package, Sparkles } from "lucide-react";
import { db } from "@/db";
import { branches, inventoryCounts } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Card, LinkButton, NoAccess, Section } from "@/components/ui";
import { Money } from "@/components/money";
import { NewCount, StartCount } from "@/components/inventory-actions";
import { InventoryWorkspace } from "@/components/inventory-workspace";
import {
  COUNT, DIRECTION, EquationExplainer, FactTile, RECIPE, SetupJourney, formatWeek, isStepId,
} from "@/components/inventory-ui";
import { listCounts, loadCountHeader, loadScope, recomputeCount } from "@/services/inventory.service";
import { loadWorkspaceInputs } from "@/services/inventory-workspace.service";
import { loadInventorySetup, setupProgress } from "@/services/inventory-overview.service";
import { PRODUCT, countNoun } from "@/lib/arabic";
import { formatDay, todayInRiyadh } from "@/lib/riyadh-time";
import { lastCompleteWeek } from "@/lib/inventory/week";

export const dynamic = "force-dynamic";

/**
 * «الجرد الحالي» — الشاشةُ التي تُفتَح كلّ أسبوع.
 *
 * وإن كان ثمّة جردٌ مفتوح فهو **هذه الصفحة نفسُها**، لا رابطٌ إليه:
 * من فتح «الجرد الحالي» يريد أن يعدّ، لا أن يقرأ فهرساً.
 *
 * وبلا جردٍ مفتوح تقول الشاشةُ أين أنت من الطريق — كتالوج ← مبيعات ←
 * جرد — والخطوةُ التي عليها الدورُ وحدها بزرٍّ رئيسيّ. ولا يُعرَض صفرٌ عن
 * غير علم: قاعدةٌ لا مبيعاتِ فيها تقول «لم تصل المبيعات» لا «٠».
 */
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const { step } = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/login?from=/inventory");
  if (!can(user.role, "inventory:view")) {
    return (
      <PageShell user={user} width="wide" title="الجرد الحالي">
        <NoAccess what="الجرد" />
      </PageShell>
    );
  }

  /* سجلُّ الجرد والمبالغُ لمن يرى المبالغ — ومن لا يراها لا يُعطى رابطاً يردّه */
  const showAmounts = can(user.role, "amounts:view");
  const setup = await loadInventorySetup();

  if (setup.openCountId) {
    const header = await loadCountHeader(setup.openCountId);
    if (header) {
      const [report, scope, inputs, otherDrafts, branchList] = await Promise.all([
        recomputeCount(header.id),
        loadScope(header.id),
        loadWorkspaceInputs(header),
        /* جرودٌ مفتوحةٌ غيرُه — بُدئ جديدٌ قبل أن تُقفَل، فلا تضيع */
        db.select({ id: inventoryCounts.id, start: inventoryCounts.periodStart, end: inventoryCounts.periodEnd })
          .from(inventoryCounts)
          .where(and(eq(inventoryCounts.status, "DRAFT"), ne(inventoryCounts.id, header.id)))
          .orderBy(desc(inventoryCounts.periodEnd)),
        db.select({ id: branches.id, nameAr: branches.nameAr })
          .from(branches)
          .where(eq(branches.isActive, true))
          .orderBy(asc(branches.nameAr)),
      ]);
      const canCountHere = can(user.role, "inventory:count");
      const newestWeek = lastCompleteWeek();
      return (
        <PageShell
          user={user}
          width="wide"
          eyebrow={`جرد مفتوح${header.branchName ? ` · ${header.branchName}` : ""}`}
          title="الجرد الحالي"
          intro={`أسبوع ${formatWeek(header.periodStart, header.periodEnd)} — المقارنة بين ما كان ينبغي أن يبقى على الرف وما وُجد فعلاً.`}
          actions={
            <>
              {canCountHere && (
                <NewCount
                  defaultStart={newestWeek.start}
                  defaultEnd={newestWeek.end}
                  branches={branchList.map((b) => ({ id: b.id, name: b.nameAr }))}
                  openWeek={{ start: header.periodStart, end: header.periodEnd }}
                  openCountId={header.id}
                  openBranchId={header.branchId}
                />
              )}
              {showAmounts && <LinkButton href="/inventory/history" size="sm" icon={History}>سجلّ الجرد</LinkButton>}
            </>
          }
        >
          {otherDrafts.length > 0 && (
            <nav aria-label="جردات مفتوحة أخرى" className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-sunken/50 px-4 py-3 text-xs">
              <span className="font-bold text-muted">{otherDrafts.length === 1 ? "جرد آخر مفتوح:" : "جردات أخرى مفتوحة:"}</span>
              {otherDrafts.map((d) => (
                <Link
                  key={d.id}
                  href={`/inventory/counts/${d.id}`}
                  className="rounded-full border border-line bg-raised px-3 py-1.5 font-bold hover:border-accent-line hover:bg-hover"
                >
                  أسبوع {formatWeek(String(d.start), String(d.end))}
                </Link>
              ))}
            </nav>
          )}
          <InventoryWorkspace
            header={header}
            report={report}
            canCount={can(user.role, "inventory:count")}
            canReopen={can(user.role, "inventory:reopen")}
            showAmounts={showAmounts}
            scopeInherited={scope.inherited}
            {...inputs}
            today={todayInRiyadh()}
            initialStep={isStepId(step) ? step : null}
          />
        </PageShell>
      );
    }
  }

  /* لا جردَ مفتوح — فالشاشةُ تبدأ واحداً، وتُري أين أنت من الطريق */
  const [branchRows, recentAll] = await Promise.all([
    db.select({ id: branches.id, nameAr: branches.nameAr })
      .from(branches)
      .where(eq(branches.isActive, true))
      .orderBy(asc(branches.nameAr)),
    listCounts(4),
  ]);
  const recent = recentAll.filter((c) => c.status === "FINALISED").slice(0, 3);
  /* آخرُ أسبوعٍ اكتمل — لا الجاري: الجردُ يقع بعد تقفيلة السبت */
  const week = lastCompleteWeek();
  const progress = setupProgress(setup);
  const canCount = can(user.role, "inventory:count");

  const intro = !progress.done.catalog
    ? "الجرد يقارن ما وُجد على الرف بما كان ينبغي أن يُصرف. ولذلك يحتاج إلى ثلاث خطوات بالترتيب، وأولها الكتالوج."
    : !progress.done.sales
      ? "الكتالوج جاهز. ارفع ملف مبيعات الأسبوع ليعرف النظام ما كان ينبغي أن يُصرف."
      : `جاهز لجرد أسبوع ${formatWeek(week.start, week.end)}، وهو آخر أسبوع مكتمل.`;

  return (
    <PageShell
      user={user}
      width="wide"
      title="الجرد الحالي"
      intro={intro}
      actions={showAmounts && setup.finalised > 0
        ? <LinkButton href="/inventory/history" size="sm" icon={History}>سجلّ الجرد</LinkButton>
        : undefined}
    >
      {/* ── طريقُ البداية: يُعرَض حتى يوجد الكتالوجُ والمبيعات ── */}
      {!progress.complete && (
        <section
          aria-labelledby="setup-title"
          className="mb-8 grid grid-cols-[minmax(0,1fr)] gap-6 rounded-2xl border border-accent-line bg-accent-soft/60 p-5 sm:p-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]"
        >
          <div className="min-w-0">
            <h2 id="setup-title" className="flex items-center gap-2 text-base font-bold">
              <Sparkles className="h-[18px] w-[18px] text-accent" strokeWidth={2} aria-hidden />
              {setup.counts === 0 && !progress.done.catalog ? "جهّز أول جرد" : "بقيت خطوات لإكمال الجرد"}
            </h2>
            <p className="mb-4 mt-1 text-xs leading-relaxed text-ink-soft">
              لا يمكن للجرد أن يقول «لا فرق» وهو لا يعرف ما بِيع. أكمل الخطوات بالترتيب، كل خطوة مرة واحدة، ثم ارفع المبيعات كل أحد.
            </p>
            <SetupJourney facts={setup} />
          </div>
          <div className="min-w-0">
            <h3 className="text-[13px] font-bold">كيف يُحسب فرق الجرد</h3>
            <p className="mb-3 mt-1 text-xs leading-relaxed text-ink-soft">
              ثلاثة أرقام يحسبها النظام، ورقم واحد تدخله أنت: ما وجدته على الرف.
            </p>
            <EquationExplainer />
          </div>
        </section>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-10 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* ── ابدأ جرد الأسبوع ── */}
        <div id="start" className="min-w-0 scroll-mt-24">
          {canCount ? (
            <StartCount
              defaultStart={week.start}
              defaultEnd={week.end}
              branches={branchRows.map((b) => ({ id: b.id, name: b.nameAr }))}
              prerequisite={
                !progress.done.catalog
                  ? "بدون كتالوج لا توجد وصفات تُحسب بها المبيعات، فيظهر الجرد بلا فرق محسوب. ابدأ بالكتالوج أولاً."
                  : !progress.done.sales
                    ? "لا توجد مبيعات مستوردة بعد. يمكنك أن تبدأ العدّ الآن، وسيُحسب الفرق عند وصول ملف الأسبوع."
                    : null
              }
            />
          ) : (
            <Card>
              <p className="text-sm font-bold">لا يوجد جرد مفتوح الآن.</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">بدء الجرد ليس من صلاحياتك. يبدؤه المالك أو المدير، ثم تجده هنا لتبدأ العدّ.</p>
            </Card>
          )}
        </div>

        {/* ── ما يعرفه الجرد الآن — جملٌ لا أصفار ── */}
        <Section title="ما يعرفه الجرد الآن" className="mt-0!">
          <div className="grid grid-cols-2 gap-3">
            <FactTile
              icon={Package}
              label="أصناف المخزون"
              value={setup.stockItems === 0 ? "لا توجد أصناف بعد" : countNoun(setup.stockItems, PRODUCT)}
              tone={setup.stockItems === 0 ? "muted" : undefined}
              sub={setup.stockItems === 0 ? "تُنشأ من الفواتير والكتالوج" : "ما يُعدّ على الرف"}
              href="/inventory/items"
            />
            <FactTile
              icon={BookOpen}
              label="الوصفات"
              value={setup.recipes === 0 ? "لا توجد وصفات بعد" : countNoun(setup.recipes, RECIPE)}
              tone={setup.recipes === 0 ? "warn" : undefined}
              sub={setup.recipes === 0 ? "بدون وصفة لا يعرف النظام ما صُرف" : `لـ${countNoun(setup.menuItems, PRODUCT)} في القائمة`}
              href={can(user.role, "recipe:edit") ? (setup.recipes === 0 ? "/inventory/import#catalog" : "/inventory/recipes") : undefined}
            />
            <FactTile
              icon={FileSpreadsheet}
              label="المبيعات"
              value={setup.salesThrough ? `حتى ${formatDay(setup.salesThrough)}` : "لم تصل بعد"}
              tone={setup.salesThrough ? undefined : "warn"}
              sub={setup.salesThrough
                ? (setup.unmapped > 0 ? `و${countNoun(setup.unmapped, PRODUCT)} مباعة تنتظر الربط` : "من ملفات فودكس المستوردة")
                : "تأتي من ملف فودكس فقط، ولا يُفترض شيء بدونه"}
              href={canCount ? (setup.unmapped > 0 ? "/inventory/mapping" : "/inventory/import#sales") : undefined}
            />
            <FactTile
              icon={ClipboardCheck}
              label="جردات مقفلة"
              value={setup.finalised === 0 ? "لا يوجد جرد بعد" : countNoun(setup.finalised, COUNT)}
              tone={setup.finalised === 0 ? "muted" : undefined}
              sub={setup.finalised === 0 ? "يمتلئ السجل عند إقفال أول جرد" : "بأرقامها النهائية كما أُقفلت"}
              href={showAmounts && setup.finalised > 0 ? "/inventory/history" : undefined}
            />
          </div>
        </Section>
      </div>

      {/*
        ── المبالغُ لمن يرى المبالغ ──

        كان «آخرُ ما أُقفل» يعرض «نقص ١٣٫٢٠ · زيادة ٠٫٠٠» بالريال لكلّ من
        يفتح الجرد — ومديرُ المشتريات يعدّ الرفَّ ولا يرى كلفةَ الفرق. فلمن
        لا يراها يُعرَض عددُ ما نقص وما زاد، ويبقى الرابطُ إلى التقرير نفسه.
      */}
      {recent.length > 0 && (
        <Section
          title="آخر الجردات المقفلة"
          icon={History}
          action={showAmounts ? (
            <Link href="/inventory/history" className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-accent hover:underline hover:underline-offset-4 sm:min-h-0">
              السجل كاملاً <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            </Link>
          ) : undefined}
        >
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-3">
            {recent.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/inventory/counts/${c.id}`}
                  className="group block h-full rounded-xl border border-line bg-raised p-4 shadow-raised transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-accent-line hover:shadow-lifted"
                >
                  <span className="block text-[13px] font-bold group-hover:text-accent">أسبوع {formatWeek(c.periodStart, c.periodEnd)}</span>
                  {c.branchName && <span className="mt-0.5 block text-[11px] text-muted">{c.branchName}</span>}
                  {/* النقصُ والزيادةُ لا يتقاصّان — يُعرضان جنباً إلى جنب */}
                  <span className="mt-3 grid grid-cols-2 gap-2">
                    {(["short", "over"] as const).map((d) => {
                      const s = DIRECTION[d];
                      const minor = d === "short" ? c.summary.shortageCostMinor : c.summary.overageCostMinor;
                      const lines = d === "short" ? c.summary.linesShort : c.summary.linesOver;
                      return (
                        <span key={d} className="rounded-lg bg-sunken px-2.5 py-2">
                          <span className={`flex items-center gap-1 text-[11px] font-bold ${s.text}`}>
                            <s.icon className="h-3 w-3" strokeWidth={2.5} aria-hidden />
                            {s.label}
                          </span>
                          <span className="mt-1 block text-sm font-bold">
                            {c.summary.linesMeasured === 0
                              ? <span className="text-xs text-muted">غير معروف</span>
                              : showAmounts ? <Money minor={minor} /> : countNoun(lines, PRODUCT)}
                          </span>
                        </span>
                      );
                    })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </PageShell>
  );
}
