import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { Activity, Cpu, Repeat, ScrollText, ShieldAlert, SlidersHorizontal, Store, UserRound } from "lucide-react";
import { BankRules, type BankRuleRow } from "@/components/bank-rules";
import { CATEGORY_LABEL, type TxCategory } from "@/lib/bank/rules";
import { db } from "@/db";
import { currentUser, isAuthBypassed } from "@/lib/session";
import { can, ROLE_LABEL } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { activeProviderName } from "@/lib/extraction";
import { buildDataHealth, type HealthState } from "@/lib/data-health";
import { gatherHealthFacts } from "@/lib/data-health-facts";
import { RecurringExpenses, type ExpenseRow } from "@/components/recurring-expenses";
import { monthlyShare } from "@/lib/cashflow";
import { Callout, KeyValue, Meter, NoAccess, Section } from "@/components/ui";
import { ALIAS, countNoun } from "@/lib/arabic";

export const dynamic = "force-dynamic";

const HEALTH_UI: Record<HealthState, { tone: "ok" | "warn" | "danger" | "muted"; word: string }> = {
  GOOD: { tone: "ok", word: "مكتمل" },
  PARTIAL: { tone: "warn", word: "ناقص" },
  MISSING: { tone: "danger", word: "غائب" },
  NOT_CONNECTED: { tone: "muted", word: "غير موصول" },
};

