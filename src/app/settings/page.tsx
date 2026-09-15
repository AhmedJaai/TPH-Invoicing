import { BankRules, type BankRuleRow } from "@/components/bank-rules";
import { CATEGORY_LABEL } from "@/lib/bank/rules";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { currentUser } from "@/lib/session";
import { can, ROLE_LABEL } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { HubGrid, type HubTile } from "@/components/hub";
import { activeProviderName } from "@/lib/extraction";
import { isAuthBypassed } from "@/lib/session";
import { buildDataHealth } from "@/lib/data-health";
import { gatherHealthFacts } from "@/lib/data-health-facts";
import { RecurringExpenses, type ExpenseRow } from "@/components/recurring-expenses";
import { monthlyShare } from "@/lib/cashflow";
import type { TxCategory } from "@/lib/bank/rules";
import { NoAccess } from "@/components/ui";
import { ALIAS, countNoun } from "@/lib/arabic";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/settings");
  if (!can(user.role, "supplier:view")) {
    return (
      <PageShell user={user} title="الإعدادات">
        <NoAccess />
      </PageShell>
    );
  }

  const [f] = (
    await db.execute<Record<string, number>>(sql`
      select
        (select count(*)::int from suppliers where is_active)              as suppliers,
        (select count(*)::int from suppliers where not is_active)          as inactive,
        (select count(*)::int from supplier_aliases)                       as aliases,
        (select count(*)::int from bank_rules)                             as rules,
        (select count(*)::int from users)                                  as users,
        (select count(*)::int from audit_logs)                             as audit,
        (select count(*)::int from schema_migrations)                      as migrations
    `)
  ).rows;

  const rules: BankRuleRow[] = (
    await db.execute<{ id: string; pattern: string; category: string; supplier: string | null; note: string | null }>(sql`
      select r.id, r.pattern, r.category::text as category, s.name_ar as supplier, r.note
        from bank_rules r left join suppliers s on s.id = r.supplier_id
       order by r.created_at desc
    `)
  ).rows.map((r) => ({
    id: r.id,
    pattern: r.pattern,
    categoryLabel: CATEGORY_LABEL[r.category as TxCategory] ?? r.category,
    supplier: r.supplier,
    note: r.note,
  }));

  const health = buildDataHealth(await gatherHealthFacts());

  const allExpenses = (
    await db.execute<{ id: string; label: string; category: string; amount_minor: number; cadence: string; is_active: boolean }>(sql`
      select id, label, category::text as category, amount_minor, cadence, is_active
        from recurring_expenses order by amount_minor desc
    `)
  ).rows.map((r) => {
    const row = {
      id: r.id,
      label: r.label,
      category: r.category as TxCategory,
      amountMinor: Number(r.amount_minor),
      cadence: r.cadence as ExpenseRow["cadence"],
    };
    return { ...row, monthlyMinor: monthlyShare(row), isActive: r.is_active };
  });
  const toRow = (r: (typeof allExpenses)[number]): ExpenseRow => ({
    id: r.id, label: r.label, category: r.category, amountMinor: r.amountMinor,
    cadence: r.cadence, monthlyMinor: r.monthlyMinor,
  });
  const expenses: ExpenseRow[] = allExpenses.filter((r) => r.isActive).map(toRow);
  const inactiveExpenses: ExpenseRow[] = allExpenses.filter((r) => !r.isActive).map(toRow);

  const tiles: HubTile[] = [
    {
      href: "/suppliers",
      title: "المورّدون",
      value: String(f?.suppliers ?? 0),
      detail: `${countNoun(Number(f?.aliases ?? 0), ALIAS)} · ${Number(f?.inactive ?? 0) === 0 ? "لا معطَّل" : `${f?.inactive} معطَّلة بعد الدمج`}`,
    },
    {
      /* كانت تفتح /bank ولا قاعدة فيها — فالقائمة هنا */
      href: "/settings#rules",
      title: "قواعد تصنيف الحركات",
      value: String(f?.rules ?? 0),
      detail: "تُنشأ عند استيراد كشف البنك، وتُرى وتُحذف هنا",
    },
    {
      href: "/settings",
      title: "قارئ المستندات",
      value: activeProviderName(),
      detail: "الذي يقرأ الفواتير والكشوف الآن",
      disabled: true,
      disabledReason: "يُضبط عند النشر لا من هذه الشاشة",
    },
    {
      href: "/settings",
      title: "المستخدمون",
      value: String(f?.users ?? 0),
      detail: isAuthBypassed()
        ? "⚠ وضع التجربة مفعَّل — الدخول معطَّل"
        : `دورك: ${ROLE_LABEL[user.role]}`,
      tone: isAuthBypassed() ? "danger" : undefined,
      disabled: true,
      disabledReason: "إضافة مستخدم أو تغيير دوره يطلبه المالك ممّن يدير النشر",
    },
    {
      href: "/settings/audit",
      title: "سجل التدقيق",
      value: String(f?.audit ?? 0),
      detail: "ما فُعل ومن فعله ومتى — غير قابل للتعديل ولا الحذف",
    },
    {
      href: "/settings",
      title: "هجرات القاعدة",
      value: String(f?.migrations ?? 0),
      detail: "مطبَّقة بالترتيب ومسجَّلة",
      disabled: true,
      disabledReason: "تُطبَّق مع كلّ نشر — للاطّلاع وحده",
    },
  ];

  return (
    <PageShell
      user={user}
     
      title="الإعدادات"
      intro="ما يُضبط مرّة: المورّدون وقواعد التصنيف وحال الربط."
    >
      <HubGrid tiles={tiles} />

      <section id="rules" className="mt-10 scroll-mt-24">
        <h2 className="text-base font-bold">قواعد تصنيف الحركات</h2>
        <p className="mb-3 mt-1 text-xs leading-relaxed text-muted">
          ما قرّرتَه مرّةً عند استيراد كشف: حركةٌ فيها هذا النصّ تُصنَّف هكذا في كلّ كشفٍ بعده.
        </p>
        <BankRules rows={rules} canEdit={can(user.role, "bank:edit")} />
      </section>

      <section className="mt-10">
        <h2 className="text-base font-bold">المصروفات المتكرّرة</h2>
        <p className="mb-3 mt-1 text-xs leading-relaxed text-muted">
          ما يتكرّر بلا فاتورة تصلك: الإيجار والرواتب والاشتراكات. كشف البنك يقول
          «أين ذهب المال»، وهذه تقول «كم يُتوقَّع» — فيُقابَل المتوقَّع بالفعلي في
          قائمة الدخل.
        </p>
        <RecurringExpenses rows={expenses} inactive={inactiveExpenses} canEdit={can(user.role, "expense:edit")} />
      </section>

      <section className="mt-10">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h2 className="text-base font-bold">حال الربط وصحّة البيانات</h2>
          <span className="text-xs font-bold">ثقة الأرقام {Math.round(health.confidence * 100)}٪</span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted">
          ما ليس موصولاً يُقال عنه ذلك، ولا يُملأ بصفر ولا ببيانات وهمية.
        </p>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
          {health.metrics.map((m) => (
            <li key={m.id} className="px-4 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{m.label}</span>
                  <span className="block truncate text-[11px] text-muted">{m.detail}</span>
                </span>
                <span
                  className={`nums shrink-0 text-sm font-bold ${
                    m.state === "GOOD" ? "text-ok"
                    : m.state === "NOT_CONNECTED" ? "text-muted"
                    : m.state === "MISSING" ? "text-danger" : "text-warn"
                  }`}
                >
                  {m.coverage === null ? "غير موصول" : `${Math.round(m.coverage * 100)}٪`}
                </span>
              </div>
              {m.action && <p className="mt-1 text-[11px] text-ink-soft">← {m.action}</p>}
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-8 text-xs leading-relaxed text-muted">
        المعمارية الفعلية موثّقة في <bdi className="font-mono">docs/ARCHITECTURE.md</bdi> داخل المستودع.
      </p>
    </PageShell>
  );
}
