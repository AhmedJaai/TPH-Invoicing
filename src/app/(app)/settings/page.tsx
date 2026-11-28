import Link from "next/link";
import { ProfileName } from "@/components/profile-name";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { Activity, BellRing, CalendarClock, Camera, Cpu, HardDrive, Languages, Repeat, ScrollText, ShieldAlert, SlidersHorizontal, Store, UserRound, UsersRound } from "lucide-react";
import { CaptureLinks } from "@/components/capture-links";
import { listLinks } from "@/services/capture.service";
import { BankRules, type BankRuleRow } from "@/components/bank-rules";
import { CATEGORY_LABEL, isTxCategory } from "@/lib/bank/rules";
import { loadRecurringSuggestions } from "@/services/cash-outlook.service";
import { asCadence } from "@/lib/cadence";
import { db } from "@/db";
import { currentUser, isAuthBypassed } from "@/lib/session";
import { can, ROLE_LABEL } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { activeProviderName } from "@/lib/extraction";
import { buildDataHealth, type HealthState } from "@/lib/data-health";
import { gatherHealthFacts } from "@/lib/data-health-facts";
import { loadRecentServerErrors } from "@/services/server-errors.service";
import { loadBackupVerdict } from "@/services/backup-status.service";
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

  const [[f], rulesRows, health, expenseRows, serverErrorRows, backup] = await Promise.all([
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
    /* أعطابُ الخادم (107) — للمالك وحده، وقاعدةٌ بلا الجدول بعد لا تُسقط الصفحة */
    can(user.role, "audit:view") ? loadRecentServerErrors(7).catch(() => null) : Promise.resolve(null),
    can(user.role, "audit:view") ? loadBackupVerdict().catch(() => null) : Promise.resolve(null),
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
  /* دفعةٌ مقدّمة معروفة (إيجارُ نصفِ سنة) يُقترح تسجيلُها متكرّرةً — لمن يرى المبالغ ويحرّر المصروفات وحده */
  const recurringSuggestions = showMoney && can(user.role, "expense:edit") ? await loadRecurringSuggestions() : [];
  const aiSpend = spend && spend.calls > 0 ? spend : null;
  const aiBudget = dailyBudgetMicroUsd(process.env.AI_DAILY_BUDGET_USD);
  /* رصيدُ المزوّد كما وجده فحصُ الصباح — والمجهولُ «غير معروف» لا صفر */
  const balanceCheck = showMoney ? await latestDailyCheck("AI_BALANCE") : null;
  const aiBalance = balanceCheck ? readAiBalance(balanceCheck.payload) : null;
  const managedUsers = can(user.role, "users:manage") && !isAuthBypassed() ? await listUsersForAdmin() : null;
  const captureLinks = can(user.role, "users:manage") ? await listLinks() : null;
  const locale = asLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  /*
    الأقسامُ مجموعةٌ بالعمل لا بترتيب بنائها: «أنت وهذا الجهاز» · «الفريق» · «ما يتكرّر» ·
    «البنك» · «صحّة النظام». كان الفهرسُ ثمانيةَ بنودٍ مسطّحة يغيب عنه نصفُ الصفحة
    (روابطُ الفريق والوثائقُ والنسخةُ الاحتياطيّة والأعطال).
  */
  const groups = [
    { id: "me", title: "أنت وهذا الجهاز", hint: "اسمك ودورك، ولغة الواجهة، وإشعار الصباح على هذا الجهاز.", items: [
      { id: "account", label: "الحساب", icon: UserRound },
      { id: "language", label: "اللغة", icon: Languages },
      ...(showMoney ? [{ id: "push", label: "إشعار الصباح", icon: BellRing }] : []),
    ] },
    ...(managedUsers || captureLinks ? [{ id: "team", title: "الفريق والدخول", hint: "من يدخل النظام وبأي دور، وروابط التصوير التي يرسل بها الفريق فواتيره.", items: [
      ...(managedUsers ? [{ id: "users", label: "المستخدمون", icon: UsersRound }] : []),
      ...(captureLinks ? [{ id: "team-links", label: "روابط التصوير", icon: Camera }] : []),
    ] }] : []),
    ...(showMoney || can(user.role, "reports:view") ? [{ id: "recurring-group", title: "ما يتكرر وما ينتهي", hint: "المصروفات التي تتكرر بلا فاتورة، والوثائق والتراخيص التي لها تاريخ انتهاء.", items: [
      ...(showMoney ? [{ id: "recurring", label: "المصروفات المتكررة", icon: Repeat }] : []),
      ...(can(user.role, "reports:view") ? [{ id: "obligations", label: "الوثائق والتراخيص", icon: CalendarClock }] : []),
    ] }] : []),
    ...(showRules ? [{ id: "bank-group", title: "تصنيف البنك", hint: "ما اخترته مرة لحركة في الكشف فصار يُطبَّق وحده بعدها.", items: [
      { id: "rules", label: "قواعد التصنيف", icon: SlidersHorizontal },
    ] }] : []),
    { id: "system-group", title: "صحة النظام", hint: "هل البيانات مكتملة، وهل النسخة الاحتياطية حديثة، وهل تعطّل شيء.", items: [
      { id: "health", label: "صحة البيانات", icon: Activity },
      { id: "system", label: "النظام", icon: Cpu },
      ...(backup !== null ? [{ id: "backup", label: "النسخة الاحتياطية", icon: HardDrive }] : []),
      ...(serverErrorRows !== null ? [{ id: "errors", label: "أعطال النظام", icon: ShieldAlert }] : []),
    ] },
  ];
  const groupOf = (id: string) => groups.find((g) => g.id === id);
  const healthWorst = health.metrics.some((m) => m.state === "MISSING") ? "danger" : health.metrics.some((m) => m.state === "PARTIAL") ? "warn" : "ok";
  const goodMetrics = health.metrics.filter((m) => m.state === "GOOD");
  const otherMetrics = health.metrics.filter((m) => m.state !== "GOOD");

  return (
    <PageShell user={user} width="wide" title="الإعدادات" intro={`إعدادات تضبطها مرة واحدة: ${[showMoney ? "المصروفات المتكررة" : null, showRules ? "قواعد التصنيف" : null, "حالة الربط"].filter(Boolean).join("، و")}.`}>
      {/* `minmax(0,1fr)` على الجوّال أيضاً — عمودٌ ضمنيّ بعرض محتواه يمدّه صفُّ الفهرس فتفيض الصفحة كلُّها عرضاً */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="أقسام الإعدادات" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <ul className="scroll-x flex gap-1 overflow-x-auto lg:flex-col lg:gap-0">
            {groups.map((g) => (
              <li key={g.id} className="flex shrink-0 gap-1 lg:block lg:pb-3">
                <p className="hidden px-3 pb-1 pt-2 text-[11px] font-bold text-muted lg:block">{g.title}</p>
                <ul className="flex gap-1 lg:flex-col">
                  {g.items.map((t) => (
                    <li key={t.id} className="shrink-0">
                      <a href={`#${t.id}`} className="flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-[13px] text-ink-soft transition-colors hover:bg-hover hover:text-ink lg:min-h-9">
                        <t.icon className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} aria-hidden />
                        {t.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 max-w-4xl">
          {/* ── الجوابُ أوّلاً: هل كلُّ شيءٍ سليم؟ — وكلُّ بطاقةٍ تنزل إلى قسمها ── */}
          <section aria-label="حال النظام الآن" className="mb-10 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
            <StatusTile href="#health" label="اكتمال البيانات" tone={healthWorst}
              value={<><span className="nums">{Math.round(health.confidence * 100)}</span>٪</>}
              sub={otherMetrics.length === 0 ? "كل مصادر البيانات مكتملة" : `ينقص: ${otherMetrics.map((m) => m.label).join("، ")}`} />
            {backup !== null && (
              <StatusTile href="#backup" label="النسخة الاحتياطية"
                tone={backup.state === "OK" ? "ok" : backup.state === "CORE_STALE" ? "danger" : "warn"}
                value={backup.state === "OK" ? "حديثة" : backup.state === "UNKNOWN" ? "غير معروف" : backup.state === "CORE_STALE" ? "متأخرة" : "نسخة الدرايف متأخرة"}
                sub={backup.state === "UNKNOWN" ? "لم تُبلغ عن نفسها بعد" : <T s="آخر تشغيل {0}" a={[formatMoment(new Date(backup.hb.at))]} />} />
            )}
            {serverErrorRows !== null && (
              <StatusTile href="#errors" label="أعطال آخر سبعة أيام" tone={serverErrorRows.length === 0 ? "ok" : "warn"}
                value={serverErrorRows.length === 0 ? "لا عطل" : <span className="nums">{serverErrorRows.length}</span>}
                sub={serverErrorRows.length === 0 ? "لم يتعطل شيء" : "أعطال مختلفة، لكل منها مرجع ترسله للمطوّر"} />
            )}
          </section>

          <JobGroup group={groupOf("me")} first />
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
              {!isAuthBypassed() && can(user.role, "document:upload") && <ProfileName current={user.name ?? null} />}
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


          {(managedUsers || captureLinks) && <JobGroup group={groupOf("team")} />}
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

          <JobGroup group={groupOf("recurring-group")} />
          {showMoney && (
            <Section
              id="recurring"
              title="المصروفات المتكررة"
              icon={Repeat}
              hint="مصروفات تتكرر بلا فاتورة: الإيجار والاشتراكات والخدمات. يعتمد عليها «النقد القادم»، ويقارن بها المتوقع بالفعلي. والرواتب يحملها مسيّر الرواتب."
              action={can(user.role, "bank:view") ? <Link href="/cash" className="text-xs font-bold text-accent hover:underline">النقد القادم</Link> : undefined}
            >
              <RecurringExpenses rows={all.filter((r) => r.isActive).map(toRow)} inactive={all.filter((r) => !r.isActive).map(toRow)} canEdit={can(user.role, "expense:edit")} suggestions={recurringSuggestions.flatMap((s) => (isTxCategory(s.category) ? [{ ...s, category: s.category }] : []))} />
            </Section>
          )}
          {can(user.role, "reports:view") && (
            <div id="obligations" className="scroll-mt-24">
            <Callout tone="accent" icon={CalendarClock} className="mt-6" title="الوثائق والتراخيص" action={<LinkButton href="/settings/obligations" variant="secondary" size="sm">افتح الوثائق</LinkButton>}>
              السجل التجاري ورخصة البلدية والشهادات الصحية والإقامات وعقد الإيجار، وتاريخ انتهاء كل منها. يذكّرك النظام قبل أن تنتهي.
            </Callout>
            </div>
          )}

          <JobGroup group={groupOf("bank-group")} />
          {showRules && (
            <Section id="rules" title="قواعد تصنيف الحركات" icon={SlidersHorizontal} count={rules.length} hint="تصنيف اخترته مرة عند استيراد كشف، فيُطبَّق على كل حركة فيها هذا النص في الكشوف التالية.">
              <BankRules rows={rules} canEdit={can(user.role, "bank:edit")} />
            </Section>
          )}

          <JobGroup group={groupOf("system-group")} />
          <Section
            id="health"
            title="حالة الربط وصحة البيانات"
            icon={Activity}
            hint="ما ليس موصولاً يظهر كذلك، ولا يُملأ بأصفار ولا ببيانات وهمية."
            action={<span className="text-xs font-bold text-ink-soft"><T s="نسبة الاكتمال {0}٪" a={[<span key="0" className="nums">{Math.round(health.confidence * 100)}</span>]} /></span>}
          >
            {otherMetrics.length > 0 && (
            <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
              {otherMetrics.map((m) => {
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
            )}
            {/* المكتملُ سطرٌ واحد يُفتح — القسمُ لما ينقص، لا ثمانيةُ أشرطةٍ ممتلئة */}
            {goodMetrics.length > 0 && (
              <details className="group/good mt-3 rounded-xl border border-line bg-raised shadow-raised">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
                  <span className="rounded-full bg-ok-bg px-2 py-0.5 text-[11px] font-bold text-ok">مكتمل</span>
                  <span className="min-w-0 flex-1 text-[13px] text-ink-soft">{goodMetrics.map((m) => m.label).join("، ")}</span>
                  <span className="text-[11px] text-muted group-open/good:hidden">اعرض</span>
                </summary>
                <ul className="divide-y divide-line-soft border-t border-line-soft">
                  {goodMetrics.map((m) => (
                    <li key={m.id} className="px-4 py-2.5">
                      <span className="block text-[13px] font-bold">{m.label}</span>
                      <span className="block text-[11px] leading-relaxed text-muted">{m.detail}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
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

          {backup !== null && (
            <Section
              id="backup"
              title="النسخة الاحتياطية"
              icon={HardDrive}
              hint="تُنسخ بيانات النظام كلها كل يوم على حاسوبك في مجلد TPH-Backups، ومعها نسخة من ملفات الدرايف، ونسخة ثانية من البيانات خارج الحاسوب في iCloud. يُعاد ما تعذّر كل ساعة ما دام الحاسوب يعمل."
            >
              {backup.state === "UNKNOWN" ? (
                <Callout tone="warn" title="حالها غير معروف">
                  لم تُبلغ النسخة عن نفسها بعد. تُبلغ بعد أول تشغيل على حاسوبك، وهو كل ساعة ما دام الحاسوب يعمل.
                </Callout>
              ) : (
                <div className="space-y-3">
                  <dl className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-xl border border-line bg-raised p-4">
                      <dt className="text-[11px] text-muted">القاعدة والشيفرة والأسرار</dt>
                      <dd className={`mt-1 text-sm font-bold ${backup.state === "CORE_STALE" ? "text-danger" : "text-ok"}`}>
                        {backup.hb.lastCoreSuccess ? <T s="آخر نسخة {0}" a={[formatMoment(new Date(backup.hb.lastCoreSuccess))]} /> : "لم تكتمل بعد"}
                      </dd>
                    </div>
                    <div className="rounded-xl border border-line bg-raised p-4">
                      <dt className="text-[11px] text-muted">نسخة ملفات الدرايف</dt>
                      <dd className={`mt-1 text-sm font-bold ${backup.hb.driveOk ? "text-ok" : "text-warn"}`}>
                        {backup.hb.lastFullSuccess ? <T s="آخر نسخة كاملة {0}" a={[formatMoment(new Date(backup.hb.lastFullSuccess))]} /> : "لم تكتمل بعد"}
                      </dd>
                    </div>
                    <div className="rounded-xl border border-line bg-raised p-4">
                      <dt className="text-[11px] text-muted">نسخة ثانية خارج الحاسوب (iCloud)</dt>
                      <dd className={`mt-1 text-sm font-bold ${backup.hb.offDisk.lastSuccess ? "text-ok" : "text-warn"}`}>
                        {!backup.hb.offDisk.configured ? "غير مضبوطة: إن تعطّل الحاسوب ضاعت النسخ كلها"
                          : backup.hb.offDisk.lastSuccess ? <T s="آخر نسخة {0}" a={[formatMoment(new Date(backup.hb.offDisk.lastSuccess))]} /> : "لم تُنسخ بعد"}
                      </dd>
                    </div>
                    <div className="rounded-xl border border-line bg-raised p-4">
                      <dt className="text-[11px] text-muted">آخر تشغيل</dt>
                      <dd className="mt-1 text-sm font-bold">{formatMoment(new Date(backup.hb.at))}</dd>
                    </div>
                  </dl>
                  {backup.hb.failed.length > 0 && (
                    <Callout tone={backup.state === "CORE_STALE" ? "danger" : "warn"} title="ما تعذّر في آخر تشغيل">
                      <ul className="space-y-1">
                        {backup.hb.failed.map((x) => (
                          <li key={x.part}><strong>{x.part}</strong>: <span dir="auto" className="break-words">{x.detail}</span></li>
                        ))}
                      </ul>
                    </Callout>
                  )}
                </div>
              )}
            </Section>
          )}

          {serverErrorRows !== null && (
            <Section
              id="errors"
              title="أعطال النظام"
              icon={ShieldAlert}
              count={serverErrorRows.length}
              hint="ما تعطّل في النظام في آخر سبعة أيام. العطل نفسه يُعدّ ولا يتكرر سطره. أرسل المرجع لمن يطوّر النظام."
            >
              {serverErrorRows.length === 0 ? (
                <p className="text-sm text-ink-soft">لا عطل في آخر سبعة أيام.</p>
              ) : (
                <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised">
                  {serverErrorRows.slice(0, 5).map((r) => (
                    <li key={r.fingerprint} className="px-4 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <bdi dir="ltr" className="min-w-0 break-all text-[13px] font-bold">{r.method ? `${r.method} ` : ""}{r.route ?? "—"}</bdi>
                        <span className="shrink-0 text-[11px] text-muted">
                          <T s="{0} مرة · آخرها {1}" a={[<span key="0" className="nums">{r.occurrences}</span>, formatMoment(r.lastSeen)]} />
                        </span>
                      </div>
                      <p dir="auto" className="mt-1 break-words text-xs text-ink-soft">{r.message}</p>
                      {r.lastRef && <p className="mt-1 text-[11px] text-muted"><T s="المرجع {0}" a={[<bdi key="0" dir="ltr" className="nums">{r.lastRef}</bdi>]} /></p>}
                    </li>
                  ))}
                </ul>
              )}
              {/* عشرون عطلاً متتابعة تُغرق آخر الصفحة — الخمسةُ الأحدث ظاهرة والباقي يُفتح */}
              {serverErrorRows.length > 5 && (
                <details className="mt-2 rounded-xl border border-line bg-raised">
                  <summary className="flex min-h-11 cursor-pointer items-center px-4 text-[13px] font-bold">اعرض الأعطال الباقية ({serverErrorRows.length - 5})</summary>
                  <ul className="divide-y divide-line-soft border-t border-line-soft">
                    {serverErrorRows.slice(5).map((r) => (
                      <li key={r.fingerprint} className="px-4 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <bdi dir="ltr" className="min-w-0 break-all text-[13px] font-bold">{r.method ? `${r.method} ` : ""}{r.route ?? "—"}</bdi>
                        <span className="shrink-0 text-[11px] text-muted">
                          <T s="{0} مرة · آخرها {1}" a={[<span key="0" className="nums">{r.occurrences}</span>, formatMoment(r.lastSeen)]} />
                        </span>
                      </div>
                      <p dir="auto" className="mt-1 break-words text-xs text-ink-soft">{r.message}</p>
                      {r.lastRef && <p className="mt-1 text-[11px] text-muted"><T s="المرجع {0}" a={[<bdi key="0" dir="ltr" className="nums">{r.lastRef}</bdi>]} /></p>}
                    </li>
                    ))}
                  </ul>
                </details>
              )}
            </Section>
          )}
        </div>
      </div>
    </PageShell>
  );
}

/** عنوانُ مجموعة عمل — اسمُها وما فيها، فوق أقسامها. */
function JobGroup({ group, first = false }: { group: { id: string; title: string; hint: string } | undefined; first?: boolean }) {
  if (!group) return null;
  return (
    <div id={group.id} className={`${first ? "" : "mt-16"} mb-6 scroll-mt-24 border-b border-line pb-3`}>
      <p className="text-lg font-bold tracking-tight">{group.title}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">{group.hint}</p>
    </div>
  );
}

const TILE_TONE = { ok: "text-ok", warn: "text-warn", danger: "text-danger" } as const;

/** بطاقةُ حال: كلمةٌ ملوّنة ومعناها، وتنزل إلى قسمها. */
function StatusTile({ href, label, value, sub, tone }: { href: string; label: string; value: React.ReactNode; sub: React.ReactNode; tone: keyof typeof TILE_TONE }) {
  return (
    <a href={href} className="block min-h-11 rounded-xl border border-line bg-raised px-4 py-3.5 shadow-raised transition-colors hover:border-accent-line">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1.5 text-xl font-bold leading-tight ${TILE_TONE[tone]}`}>{value}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">{sub}</p>
    </a>
  );
}