/**
 * الإعدادات — ما يُضبط مرّة، في صفحةٍ بفهرس.
 *
 * كانت شبكةَ بطاقاتٍ نصفُها معطَّل («يُضبط عند النشر») ثمّ أقسامٌ متتابعة.
 * صارت أقساماً بفهرسٍ ثابت: الحساب · المصروفات المتكرّرة (وهي تغذّي النقد
 * القادم فتستحقّ موضعاً بارزاً) · قواعد التصنيف · صحّة البيانات · النظام.
 */
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

  const [[f], rulesRows, health, expenseRows] = await Promise.all([
    db.execute<Record<string, number>>(sql`
      select
        (select count(*)::int from suppliers where is_active)     as suppliers,
        (select count(*)::int from suppliers where not is_active) as inactive,
        (select count(*)::int from supplier_aliases)              as aliases,
        (select count(*)::int from bank_rules)                    as rules,
        (select count(*)::int from users)                         as users,
        (select count(*)::int from audit_logs)                    as audit
    `).then((r) => r.rows),
    db.execute<{ id: string; pattern: string; category: string; supplier: string | null; note: string | null }>(sql`
      select r.id, r.pattern, r.category::text as category, s.name_ar as supplier, r.note
        from bank_rules r left join suppliers s on s.id = r.supplier_id
       order by r.created_at desc
    `).then((r) => r.rows),
    gatherHealthFacts().then(buildDataHealth),
    db.execute<{ id: string; label: string; category: string; amount_minor: number; cadence: string; is_active: boolean; starts_on: string | null }>(sql`
      select id, label, category::text as category, amount_minor, cadence, is_active, starts_on
        from recurring_expenses order by amount_minor desc
    `).then((r) => r.rows),
  ]);

  const rules: BankRuleRow[] = rulesRows.map((r) => ({
    id: r.id,
    pattern: r.pattern,
    categoryLabel: CATEGORY_LABEL[r.category as TxCategory] ?? r.category,
    supplier: r.supplier,
    note: r.note,
  }));

  const all = expenseRows.map((r) => {
    const row = {
      id: r.id,
      label: r.label,
      category: r.category as TxCategory,
      amountMinor: Number(r.amount_minor),
      cadence: r.cadence as ExpenseRow["cadence"],
    };
    return { ...row, monthlyMinor: monthlyShare(row), isActive: r.is_active, startsOn: r.starts_on };
  });
  const toRow = (r: (typeof all)[number]): ExpenseRow => ({
    id: r.id, label: r.label, category: r.category, amountMinor: r.amountMinor,
    cadence: r.cadence, monthlyMinor: r.monthlyMinor, startsOn: r.startsOn,
  });

  const toc = [
    { id: "account", label: "الحساب", icon: UserRound },
    { id: "recurring", label: "المصروفات المتكرّرة", icon: Repeat },
    { id: "rules", label: "قواعد التصنيف", icon: SlidersHorizontal },
    { id: "health", label: "صحّة البيانات", icon: Activity },
    { id: "system", label: "النظام", icon: Cpu },
  ];

  return (
    <PageShell user={user} width="wide" title="الإعدادات" intro="ما يُضبط مرّة: المصروفاتُ المتكرّرة، وقواعدُ التصنيف، وحالُ الربط.">
      {/* `minmax(0,1fr)` على الجوّال أيضاً — عمودٌ ضمنيّ بعرض محتواه يمدّه صفُّ الفهرس فتفيض الصفحة كلُّها عرضاً */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="أقسام الإعدادات" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <ul className="scroll-x flex gap-1 overflow-x-auto lg:flex-col">
            {toc.map((t) => (
              <li key={t.id} className="shrink-0">
                <a href={`#${t.id}`} className="flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-[13px] text-ink-soft transition-colors hover:bg-hover hover:text-ink lg:min-h-9">
                  <t.icon className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} aria-hidden />
                  {t.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 max-w-4xl">
          <Section id="account" title="الحساب" icon={UserRound} className="mt-0!">
            <div className="rounded-xl border border-line bg-raised p-5 shadow-raised">
              <KeyValue
                columns={3}
                items={[
                  { label: "أنت", value: user.name ?? "مستخدم" },
                  { label: "دورك", value: ROLE_LABEL[user.role] },
                  { label: "المستخدمون", value: <span className="nums">{Number(f?.users ?? 0)}</span>, hint: "إضافةُ مستخدمٍ أو تغيير دوره من قائمة الدخول عند النشر" },
                ]}
              />
              {isAuthBypassed() && (
                <Callout tone="danger" icon={ShieldAlert} className="mt-4" title="وضع التجربة مفعَّل — الدخول معطَّل">
                  كلُّ من يعرف الرابط يدخل بصلاحية المالك. لا يعمل في الإنتاج مهما فُعِّل.
                </Callout>
              )}
            </div>
          </Section>

          <Section
            id="recurring"
            title="المصروفات المتكرّرة"
            icon={Repeat}
            hint="ما يتكرّر بلا فاتورةٍ تصلك: الإيجار والرواتب والاشتراكات. منها يُعرف «النقد القادم»، ويُقابَل المتوقَّعُ بالفعليّ."
            action={<Link href="/cash" className="text-xs font-bold text-accent hover:underline">النقد القادم</Link>}
          >
            <RecurringExpenses rows={all.filter((r) => r.isActive).map(toRow)} inactive={all.filter((r) => !r.isActive).map(toRow)} canEdit={can(user.role, "expense:edit")} />
          </Section>

          <Section id="rules" title="قواعد تصنيف الحركات" icon={SlidersHorizontal} count={rules.length} hint="ما قرّرتَه مرّةً عند استيراد كشف: حركةٌ فيها هذا النصّ تُصنَّف هكذا في كلّ كشفٍ بعده.">
            <BankRules rows={rules} canEdit={can(user.role, "bank:edit")} />
          </Section>

          <Section
            id="health"
            title="حال الربط وصحّة البيانات"
            icon={Activity}
            hint="ما ليس موصولاً يُقال عنه ذلك، ولا يُملأ بصفرٍ ولا ببياناتٍ وهميّة."
            action={<span className="text-xs font-bold text-ink-soft">الاكتمال <span className="nums">{Math.round(health.confidence * 100)}</span>٪</span>}
          >
            <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
              {health.metrics.map((m) => {
                const ui = HEALTH_UI[m.state];
                return (
                  <li key={m.id} className="px-4 py-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold">{m.label}</span>
                        <span className="block text-[11px] leading-relaxed text-muted">{m.detail}</span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        ui.tone === "ok" ? "bg-ok-bg text-ok" : ui.tone === "warn" ? "bg-warn-bg text-warn" : ui.tone === "danger" ? "bg-danger-bg text-danger" : "bg-sunken text-muted"
                      }`}>
                        {m.coverage === null ? ui.word : <>{ui.word} · <span className="nums">{Math.round(m.coverage * 100)}</span>٪</>}
                      </span>
                    </div>
                    {m.coverage !== null && (
                      <div className="mt-2.5">
                        <Meter value={Math.round(m.coverage * 100)} max={100} tone={ui.tone} label={m.label} />
                      </div>
                    )}
                    {m.action && <p className="mt-2 text-[11px] text-ink-soft">الخطوة التالية: {m.action}</p>}
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section id="system" title="النظام" icon={Cpu}>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
              <Link href="/suppliers" className="rounded-xl border border-line bg-raised p-4 shadow-raised transition-colors hover:border-accent-line">
                <Store className="h-4 w-4 text-muted" strokeWidth={2} aria-hidden />
                <p className="mt-2 text-sm font-bold">المورّدون <span className="nums text-muted">{Number(f?.suppliers ?? 0)}</span></p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {countNoun(Number(f?.aliases ?? 0), ALIAS)}{Number(f?.inactive ?? 0) > 0 ? ` · ${f?.inactive} معطَّلة بعد الدمج` : ""}
                </p>
              </Link>
              <Link href="/settings/audit" className="rounded-xl border border-line bg-raised p-4 shadow-raised transition-colors hover:border-accent-line">
                <ScrollText className="h-4 w-4 text-muted" strokeWidth={2} aria-hidden />
                <p className="mt-2 text-sm font-bold">سجلّ التدقيق <span className="nums text-muted">{Number(f?.audit ?? 0)}</span></p>
                <p className="mt-0.5 text-[11px] text-muted">ما فُعل ومن فعله ومتى — لا يُعدَّل ولا يُحذف</p>
              </Link>
              <div className="rounded-xl border border-line bg-raised p-4 shadow-raised">
                <Cpu className="h-4 w-4 text-muted" strokeWidth={2} aria-hidden />
                <p className="mt-2 text-sm font-bold">قارئ المستندات</p>
                <p className="mt-0.5 text-[11px] text-muted"><bdi dir="ltr">{activeProviderName()}</bdi> — يُضبط عند النشر</p>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </PageShell>
  );
}
