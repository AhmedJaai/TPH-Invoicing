import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import {
  CalendarClock, Copy, ListChecks, PieChart, Receipt, Repeat, Settings, Store, TriangleAlert,
} from "lucide-react";
import { db } from "@/db";
import { expenses, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { DeriveExpenses } from "@/components/derive-expenses";
import { ManualExpense } from "@/components/manual-expense";
import { activeRecurring, countUnrecordedBankExpenses } from "@/services/expense.service";
import {
  deletableExpense,
  expectedVsActual,
  findDuplicateExpenses,
  totalActual,
  suspectedSupplierExpenses,
  totalExpected,
  unmetRecurring,
  type Expense,
} from "@/lib/expenses";
import { countNoun, ITEM, TRANSACTION } from "@/lib/arabic";
import { CATEGORY_LABEL } from "@/lib/bank/rules";
import { formatDay, formatMonth } from "@/lib/riyadh-time";
import {
  Badge, BarList, DataTable, EmptyState, LinkButton, LinkTabs, NoAccess, Section, type Tone,
} from "@/components/ui";
import { ExpenseReclassify } from "@/components/expense-reclassify";
import { ExpenseDelete } from "@/components/expense-delete";
import type { LucideIcon } from "lucide-react";
import { txHref } from "@/lib/inspector";
import { T } from "@/components/i18n/t";

export const dynamic = "force-dynamic";

/**
 * المصروفات — ما صُرف فعلاً في الشهر، وأين، ومقابل ما كان متوقَّعاً.
 *
 * بترتيبها: رقمُ الشهر (والمتوقَّعُ إن سُجّل) ← ما يُنقص صدقَه (ما لم يُقيَّد
 * من الكشف، وما قُيّد مرّتين، وما يحمل اسم مورّد، وما تُوقّع ولم يُصرف) —
 * ولكلٍّ فعلُه بجانبه ← الأبواب ← القيود. وسدادُ المورّدين ليس هنا: محسوبٌ
 * في المشتريات، وقيدُه مرّتين يضاعف مصروف المقهى.
 */
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; add?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/money/expenses");
  if (!can(user.role, "bank:view")) {
    return (
      <PageShell user={user} title="المصروفات">
        <NoAccess />
      </PageShell>
    );
  }

  const p = await searchParams;
  const canEdit = can(user.role, "expense:edit");

  const months = (
    await db
      .select({ month: expenses.periodMonth })
      .from(expenses)
      .groupBy(expenses.periodMonth)
      .orderBy(desc(expenses.periodMonth))
  ).map((r) => r.month);

  const month = p.month && months.includes(p.month) ? p.month : months[0];

  const actions = canEdit ? (
    <>
      <DeriveExpenses month={month} />
      {/* «سجّل مصروفاً» من لوحة الأوامر يفتح الورقةَ نفسها هنا */}
      <ManualExpense startOpen={p.add === "1"} />
    </>
  ) : undefined;

  /* ── لا مصروفَ مقيَّداً بعد: الخطوةُ التالية، لا «الفعليّ ٠٫٠٠» ── */
  if (!month) {
    const pendingAll = await countUnrecordedBankExpenses();
    return (
      <PageShell user={user} width="wide" title="المصروفات" intro="ما صُرف فعلاً كل شهر، وفي أي تصنيف، مقارنةً بما كان متوقعاً.">
        <EmptyState
          icon={Receipt}
          title="لا توجد مصروفات مسجّلة بعد."
          hint={
            pendingAll.count > 0
              ? `في كشف البنك ${countNoun(pendingAll.count, TRANSACTION)} مصروفات لم تُسجَّل بعد. سجّلها بضغطة واحدة، ثم أضف ما دفعته نقداً.`
              : "تُسجَّل المصروفات من كشف البنك بعد تصنيف حركاته، أو يدوياً إذا دُفعت نقداً. استورد كشف البنك أولاً إن لم تفعل."
          }
          action={
            canEdit ? (
              <>
                {pendingAll.count > 0
                  ? <DeriveExpenses variant="primary" />
                  : <LinkButton href="/bank#import" variant="primary">استورد كشف البنك</LinkButton>}
                <ManualExpense variant="secondary" />
              </>
            ) : undefined
          }
        />
      </PageShell>
    );
  }

  const [rows, recurring, supplierRows, pending, recent] = await Promise.all([
    db.select().from(expenses).where(eq(expenses.periodMonth, month)).orderBy(desc(expenses.occurredOn)),
    activeRecurring(),
    db.select({ id: suppliers.id, nameAr: suppliers.nameAr }).from(suppliers),
    /* الفعليّ لا يُعرَض كاملاً وفي الكشف مصروفٌ لم يُقيَّد — النقصُ يُعلَن */
    countUnrecordedBankExpenses(month),
    /*
      «مصروفٌ وصل مرّتين» — بالنافذة نفسها التي يعدّ بها التنبيه (مئةٌ
      وعشرون يوماً) لا بالشهر المعروض: كان التنبيه يقول «احذف الزائد بيدك»
      والصفحة لا تعرض زوجاً ولا زرّاً (BTN-111).
    */
    db.select().from(expenses)
      .where(sql`${expenses.occurredOn} >= to_char(now() - interval '120 days', 'YYYY-MM-DD')`),
  ]);

  const toExpense = (r: (typeof rows)[number]): Expense => ({
    id: r.id,
    periodMonth: r.periodMonth,
    occurredOn: r.occurredOn,
    category: r.category,
    label: r.label,
    amountMinor: r.amountMinor,
    source: r.source,
    bankTransactionId: r.bankTransactionId,
    recurringExpenseId: r.recurringExpenseId,
  });

  const actual = rows.map(toExpense);
  const duplicates = findDuplicateExpenses(recent.map(toExpense));
  const variance = expectedVsActual(recurring, actual, month);
  const suspects = suspectedSupplierExpenses(actual, supplierRows.map((s) => s.nameAr));
  const unmet = unmetRecurring(recurring, actual, month);
  const actualTotal = totalActual(actual, month);
  const expectedTotal = totalExpected(recurring);

  /* الأبوابُ في الشهر — من القيود نفسها التي تحتها، لا من استعلامٍ ثانٍ */
  const byCategory = new Map<string, { label: string; minor: number; n: number }>();
  for (const e of actual) {
    const b = byCategory.get(e.category) ?? { label: CATEGORY_LABEL[e.category] ?? e.category, minor: 0, n: 0 };
    b.minor += e.amountMinor;
    b.n++;
    byCategory.set(e.category, b);
  }
  const categories = [...byCategory.entries()].sort((a, b) => b[1].minor - a[1].minor);

  const incomplete = pending.count > 0;

  return (
    <PageShell
      user={user}
      width="wide"
      title="المصروفات"
      intro="ما صُرف فعلاً في الشهر، وفي أي تصنيف، مقارنةً بما كان متوقعاً. سداد المورّدين غير محسوب هنا لأنه ضمن المشتريات."
      actions={actions}
    >
      {months.length > 1 && (
        <div className="mb-5">
          <LinkTabs
            label="الشهر"
            items={months.map((m) => ({ href: `/money/expenses?month=${m}`, label: formatMonth(m), active: m === month }))}
          />
        </div>
      )}

      {/* ── رقمُ الشهر — والمقارنةُ حين يوجد ما يُقارَن به ── */}
      {expectedTotal === 0 ? (
        /*
          بلا متوقَّعٍ مسجَّل تُعرَض بطاقةُ الفعليّ وحدها — «المتوقَّع ٠٫٠٠»
          تقول إنّ المقهى لا يتوقّع أن يصرف شيئاً، وذلك غير «لم يُسجَّل بعد».
        */
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-stretch">
          <Hero
            label={`الفعلي في ${formatMonth(month)}`}
            minor={actualTotal}
            tone={incomplete ? "warn" : undefined}
            note={incomplete ? `${countNoun(actual.length, ITEM)}، وينقصه ما لم يُسجَّل من الكشف` : countNoun(actual.length, ITEM)}
          />
          <Notice
            tone="accent"
            icon={Repeat}
            title="لا توجد مقارنة بالمتوقع بعد"
            action={<LinkButton href="/settings" variant="secondary" size="sm" icon={Settings}>سجّلها في الإعدادات</LinkButton>}
            className="h-full sm:items-center"
          >
            سجّل الإيجار والرواتب والاشتراكات كمصروفات متكررة، ليقارن النظام بها المصروف الفعلي كل شهر، ويُظهر هنا ما كان متوقعاً ولم يُصرف.
          </Notice>
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
          <Hero label="المتوقع شهرياً" minor={expectedTotal} note={countNoun(recurring.length, ITEM)} />
          <Hero
            label={`الفعلي في ${formatMonth(month)}`}
            minor={actualTotal}
            tone={incomplete ? "warn" : undefined}
            note={incomplete ? `${countNoun(actual.length, ITEM)}، وينقصه ما لم يُسجَّل` : countNoun(actual.length, ITEM)}
          />
          <Hero
            label="الفرق"
            minor={actualTotal - expectedTotal}
            tone={actualTotal > expectedTotal ? "warn" : "ok"}
            note={incomplete ? "المصروف الفعلي ناقص، فالفرق مؤقت" : actualTotal > expectedTotal ? "صرفت أكثر من المتوقع" : "صرفت أقل من المتوقع"}
          />
        </div>
      )}

      {/* ── ما يُنقص صدقَ الرقم — ولكلٍّ فعلُه بجانبه ── */}
      {(incomplete || duplicates.length > 0 || suspects.length > 0 || unmet.length > 0) && (
        <div className="mt-6 space-y-3">
          {incomplete && (
            <Notice
              tone="warn"
              icon={TriangleAlert}
              title={`في الكشف ${countNoun(pending.count, TRANSACTION)} مصروفات لم تُسجَّل بعد`}
              action={canEdit ? <DeriveExpenses month={month} variant="primary" label="سجّلها الآن" /> : undefined}
            >
              <T s="لذلك فالمصروف الفعلي في {0} أقل من الحقيقي بـ{1} ريال. ولا يُحسب هنا سداد المورّدين ولا ما يدل وصفه على شراء بضاعة." a={[formatMonth(month), <Money key="1" minor={pending.amountMinor} />]} /></Notice>
          )}

          {duplicates.length > 0 && (
            <section id="duplicates" aria-labelledby="dup-title" className="scroll-mt-28 overflow-hidden rounded-xl border border-danger/25 bg-danger-bg">
              <header className="flex items-start gap-3 px-4 py-3">
                <Copy className="mt-0.5 h-[18px] w-[18px] shrink-0 text-danger" strokeWidth={2} aria-hidden />
                <div className="min-w-0 text-xs leading-relaxed text-ink-soft">
                  <T s="{0}سُجّل المصروف نفسه من مصدرين، فارتفع مصروف الشهر بقدر الزيادة. أبقِ واحداً واحذف الآخر. أما المصروف المأخوذ من كشف البنك فيبقى، لأن النظام يعيد إنشاءه." a={[<h2 key="0" id="dup-title" className="text-[13px] font-bold text-danger"><T s="مصروف مسجّل مرتين — {0}" a={[countNoun(duplicates.length, ITEM)]} /></h2>]} /></div>
              </header>
              <ul className="space-y-2 px-3 pb-3">
                {duplicates.map((d) => (
                  <li key={d.key} className="overflow-hidden rounded-lg border border-line bg-raised">
                    <div className="flex items-baseline justify-between gap-3 border-b border-line-soft px-3 py-2">
                      <span className="min-w-0 truncate text-xs font-bold" dir="auto">{d.label}</span>
                      <span className="shrink-0 text-[11px] text-muted"><T s="الزيادة {0}" a={[<span key="0" className="font-bold text-danger"><Money minor={d.amountMinor} /></span>]} /></span>
                    </div>
                    <ul className="divide-y divide-line-soft">
                      {d.members.map((e) => (
                        <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
                            <bdi>{formatDay(e.occurredOn)}</bdi>
                            <SourceBadge source={e.source} />
                            <span className="font-bold text-ink"><Money minor={e.amountMinor} /></span>
                            {e.bankTransactionId && (
                              <Link href={txHref(e.bankTransactionId)} className="inline-flex min-h-11 items-center font-bold text-accent hover:underline sm:min-h-0">الحركة</Link>
                            )}
                          </span>
                          {canEdit && deletableExpense(e)
                            ? <ExpenseDelete id={e.id} label={e.label} />
                            : <span className="text-[11px] text-muted">{e.source === "BANK" ? "يبقى لأنه من كشف البنك" : ""}</span>}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {suspects.length > 0 && (
            <section aria-labelledby="sus-title" className="overflow-hidden rounded-xl border border-danger/25 bg-danger-bg">
              <header className="flex items-start gap-3 px-4 py-3">
                <Store className="mt-0.5 h-[18px] w-[18px] shrink-0 text-danger" strokeWidth={2} aria-hidden />
                <div className="min-w-0 text-xs leading-relaxed text-ink-soft">
                  <T s="{0}إن كانت مشتريات فهي محسوبة مرتين: في المشتريات وهنا. صنّفها «سداد مورّد» ليُطبَّق ذلك على أمثالها دون سؤالك." a={[<h2 key="0" id="sus-title" className="text-[13px] font-bold text-danger"><T s="مصروفات بأسماء مورّدين: {0}" a={[countNoun(suspects.length, ITEM)]} /></h2>]} /></div>
              </header>
              <div className="px-3 pb-3">
                <ExpenseReclassify
                  suspects={suspects.map(({ expense: e, supplier }) => ({
                    id: e.id,
                    label: e.label,
                    amountMinor: e.amountMinor,
                    categoryLabel: CATEGORY_LABEL[e.category],
                    supplier,
                    supplierId: supplierRows.find((s) => s.nameAr === supplier)?.id ?? null,
                    bankTransactionId: e.bankTransactionId ?? null,
                  }))}
                />
              </div>
            </section>
          )}

          {unmet.length > 0 && (
            <Notice
              tone="warn"
              icon={CalendarClock}
              title={`مصروفات متوقعة لم تُصرف في ${formatMonth(month)}: ${countNoun(unmet.length, ITEM)}`}
              action={canEdit ? <ManualExpense variant="secondary" /> : undefined}
            >
              <T s="مصروفات تتكرر عادةً ولم يُسجَّل لها صرف هذا الشهر. ربما دفعتها نقداً ولم تسجّلها، أو نسيتها.{0}" a={[<ul key="0" className="mt-2 divide-y divide-warn/15">
                {unmet.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0 truncate font-bold text-ink">{r.label}</span>
                    <span className="shrink-0 font-bold text-ink"><Money minor={r.amountMinor} /></span>
                  </li>
                ))}
              </ul>]} /></Notice>
          )}
        </div>
      )}

      <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        {/* ── أين ذهب مصروفُ الشهر ── */}
        <Section title="التصنيفات" icon={PieChart} className="mt-0!" hint={`مصروفات ${formatMonth(month)} حسب التصنيف، من القيود أدناه.`}>
          {categories.length === 0 ? (
            <EmptyState compact title="لا توجد قيود في هذا الشهر." hint="سجّل المصروفات من كشف البنك، أو أضف ما دفعته نقداً." />
          ) : (
            <div className="rounded-2xl border border-line bg-raised p-3 shadow-raised">
              <BarList
                items={categories.map(([key, c]) => ({ key, label: c.label, minor: c.minor, sub: countNoun(c.n, ITEM) }))}
              />
            </div>
          )}

          {/*
            جدولُ «المتوقَّع مقابل الفعلي» بلا متوقَّعٍ عمودان من أربعةٍ يقولان
            «لم يُتوقَّع» — فلا يُعرَض إلّا حين يوجد ما يُقارَن به.
          */}
          {expectedTotal > 0 && variance.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-2 text-[13px] font-bold">المتوقع مقابل الفعلي</h3>
              <DataTable
                rows={variance}
                keyOf={(v) => v.category}
                columns={[
                  { key: "category", header: "التصنيف", primary: true, cell: (v) => v.label },
                  { key: "expected", header: "المتوقع", numeric: true, cell: (v) => v.expectedMinor === 0 ? <span className="text-muted">غير متوقع</span> : <Money minor={v.expectedMinor} /> },
                  { key: "actual", header: "الفعلي", numeric: true, cell: (v) => <Money minor={v.actualMinor} /> },
                  {
                    key: "variance", header: "الفرق", numeric: true,
                    cell: (v) => <span className="font-bold"><Money minor={v.varianceMinor} tone={v.varianceMinor > 0 ? "warn" : "ok"} /></span>,
                  },
                ]}
              />
            </div>
          )}
        </Section>

        {/* ── القيود ── */}
        <Section title="القيود" icon={ListChecks} className="mt-0!" count={actual.length || undefined}>
          <DataTable
            rows={actual}
            keyOf={(e) => e.id}
            searchOf={(e) => `${CATEGORY_LABEL[e.category] ?? ""} ${e.label} ${formatDay(e.occurredOn)} ${SOURCE_LABEL[e.source]}`}
            searchLabel="ابحث في قيود الشهر"
            empty={<EmptyState compact title="لا توجد قيود في هذا الشهر." hint="سجّل المصروفات من كشف البنك، أو أضف ما دفعته نقداً." />}
            columns={[
              {
                key: "what", header: "البند", primary: true,
                /*
                  البابُ أوّلاً ونصُّ البنك تحته — «REFERENCE : 81140155 VV26…»
                  لا يقرأ منه صاحبُ المقهى شيئاً، وبابُه («رسوم شبكة») ما يعنيه.
                */
                cell: (e) => (
                  <span className="block min-w-0">
                    <span className="block truncate font-bold">{CATEGORY_LABEL[e.category] ?? e.label}</span>
                    {e.label && e.label !== CATEGORY_LABEL[e.category] && (
                      <span className="mt-0.5 block max-w-[22rem] truncate text-[11px] font-normal text-muted" dir="auto">{e.label}</span>
                    )}
                  </span>
                ),
              },
              { key: "date", header: "التاريخ", cell: (e) => <bdi className="whitespace-nowrap text-ink-soft">{formatDay(e.occurredOn)}</bdi> },
              {
                key: "source", header: "المصدر", secondary: true,
                cell: (e) => (
                  <span className="inline-flex flex-wrap items-center gap-1">
                    <SourceBadge source={e.source} />
                    {e.recurringExpenseId && <Badge tone="info">مرتبط بمصروف متوقع</Badge>}
                  </span>
                ),
              },
              { key: "amount", header: "المبلغ", numeric: true, cell: (e) => <span className="font-bold"><Money minor={e.amountMinor} /></span> },
              {
                key: "act", header: "", wrap: true,
                /* القيد اليدويّ كان بلا باب حذف — فضغطتان على «قيّده» مصروفان إلى الأبد (BTN-114) */
                cell: (e) => (canEdit && e.source === "MANUAL" ? <ExpenseDelete id={e.id} label={e.label} /> : null),
              },
            ]}
          />
        </Section>
      </div>
    </PageShell>
  );
}

const SOURCE_LABEL: Record<Expense["source"], string> = {
  BANK: "من كشف البنك",
  INVOICE: "من فاتورة",
  MANUAL: "إدخال يدوي",
};

const SOURCE_TONE: Record<Expense["source"], Tone | undefined> = {
  BANK: undefined,
  INVOICE: "info",
  MANUAL: "accent",
};

function SourceBadge({ source }: { source: Expense["source"] }) {
  return <Badge tone={SOURCE_TONE[source]}>{SOURCE_LABEL[source]}</Badge>;
}

function Hero({
  label, minor, note, tone,
}: {
  label: string;
  minor: number;
  note?: string;
  tone?: "warn" | "ok";
}) {
  return (
    <div className="rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
      <p className="text-xs font-bold text-muted">{label}</p>
      <p className={`mt-4 text-[1.75rem] font-bold leading-none tracking-tight sm:text-[2rem] ${tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : ""}`}>
        <Money minor={minor} />
      </p>
      {note && <p className="mt-3 text-xs text-muted">{note}</p>}
    </div>
  );
}

/**
 * تنبيهٌ بفعله — كـ`Callout` المشترك، لكنّ الفعلَ ينزل تحت النصّ على الجوّال.
 * كان النصُّ يُعصَر في عمودٍ عرضُه ثلاثُ كلماتٍ بجانب زرٍّ لا ينكمش.
 * (مرشّحٌ للترقية إلى `ui.tsx`: `Callout` بفعلٍ يلتفّ.)
 */
function Notice({
  tone, icon: Icon, title, action, className = "", children,
}: {
  tone: "warn" | "accent";
  icon: LucideIcon;
  title: string;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const skin = tone === "warn" ? "border-warn/25 bg-warn-bg" : "border-accent-line bg-accent-soft";
  const ink = tone === "warn" ? "text-warn" : "text-accent";
  return (
    <div className={`flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-start ${skin} ${className}`}>
      <div className="flex min-w-0 flex-1 gap-3">
        <Icon className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${ink}`} strokeWidth={2} aria-hidden />
        <div className="min-w-0 flex-1 text-xs leading-relaxed text-ink-soft">
          <p className={`text-[13px] font-bold ${ink}`}>{title}</p>
          {children && <div className="mt-0.5">{children}</div>}
        </div>
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2 ps-[30px] sm:ps-0">{action}</div>}
    </div>
  );
}
