import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { Activity, BellRing, CalendarClock, Camera, Cpu, Languages, Repeat, ScrollText, ShieldAlert, SlidersHorizontal, Store, UserRound, UsersRound } from "lucide-react";
import { CaptureLinks } from "@/components/capture-links";
import { listLinks } from "@/services/capture.service";
import { BankRules, type BankRuleRow } from "@/components/bank-rules";
import { CATEGORY_LABEL, isTxCategory } from "@/lib/bank/rules";
import { asCadence } from "@/lib/cash-outlook";
import { db } from "@/db";
import { currentUser, isAuthBypassed } from "@/lib/session";
import { can, ROLE_LABEL } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { activeProviderName } from "@/lib/extraction";
import { buildDataHealth, type HealthState } from "@/lib/data-health";
import { gatherHealthFacts } from "@/lib/data-health-facts";
import { RecurringExpenses, type ExpenseRow } from "@/components/recurring-expenses";
import { monthlyShare } from "@/lib/cashflow";
import { Callout, KeyValue, LinkButton, Meter, NoAccess, Section } from "@/components/ui";
import { ALIAS, countNoun, timeAgo } from "@/lib/arabic";
import { UserAdmin } from "@/components/user-admin";
import { aiSpendThisMonth } from "@/services/ai-usage.service";
import { latestDailyCheck, readAiBalance } from "@/services/daily-checks.service";
import { balanceIsLow, formatAiBalance } from "@/lib/ai/balance";
import { formatMoment } from "@/lib/riyadh-time";
import { dailyBudgetMicroUsd, formatUsd } from "@/lib/ai/usage-ledger";
import { listUsersForAdmin } from "@/services/user-admin.service";
import { cookies } from "next/headers";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { PushSettings } from "@/components/push-settings";
import { pushPublicKey } from "@/services/push.service";
import { asLocale, LOCALE_COOKIE } from "@/lib/i18n/locale";
import { T } from "@/components/i18n/t";

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
    categoryLabel: isTxCategory(r.category) ? CATEGORY_LABEL[r.category] : r.category,
    supplier: r.supplier,
    note: r.note,
  }));

  const all = expenseRows.map((r) => {
    const row = {
      id: r.id,
      label: r.label,
      category: isTxCategory(r.category) ? r.category : "OTHER",
      amountMinor: Number(r.amount_minor),
      cadence: asCadence(r.cadence),
    };
    return { ...row, monthlyMinor: monthlyShare(row), isActive: r.is_active, startsOn: r.starts_on };
  });
  const toRow = (r: (typeof all)[number]): ExpenseRow => ({
    id: r.id, label: r.label, category: r.category, amountMinor: r.amountMinor,
    cadence: r.cadence, monthlyMinor: r.monthlyMinor, startsOn: r.startsOn,
  });

  /*
    الإيجارُ والرواتبُ مبالغ — ومديرُ المشتريات لا يرى المبالغ. وكان القسمُ
    يُعرض لكلّ من يرى المورّدين، فيقرأ رواتبَ زملائه. وقواعدُ التصنيف نصوصُ
    حركات البنك، فلمن يرى البنك وحده.
  */
  const showMoney = can(user.role, "amounts:view");
  const showRules = can(user.role, "bank:view");
  /* إدارةُ المستخدمين للمالك وحده — والخادمُ يحرسها بالقدرة نفسها (`/api/users`) */
  /* ما أنفقه القارئُ هذا الشهر — `null` إن لم يُعرف (لا يُعرض صفراً)، وصفرُ نداءٍ «لم يُقيَّد شيء» */
  const spend = showMoney ? await aiSpendThisMonth() : null;
  const aiSpend = spend && spend.calls > 0 ? spend : null;
  const aiBudget = dailyBudgetMicroUsd(process.env.AI_DAILY_BUDGET_USD);
  /* رصيدُ المزوّد كما وجده فحصُ الصباح — والمجهولُ «غير معروف» لا صفر */
  const balanceCheck = showMoney ? await latestDailyCheck("AI_BALANCE") : null;
  const aiBalance = balanceCheck ? readAiBalance(balanceCheck.payload) : null;
  const managedUsers = can(user.role, "users:manage") && !isAuthBypassed() ? await listUsersForAdmin() : null;
  const captureLinks = can(user.role, "users:manage") ? await listLinks() : null;
  const locale = asLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const toc = [
    { id: "account", label: "الحساب", icon: UserRound },
    { id: "language", label: "اللغة", icon: Languages },
    ...(showMoney ? [{ id: "push", label: "إشعار الصباح", icon: BellRing }] : []),
    ...(managedUsers ? [{ id: "users", label: "المستخدمون", icon: UsersRound }] : []),
    ...(showMoney ? [{ id: "recurring", label: "المصروفات المتكررة", icon: Repeat }] : []),
    ...(showRules ? [{ id: "rules", label: "قواعد التصنيف", icon: SlidersHorizontal }] : []),
    { id: "health", label: "صحة البيانات", icon: Activity },
    { id: "system", label: "النظام", icon: Cpu },
  ];

  return (
    <PageShell user={user} width="wide" title="الإعدادات" intro={`إعدادات تضبطها مرة واحدة: ${[showMoney ? "المصروفات المتكررة" : null, showRules ? "قواعد التصنيف" : null, "حالة الربط"].filter(Boolean).join("، و")}.`}>
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
                  { label: "المستخدمون", value: <span className="nums">{Number(f?.users ?? 0)}</span>, hint: managedUsers ? "تدير الأدوار والتعطيل والجلسات من قسم «المستخدمون» أدناه. ويُضاف البريد الجديد إلى قائمة الدخول عند النشر." : "يديرهم مالك الحساب." },
                ]}
              />
              {isAuthBypassed() && (
                <Callout tone="danger" icon={ShieldAlert} className="mt-4" title="وضع التجربة مفعّل، وتسجيل الدخول معطّل">
                  <T s="كل من يعرف الرابط يدخل بدور «{0}». هذا الوضع لا يعمل في الإنتاج مهما كانت الإعدادات." a={[ROLE_LABEL[user.role]]} /></Callout>
              )}
            </div>
          </Section>

          <Section id="language" title="اللغة" icon={Languages} hint="لغة الواجهة على هذا الجهاز. أسماء المورّدين ونصوص المستندات تبقى كما هي.">
            <LanguageSwitch current={locale} />
          </Section>

          {showMoney && (
            <Section id="push" title="إشعار الصباح" icon={BellRing} hint="على هذا الجهاز وحده. وكل جهاز تفعّله منفصلاً.">
              <PushSettings publicKey={pushPublicKey()} />
            </Section>
          )}

          {can(user.role, "reports:view") && (
            <Callout tone="accent" icon={CalendarClock} className="mt-6" title="الوثائق والتراخيص" action={<LinkButton href="/settings/obligations" variant="secondary" size="sm">افتح الوثائق</LinkButton>}>
              السجل التجاري ورخصة البلدية والشهادات الصحية والإقامات وعقد الإيجار، وتاريخ انتهاء كل منها. يذكّرك النظام قبل أن تنتهي.
            </Callout>
          )}

          {managedUsers && (
            <Section
              id="users"
              title="المستخدمون"
              icon={UsersRound}
              count={managedUsers.length}
              hint="من يستطيع الدخول، وبأي دور، ومن جلسته مفتوحة. يُضاف البريد الجديد إلى قائمة الدخول عند النشر، ويظهر هنا بعد أول دخول له، ثم تغيّر دوره من هنا."
            >
              <UserAdmin
                meId={user.id}
                users={managedUsers.map((u) => ({
                  id: u.id, name: u.name, email: u.email, role: u.role, isActive: u.isActive,
                  activeSessions: u.activeSessions,
                  lastSeenAbout: u.lastSeenAbout ? timeAgo(u.lastSeenAbout) : null,
                  note: u.note,
                }))}
              />
            </Section>
          )}

          {captureLinks && (
            <Section
              id="team-links"
              title="روابط تصوير الفريق"
              icon={Camera}
              count={captureLinks.length}
              hint="رابط لكل باريستا يصوّر به الفاتورة الورقية حين يستلمها، بلا حساب ولا كلمة مرور. لا يرى شيئاً غير ما أرسله، وتنتظر صوره اعتمادك في صفحة الرفع."
            >
              <CaptureLinks
                links={captureLinks.map((l) => ({
                  ...l,
                  createdAt: l.createdAt.toISOString(),
                  lastUsedAt: l.lastUsedAt?.toISOString() ?? null,
                }))}
              />
            </Section>
          )}

          {showMoney && (
            <Section
              id="recurring"
              title="المصروفات المتكررة"
              icon={Repeat}
              hint="مصروفات تتكرر بلا فاتورة: الإيجار والاشتراكات والخدمات. يعتمد عليها «النقد القادم»، ويقارن بها المتوقع بالفعلي. والرواتب يحملها مسيّر الرواتب."
              action={can(user.role, "bank:view") ? <Link href="/cash" className="text-xs font-bold text-accent hover:underline">النقد القادم</Link> : undefined}
            >
              <RecurringExpenses rows={all.filter((r) => r.isActive).map(toRow)} inactive={all.filter((r) => !r.isActive).map(toRow)} canEdit={can(user.role, "expense:edit")} />
            </Section>
          )}

          {showRules && (
            <Section id="rules" title="قواعد تصنيف الحركات" icon={SlidersHorizontal} count={rules.length} hint="تصنيف اخترته مرة عند استيراد كشف، فيُطبَّق على كل حركة فيها هذا النص في الكشوف التالية.">
              <BankRules rows={rules} canEdit={can(user.role, "bank:edit")} />
            </Section>
          )}

          <Section
            id="health"
            title="حالة الربط وصحة البيانات"
            icon={Activity}
            hint="ما ليس موصولاً يظهر كذلك، ولا يُملأ بأصفار ولا ببيانات وهمية."
            action={<span className="text-xs font-bold text-ink-soft"><T s="نسبة الاكتمال {0}٪" a={[<span key="0" className="nums">{Math.round(health.confidence * 100)}</span>]} /></span>}
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
                    {m.action && <p className="mt-2 text-[11px] text-ink-soft"><T s="الخطوة التالية: {0}" a={[m.action]} /></p>}
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section id="system" title="النظام" icon={Cpu}>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
              <Link href="/suppliers" className="rounded-xl border border-line bg-raised p-4 shadow-raised transition-colors hover:border-accent-line">
                <Store className="h-4 w-4 text-muted" strokeWidth={2} aria-hidden />
                <p className="mt-2 text-sm font-bold"><T s="المورّدون {0}" a={[<span key="0" className="nums text-muted">{Number(f?.suppliers ?? 0)}</span>]} /></p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {countNoun(Number(f?.aliases ?? 0), ALIAS)}{Number(f?.inactive ?? 0) > 0 ? ` · ${f?.inactive} معطّلة بعد الدمج` : ""}
                </p>
              </Link>
              {can(user.role, "audit:view") && (
                <Link href="/settings/audit" className="rounded-xl border border-line bg-raised p-4 shadow-raised transition-colors hover:border-accent-line">
                  <ScrollText className="h-4 w-4 text-muted" strokeWidth={2} aria-hidden />
                  <p className="mt-2 text-sm font-bold"><T s="سجل التدقيق {0}" a={[<span key="0" className="nums text-muted">{Number(f?.audit ?? 0)}</span>]} /></p>
                  <p className="mt-0.5 text-[11px] text-muted">ماذا حدث، ومن فعله، ومتى. السجل لا يُعدَّل ولا يُحذف.</p>
                </Link>
              )}
              <div className="rounded-xl border border-line bg-raised p-4 shadow-raised">
                <Cpu className="h-4 w-4 text-muted" strokeWidth={2} aria-hidden />
                <p className="mt-2 text-sm font-bold">قارئ المستندات</p>
                <p className="mt-0.5 text-[11px] text-muted"><T s="{0} — يُضبط عند النشر" a={[<bdi key="0" dir="ltr">{activeProviderName()}</bdi>]} /></p>
                {showMoney && (
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
                    {aiSpend === null
                      ? "إنفاقه هذا الشهر غير معروف، لأنه لم تُسجَّل أي عملية قراءة بعد"
                      : <><T s="إنفاقه التقديري هذا الشهر: {0} عن {1} عملية قراءة" a={[<bdi key="0" dir="ltr" className="nums font-bold">${formatUsd(aiSpend.costMicroUsd)}</bdi>, <span key="1" className="nums">{aiSpend.calls}</span>]} /></>}
                    {aiBudget !== null && <> <T s=" · الحد اليومي {0}" a={[<bdi key="0" dir="ltr" className="nums">${formatUsd(aiBudget)}</bdi>]} /></>}
                  </p>
                )}
                {showMoney && (
                  <p className={`mt-1 text-[11px] leading-relaxed ${aiBalance && balanceIsLow(aiBalance) ? "font-bold text-danger" : "text-ink-soft"}`}>
                    {!balanceCheck || !aiBalance
                      ? "رصيده عند المزوّد غير معروف، لأن فحص الصباح لم يسأل عنه بعد"
                      : <T s="رصيده عند المزوّد: {0} · فحص {1}" a={[<bdi key="0" dir="ltr" className="nums font-bold">{formatAiBalance(aiBalance)}</bdi>, formatMoment(balanceCheck.checkedAt)]} />}
                    {aiBalance && balanceIsLow(aiBalance) && <> <T s="· ينفد، اشحنه من {0}" a={[<bdi key="0" dir="ltr">platform.deepseek.com</bdi>]} /></>}
                  </p>
                )}
              </div>
            </div>
          </Section>
        </div>
      </div>
    </PageShell>
  );
}
