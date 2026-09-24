import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { expenses, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { DeriveExpenses } from "@/components/derive-expenses";
import { ManualExpense } from "@/components/manual-expense";
import { activeRecurring, countUnrecordedBankExpenses } from "@/services/expense.service";
import { formatRiyalsDisplay } from "@/lib/money";
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
import { NoAccess, DataTable } from "@/components/ui";
import { ExpenseReclassify } from "@/components/expense-reclassify";
import { ExpenseDelete } from "@/components/expense-delete";

export const dynamic = "force-dynamic";

/**
 * المتوقَّع مقابل الفعلي.
 *
 * السؤال الذي لم يكن النظام يجيبه: هل دُفع الإيجار هذا الشهر؟ وغياب
 * الجواب أخطر من الرقم — فالمصروف المنسيّ يظهر متأخّراً ومعه غرامته.
 */
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
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

  const months = (
    await db
      .select({ month: expenses.periodMonth })
      .from(expenses)
      .groupBy(expenses.periodMonth)
      .orderBy(desc(expenses.periodMonth))
  ).map((r) => r.month);

  const month = p.month && months.includes(p.month) ? p.month : months[0];

  if (!month) {
    const pendingAll = await countUnrecordedBankExpenses();
    return (
      <PageShell
        user={user}
        width="wide"
        title="المصروفات"
        intro="ما صُرف فعلاً، مقابل ما كان متوقَّعاً."
      >
        <UnrecordedNotice pending={pendingAll} />
        <DeriveExpenses />
        {can(user.role, "expense:edit") && <div className="mt-3"><ManualExpense /></div>}
        <div className="mt-4">
          <Empty message="لا مصروفات مقيَّدة بعد. اشتقّها من كشف البنك أعلاه." />
        </div>
      </PageShell>
    );
  }

  const [rows, recurring, supplierRows, pending] = await Promise.all([
    db.select().from(expenses).where(eq(expenses.periodMonth, month)).orderBy(desc(expenses.occurredOn)),
    activeRecurring(),
    db.select({ id: suppliers.id, nameAr: suppliers.nameAr }).from(suppliers),
    /* الفعليّ لا يُعرَض كاملاً وفي الكشف مصروفٌ لم يُقيَّد — النقصُ يُعلَن */
    countUnrecordedBankExpenses(month),
  ]);

  /*
    «مصروفٌ وصل مرّتين» — الأزواج التي يعدّها التنبيه، بالنافذة نفسها
    (مئةٌ وعشرون يوماً) لا بالشهر المعروض: كان التنبيه يقول «احذف الزائد
    بيدك» والصفحة لا تعرض زوجاً ولا زرّاً (BTN-111).
  */
  const duplicates = findDuplicateExpenses(
    (await db.select().from(expenses)
      .where(sql`${expenses.occurredOn} >= to_char(now() - interval '120 days', 'YYYY-MM-DD')`))
      .map((r) => ({
        id: r.id, periodMonth: r.periodMonth, occurredOn: r.occurredOn, category: r.category,
        label: r.label, amountMinor: r.amountMinor, source: r.source,
        bankTransactionId: r.bankTransactionId, recurringExpenseId: r.recurringExpenseId,
      })),
  );
  const canEditExpenses = can(user.role, "expense:edit");

  const actual: Expense[] = rows.map((r) => ({
    id: r.id,
    periodMonth: r.periodMonth,
    occurredOn: r.occurredOn,
    category: r.category,
    label: r.label,
    amountMinor: r.amountMinor,
    source: r.source,
    bankTransactionId: r.bankTransactionId,
    recurringExpenseId: r.recurringExpenseId,
  }));

  const variance = expectedVsActual(recurring, actual, month);
  const suspects = suspectedSupplierExpenses(actual, supplierRows.map((s) => s.nameAr));
  const unmet = unmetRecurring(recurring, actual, month);
  const actualTotal = totalActual(actual, month);
  const expectedTotal = totalExpected(recurring);

  return (
    <PageShell
      user={user}
      width="wide"
      title="المصروفات"
      intro="ما صُرف فعلاً، مقابل ما كان متوقَّعاً. وسداد المورّدين ليس هنا — فهو محسوبٌ في المشتريات، وقيده مرّتين يضاعف مصروف المقهى."
    >
      <div className="flex flex-wrap items-center gap-2">
        {months.map((m) => (
          <Link
            key={m}
            href={`/money/expenses?month=${m}`}
            aria-current={m === month ? "true" : undefined}
            className={`nums inline-flex min-h-11 items-center rounded-lg px-3 text-xs font-medium transition-colors sm:min-h-0 sm:py-1.5 ${
              m === month ? "bg-inverse-surface text-inverse-ink" : "border border-line hover:border-ink-soft"
            }`}
          >
            {m}
          </Link>
        ))}
      </div>

      {/*
        ── بطاقةٌ واحدة حين لا متوقَّع ──

        كانت ثلاثاً دائماً: «المتوقَّع ٠٫٠٠ — لم تُسجَّل مصروفات متكرّرة
        بعد»، و«الفعليّ»، و«الفرق: لا يمكن الحساب». اثنتان من ثلاثٍ
        تقولان «لا أعرف»، وهما ثُلثا أوّلِ ما يُقرأ في الصفحة.

        و**الصفرُ يُقرأ جواباً**: «المتوقَّع ٠٫٠٠» تقول إنّ المقهى لا
        يتوقّع أن يصرف شيئاً، وذلك غير «لم يُسجَّل بعد». فإن لم يُسجَّل
        متوقَّعٌ عُرض الفعليُّ وحده، ومعه سطرٌ واحدٌ يقول كيف تُفتَح
        المقارنة — لا بطاقتا فراغ.
      */}
      {expectedTotal === 0 ? (
        <>
          <div className="mt-6 sm:max-w-sm">
            <Box
              label={`الفعليّ في ${month}`}
              minor={actualTotal}
              tone={pending.count > 0 ? "warn" : undefined}
              note={
                pending.count > 0
                  ? `${countNoun(actual.length, ITEM)} · وناقصٌ منه ما لم يُقيَّد من الكشف`
                  : countNoun(actual.length, ITEM)
              }
            />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            ولا مقارنةَ بالمتوقَّع بعد — سجّل الإيجار والرواتب وما يتكرّر شهرياً في{" "}
            <Link href="/settings" className="font-medium underline underline-offset-4 hover:text-ink">
              الإعدادات
            </Link>{" "}
            ليُقابَل بها الفعليّ.
          </p>
        </>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Box label="المتوقَّع شهرياً" minor={expectedTotal} note={countNoun(recurring.length, ITEM)} />
          <Box
            label={`الفعليّ في ${month}`}
            minor={actualTotal}
            tone={pending.count > 0 ? "warn" : undefined}
            note={
              pending.count > 0
                ? `${countNoun(actual.length, ITEM)} · وناقصٌ منه ما لم يُقيَّد من الكشف`
                : countNoun(actual.length, ITEM)
            }
          />
          <Box
            label="الفرق"
            minor={actualTotal - expectedTotal}
            tone={actualTotal > expectedTotal ? "warn" : "ok"}
            note={actualTotal > expectedTotal ? "صُرف أكثر ممّا تُوقّع" : "صُرف أقلّ ممّا تُوقّع"}
          />
        </div>
      )}

      <UnrecordedNotice pending={pending} month={month} />
      {duplicates.length > 0 && (
        <section id="duplicates" className="mt-6 scroll-mt-28 rounded-xl border border-danger/40 bg-danger-bg p-4">
          <h2 className="text-sm font-bold text-danger">مصروفٌ وصل مرّتين ({countNoun(duplicates.length, ITEM)})</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            الحدث نفسه قُيّد من مصدرين، فعلا مصروف الشهر بقدر الزائد. أبقِ واحداً واحذف الآخر —
            وما اشتُقّ من كشف البنك يبقى، لأنّ الاشتقاق يعيده.
          </p>
          <ul className="mt-3 space-y-2.5">
            {duplicates.map((d) => (
              <li key={d.key} className="rounded-lg border border-line/60 bg-surface/60 px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-xs font-bold">{d.label}</span>
                  <span className="shrink-0 text-[11px] text-muted">الزائد <Money minor={d.amountMinor} /></span>
                </div>
                <ul className="mt-2 divide-y divide-line/60">
                  {d.members.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="min-w-0 text-[11px] text-muted">
                        <bdi className="nums">{e.occurredOn}</bdi> · {SOURCE_LABEL[e.source]} ·{" "}
                        <Money minor={e.amountMinor} />
                        {e.bankTransactionId && (
                          <>
                            {" · "}
                            <Link href={`/bank?tx=${e.bankTransactionId}`} className="inline-flex min-h-11 items-center underline underline-offset-4 sm:min-h-0">
                              حركته
                            </Link>
                          </>
                        )}
                      </span>
                      {canEditExpenses && deletableExpense(e)
                        ? <ExpenseDelete id={e.id} label={e.label} />
                        : <span className="text-[11px] text-muted">{e.source === "BANK" ? "يبقى — من كشف البنك" : ""}</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {unmet.length > 0 && (
        <section className="mt-6 rounded-xl border border-warn/40 bg-warn-bg p-4">
          <h2 className="text-sm font-bold text-warn">متوقَّع لم يُصرف في {month}</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            هذه بنود تتكرّر عادةً ولم يُقيَّد لها صرفٌ هذا الشهر. قد تكون دُفعت نقداً ولم
            تُسجَّل، وقد تكون نُسيت.
          </p>
          <ul className="mt-3 divide-y divide-line/60 rounded-lg border border-line/60 bg-surface/60">
            {unmet.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate text-xs font-medium">{r.label}</span>
                <span className="shrink-0 text-xs font-bold"><Money minor={r.amountMinor} /></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {suspects.length > 0 && (
        <section className="mt-6 rounded-xl border border-danger/40 bg-danger-bg p-4">
          <h2 className="text-sm font-bold text-danger">
            مصروفات تحمل أسماء مورّدين مسجّلين ({countNoun(suspects.length, ITEM)})
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            إن كانت هذه مشتريات فهي محسوبة مرّتين: في المشتريات وهنا. والنظام يقترح
            تصنيفها سداد مورّد — أكّده هنا، فيسري على أمثاله بلا سؤال.
          </p>
          <ExpenseReclassify
            /*
              ومعرّفُ المورّد يُمرَّر لا اسمُه وحده.

              كان يُرسَل الاسم، فيردّ الخادم بحقّ: «سداد المورّد يحتاج
              تحديد المورّد». والنظام يعرفه أصلاً — به طابق البند —
              فطلبُه من صاحب العمل سؤالٌ عمّا يُطرَح جوابُه.
            */
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
        </section>
      )}

      {/*
        وجدولُ «المتوقَّع مقابل الفعلي» بلا متوقَّعٍ عمودان من أربعةٍ
        يقولان «لم يُتوقَّع»، وعمودُ الفرق يساوي عمودَ الفعليّ. فلا
        يُعرَض — والقيودُ تحته تحمل التفصيل نفسه بلا ادّعاء مقارنة.
      */}
      {expectedTotal > 0 && (
      <section className="mt-8">
        <h2 className="mb-3 text-base font-bold">المتوقَّع مقابل الفعلي</h2>
        {variance.length === 0 ? (
          <Empty message="لا بيانات لهذا الشهر." />
        ) : (
          <DataTable
            rows={variance}
            keyOf={(v) => v.category}
            columns={[
              { key: "category", header: "الباب", primary: true, cell: (v) => v.label },
              { key: "expected", header: "المتوقَّع", numeric: true, cell: (v) => v.expectedMinor === 0 ? <span className="text-muted">لم يُتوقَّع</span> : <Money minor={v.expectedMinor} /> },
              { key: "actual", header: "الفعليّ", numeric: true, cell: (v) => <Money minor={v.actualMinor} /> },
              {
                key: "variance", header: "الفرق", numeric: true,
                cell: (v) => (
                  <span className="font-bold">
                    <Money minor={v.varianceMinor} tone={v.varianceMinor > 0 ? "warn" : "ok"} />
                    {v.variancePct !== null && (
                      <span className="ms-1 text-[11px] font-normal text-muted">
                        {v.variancePct > 0 ? "+" : ""}{Math.round(v.variancePct * 100)}٪
                      </span>
                    )}
                  </span>
                ),
              },
            ]}
          />
        )}
      </section>
      )}

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-base font-bold">القيود</h2>
          <>
            <DeriveExpenses month={month} />
            {can(user.role, "expense:edit") && <div className="mt-3"><ManualExpense /></div>}
          </>
        </div>
        {actual.length === 0 ? (
          <Empty message="لا قيود في هذا الشهر." />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
            {actual.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                {/*
                  ── البابُ أوّلاً، ونصُّ البنك تحته ──

                  كان السطرُ الأوّل `label` وهو منقولٌ عن وصف الحركة:
                  «REFERENCE : 81140155 VV26 0831 000000». أربعةَ عشر
                  صفّاً كذلك بمبالغ ٠٫٣٩ و٠٫٥٧ ريالاً — لا يقرأ منها
                  صاحبُ المقهى شيئاً، ولا يفرّق صفّاً عن أخيه.

                  وبابُ المصروف («رسوم شبكة») هو ما يعنيه، وهو محسوبٌ
                  عندنا. فصُدِّر إلى الأعلى وبقي نصُّ البنك تحته: من
                  يقابل الصفَّ بكشفه يجده، ومن يقرأ ليعرف أين ذهب المال
                  يقرأ الباب.

                  ولم يُمَسّ ما في القاعدة: `label` كما هو، والتغيير في
                  العرض وحده.
                */}
                <span className="min-w-0">
                  <span className="block truncate text-sm">
                    {CATEGORY_LABEL[e.category] ?? e.label}
                  </span>
                  <span className="block truncate text-[11px] text-muted">
                    <bdi className="nums">{e.occurredOn}</bdi> · {SOURCE_LABEL[e.source]}
                    {e.recurringExpenseId && " · مربوط بمتوقَّع"}
                  </span>
                  {e.label && e.label !== CATEGORY_LABEL[e.category] && (
                    <span className="block truncate text-[11px] text-muted" dir="auto">
                      {e.label}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-bold"><Money minor={e.amountMinor} /></span>
                  {/* القيد اليدويّ كان بلا باب حذف — فضغطتان على «قيّده» مصروفان إلى الأبد (BTN-114) */}
                  {canEditExpenses && e.source === "MANUAL" && <ExpenseDelete id={e.id} label={e.label} />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}

/**
 * «الفعليّ» ناقص — ويُقال بعدده ومبلغه ومعه زرُّ الاشتقاق نفسه.
 * ولا يُعرَض شيءٌ حين لا نقص: الإنذارُ الدائم يُفقد الثقة بما عداه.
 */
function UnrecordedNotice({ pending, month }: { pending: { count: number; amountMinor: number }; month?: string }) {
  if (pending.count === 0) return null;
  return (
    <section className="mt-6 rounded-xl border border-warn/40 bg-warn-bg p-4">
      <h2 className="text-sm font-bold text-warn">
        في الكشف {countNoun(pending.count, TRANSACTION)} من أبواب المصروف لم تُقيَّد بعد ({formatRiyalsDisplay(pending.amountMinor)} ريال)
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">
        {month ? `فالفعليّ في ${month} أقلّ من الواقع بهذا القدر.` : "فالمصروف الفعليّ أقلّ من الواقع بهذا القدر."}
        {" "}ولا يُعدّ هنا سدادُ المورّدين ولا ما يقول وصفُه شراءَ بضاعة — فذلك في المشتريات.
      </p>
      <div className="mt-3"><DeriveExpenses month={month} /></div>
    </section>
  );
}

const SOURCE_LABEL: Record<Expense["source"], string> = {
  BANK: "من كشف البنك",
  INVOICE: "من فاتورة",
  MANUAL: "قيدٌ يدويّ",
};

function Box({
  label, minor, note, tone,
}: {
  label: string;
  /** `null` حين لا يصحّ الحساب — والرقم حينئذٍ لا يُعرَض. */
  minor: number | null;
  note?: string;
  tone?: "warn" | "ok" | "muted";
}) {
  const cls = tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : tone === "muted" ? "text-muted" : "";
  return (
    <div className="rounded-2xl border border-line bg-raised shadow-raised px-4 py-3.5">
      <p className="text-xs text-muted">{label}</p>
      {/*
        كانت البطاقة تعرض «الفرق ‎28.20‎» وتحته «لا مقارنة بلا متوقَّع» —
        رقمٌ وإنكارٌ له في بطاقةٍ واحدة. فإن لم تصحّ المقارنة لم يُعرض
        رقمٌ أصلاً، ويُقال ما ينقص كي يُستدرَك.
      */}
      <p className={`nums mt-1.5 text-2xl font-bold leading-none ${minor === null ? "text-muted" : cls}`}>
        {minor === null ? "لا يمكن الحساب" : <Money minor={minor} />}
      </p>
      {note && <p className="mt-1.5 text-xs text-muted">{note}</p>}
    </div>
  );
}
