import { redirect } from "next/navigation";
import { CalendarCheck, CircleCheck, Copy, Landmark, Plus, Repeat, Search, TrendingUp, Upload, Wallet } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { PostAction } from "@/components/post-action";
import { SignalControls } from "@/components/signal-controls";
import { Badge, DataTable, EmptyState, LinkButton, NoAccess, Section, type Tone } from "@/components/ui";
import { ITEM, MONTH, countNoun } from "@/lib/arabic";
import { CATEGORY_LABEL, isTxCategory } from "@/lib/bank/rules";
import { formatRiyals, formatRiyalsDisplay } from "@/lib/money";
import { formatDay, formatMonth } from "@/lib/riyadh-time";
import { SERIES_MIN_MONTHS, nextDueOn, suggestionKey } from "@/lib/recurring-detect";
import { loadMonthWatch, loadRecurringWatch, type SeriesView } from "@/services/recurring-watch.service";
import { seesSalaries } from "@/lib/payroll/visibility";
import type { MonthRow, MonthStatus, MonthWatch } from "@/lib/recurring-month";
import { T } from "@/components/i18n/t";

export const dynamic = "force-dynamic";

/**
 * الاشتراكات والمتكرّر — ما يخصمه البنكُ كلَّ شهرٍ لجهةٍ واحدة بمبلغٍ متقارب.
 *
 * يُكشف من الكشف نفسه (`recurring-detect.ts`) ويُقترَح تسجيلُه متكرّراً بضغطة،
 * فيدخل «النقد القادم» بيومه بلا إدخالٍ يدويّ. ومعه ما خرج عن عادته: خُصم
 * مرّتين، أو ارتفع، أو غاب. اقتراحٌ وتحذير — لا يُكتب شيءٌ من نفسه.
 */
export default async function RecurringPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/money/recurring");
  if (!can(user.role, "bank:view")) {
    return (
      <PageShell user={user} width="wide" title="الخصومات المتكررة">
        <NoAccess what="الخصومات المتكررة" />
      </PageShell>
    );
  }

  const w = await loadRecurringWatch();
  const canEdit = can(user.role, "expense:edit");
  const canSilence = can(user.role, "bank:edit");

  if (w.lastBankDay === null) {
    return (
      <PageShell user={user} width="wide" title="الخصومات المتكررة" intro="المبالغ التي تُخصم من حسابك كل شهر.">
        <EmptyState
          icon={Landmark}
          title="لم يُستورد كشف بنك بعد."
          hint="يكتشف النظام المبالغ المتكررة من الكشف نفسه: جهة واحدة ومبلغ متقارب كل شهر. استورد كشف الحساب أولاً."
          action={canSilence ? <LinkButton href="/bank#import" variant="primary" icon={Upload}>استورد كشف البنك</LinkButton> : undefined}
        />
      </PageShell>
    );
  }

  const m = await loadMonthWatch(w, { hideSalaries: !seesSalaries(user.role) });
  /* غيابُ هذا الشهر صفٌّ في «هذا الشهر» بفعله — فلا يُكرَّر تنبيهاً تحته */
  const notes = w.series.flatMap((s) => s.openNotes.filter((n) => !(n.note.kind === "MISSING" && n.note.month === m.month)).map((n) => ({ series: s, ...n })));
  const missingKey = new Map(w.series.flatMap((s) => s.openNotes.filter((n) => n.note.kind === "MISSING" && n.note.month === m.month).map((n) => [s.key, n.key] as const)));

  return (
    <PageShell
      user={user}
      width="wide"
      title="الخصومات المتكررة"
      eyebrow={<><T s="من كشف البنك حتى {0}" a={[<bdi key="0">{formatDay(w.lastBankDay)}</bdi>]} /></>}
      intro="المبالغ التي يخصمها البنك كل شهر لجهة واحدة بمبلغ متقارب، كالإيجار والإنترنت واشتراكات البرامج والرواتب، وما خرج منها عن المعتاد."
      actions={<LinkButton href="/settings#recurring" icon={Repeat} variant="secondary">المتكرر المسجّل</LinkButton>}
    >
      {w.series.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title="لا يوجد في الكشف بعد خصم شهري متكرر."
          hint={`يُعدّ الخصم متكرراً حين يُخصم مبلغ متقارب لجهة واحدة في ${SERIES_MIN_MONTHS} أشهر على الأقل. إن كان الكشف أقصر من ذلك فاستورد الأشهر السابقة، وما تعرفه سلفاً (كالإيجار والرواتب) أضِفه بنفسك.`}
          action={canEdit ? <LinkButton href="/settings#recurring" variant="primary" icon={Plus}>أضف مصروفاً متكرراً</LinkButton> : undefined}
        />
      ) : (
        <>
          <MonthPanel m={m} canEdit={canEdit} canSilence={canSilence} missingKey={missingKey} />

          {/* ── ما خرج عن عادته ── */}
          {notes.length > 0 && (
            <Section title="خرج عن المعتاد" icon={TrendingUp} count={notes.length} hint="هذه تنبيهات لا أحكام. أنت أعلم إن كانت الزيادة متفقاً عليها أو الخصم الثاني مقصوداً، فتجاهل التنبيه واذكر السبب، أو راجع الجهة.">
              <ul className="space-y-2">
                {notes.map(({ series: s, key, note }) => (
                  <li key={key} className="flex flex-wrap items-center gap-3 rounded-xl border border-warn/30 bg-warn-bg px-4 py-3">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                        {note.kind === "TWICE" && <Copy className="h-4 w-4 text-warn" strokeWidth={2} aria-hidden />}
                        {note.kind === "ROSE" && <TrendingUp className="h-4 w-4 text-warn" strokeWidth={2} aria-hidden />}
                        <span className="min-w-0 break-words">{s.label}</span>
                        <Badge tone="warn">{note.kind === "TWICE" ? "خصم مرتين" : note.kind === "ROSE" ? "ارتفع" : "لم يُخصم"}</Badge>
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
                        {note.kind === "TWICE" && (
                          <>
                            <T s="خُصم في {0} أكثر من مرة والمعتاد مرة واحدة، والزائد {1} ({2})." a={[formatMonth(note.month), <Money key="1" minor={note.excessMinor} />, note.extra.map((x) => formatDay(x.day)).join("، ")]} /></>
                        )}
                        {note.kind === "ROSE" && (
                          <>
                            <T s="خُصم في {0} مبلغ {1} والمعتاد {2}، بزيادة {3} في الشهر، أي {4} في السنة إن استمرت." a={[<bdi key="0">{formatDay(note.day)}</bdi>, <Money key="1" minor={note.toMinor} />, <Money key="2" minor={note.fromMinor} />, <Money key="3" minor={note.diffMinor} />, <Money key="4" minor={note.diffMinor * 12} />]} /></>
                        )}
                        {note.kind === "MISSING" && (
                          <>
                            <T s="لم يُخصم في {0} مع أنه يُخصم كل شهر (المعتاد {1}). إن ألغيته فتجاهل التنبيه، وإن كان إيجاراً أو اشتراكاً قائماً فقد تأخر سداده." a={[formatMonth(note.month), <Money key="1" minor={s.usualMinor} />]} /></>
                        )}
                      </p>
                    </div>
                    <div className="flex max-w-full shrink-0 flex-wrap items-center gap-1">
                      <LinkButton href={`/bank?show=all&q=${encodeURIComponent(s.label.slice(0, 30))}#transactions`} variant="secondary" size="sm">حركاتها</LinkButton>
                      {canSilence && <SignalControls signalKey={key} snoozeDays={30} />}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* ── السلاسل ── */}
          <Section
            id="series"
            title="ما يتكرر كل شهر"
            icon={Repeat}
            count={w.series.length}
            hint={`«المعتاد» وسيط الخصومات السابقة، و«اليوم» وسيط أيامها، ومجموعها في السنة نحو ${formatRiyalsDisplay(w.annualMinor)} ريال (تقدير: المعتاد × 12). وحين تسجّله مصروفاً متكرراً يظهر في «النقد القادم» في ذلك اليوم.`}
          >
            <DataTable<SeriesView>
              rows={w.series}
              keyOf={(s) => s.key}
              searchOf={(s) => `${s.label} ${CATEGORY_LABEL[s.category]}`}
              columns={[
                {
                  key: "label",
                  header: "الجهة",
                  primary: true,
                  cell: (s) => (
                    <span className="min-w-0">
                      <span className="block break-words font-bold">{s.label}</span>
                      <span className="block text-[11px] text-muted">{CATEGORY_LABEL[s.category]} · {countNoun(s.months, MONTH)}</span>
                    </span>
                  ),
                },
                { key: "usual", header: "المعتاد", numeric: true, cell: (s) => <Money minor={s.usualMinor} /> },
                { key: "day", header: "اليوم", numeric: true, secondary: true, cell: (s) => <span className="nums nums-count">{s.dayOfMonth}</span> },
                {
                  key: "last",
                  header: "آخر خصم",
                  numeric: true,
                  secondary: true,
                  cell: (s) => (
                    <span>
                      <Money minor={s.lastMinor} />
                      <span className="ms-2 text-[11px] text-muted"><bdi>{formatDay(s.lastDay)}</bdi></span>
                    </span>
                  ),
                },
                { key: "annual", header: "في السنة", numeric: true, secondary: true, cell: (s) => <Money minor={s.annualMinor} /> },
                {
                  key: "act",
                  header: "",
                  align: "end",
                  wrap: true,
                  cell: (s) =>
                    s.registered ? (
                      <Badge tone="ok"><T s="{0}مسجّل: {1}" a={[<CircleCheck key="0" className="h-3 w-3" strokeWidth={2} aria-hidden />, s.registered.label]} /></Badge>
                    ) : s.suggestionSilenced ? (
                      <span className="flex flex-wrap items-center justify-end gap-1">
                        <Badge>تجاهلتَ الاقتراح</Badge>
                        {canSilence && <SignalControls signalKey={suggestionKey(s)} silenced />}
                      </span>
                    ) : canEdit ? (
                      <span className="relative flex flex-wrap items-center justify-end gap-1">
                        <PostAction
                          url="/api/expense"
                          body={{
                            action: "create",
                            label: s.label.slice(0, 80),
                            category: s.category,
                            amount: formatRiyals(s.usualMinor),
                            cadence: "MONTHLY",
                            startsOn: nextDueOn(s),
                          }}
                          variant="primary"
                        >
                          <T s="{0}أضفه مصروفاً متكرراً" a={[<Plus key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></PostAction>
                        {canSilence && <SignalControls signalKey={suggestionKey(s)} dismissLabel="ليس متكرراً" snoozeDays={30} />}
                      </span>
                    ) : (
                      <Badge tone="warn">غير مسجّل</Badge>
                    ),
                },
              ]}
            />
          </Section>
        </>
      )}
    </PageShell>
  );
}

const STATUS: Record<MonthStatus, { label: string; tone: Tone }> = {
  LATE: { label: "لم يُخصم", tone: "danger" },
  NOT_SEEN: { label: "الكشف لم يصل لموعده", tone: "warn" },
  UPCOMING: { label: "قادم", tone: "muted" },
  ARRIVED: { label: "وصل", tone: "ok" },
};

/**
 * «هذا الشهر» — ما كان متوقَّعاً وما وصل، والغائبُ أوّلاً وبجانبه فعلُه.
 * الحكمُ بآخر يومٍ في الكشف: ما موعدُه بعده لا يُقال إنّه تأخّر.
 */
function MonthPanel({ m, canEdit, canSilence, missingKey }: {
  m: MonthWatch; canEdit: boolean; canSilence: boolean; missingKey: ReadonlyMap<string, string>;
}) {
  const lateMinor = m.late.reduce((s, r) => s + r.expectedMinor, 0);
  const arrivedCount = m.rows.filter((r) => r.status === "ARRIVED").length;
  if (m.rows.length === 0) {
    return (
      <EmptyState
        compact
        icon={CalendarCheck}
        title={`لا يُتوقع خصم متكرر في ${formatMonth(m.month)}.`}
        hint="لا مصروف متكرر مسجّل يقع في هذا الشهر، ولا خصم شهري في الكشف. سجّل الإيجار والاشتراكات ليظهر هنا ما وصل منها وما غاب."
        action={canEdit ? <LinkButton href="/settings#recurring" variant="primary" icon={Plus}>أضف مصروفاً متكرراً</LinkButton> : undefined}
      />
    );
  }
  return (
    <section aria-labelledby="month-title" className="overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
      <header className="flex flex-wrap items-start gap-x-6 gap-y-3 border-b border-line-soft p-4 sm:p-5">
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-xs font-bold text-muted">{formatMonth(m.month)}: ما كان متوقعاً، وما وصل</p>
          <h2 id="month-title" className={`mt-1 text-xl font-bold leading-snug sm:text-2xl ${m.late.length > 0 ? "text-danger" : ""}`}>
            {m.late.length > 0
              ? <T s="{0} لم يُخصم في موعده" a={[countNoun(m.late.length, ITEM)]} />
              : arrivedCount === m.rows.length ? "وصل كل المتوقع" : <T s="وصل {0} من {1}، والباقي لم يحن" a={[<span key="0" className="nums nums-count">{arrivedCount}</span>, <span key="1" className="nums nums-count">{m.rows.length}</span>]} />}
          </h2>
          <p className="mt-1 text-xs text-muted">
            {m.lastBankDay ? <T s="الحكم بكشف البنك حتى {0}، وما موعده بعده لا يُعدّ متأخراً." a={[<bdi key="0">{formatDay(m.lastBankDay)}</bdi>]} /> : "لا كشف بنك بعد."}
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-4 text-xs sm:gap-6">
          <div><dt className="text-muted">المتوقع</dt><dd className="mt-0.5 text-[15px] font-bold"><Money minor={m.expectedMinor} /></dd></div>
          <div><dt className="text-muted">وصل</dt><dd className="mt-0.5 text-[15px] font-bold text-ok"><Money minor={m.arrivedMinor} /></dd></div>
          <div><dt className="text-muted">غاب</dt><dd className={`mt-0.5 text-[15px] font-bold ${lateMinor > 0 ? "text-danger" : ""}`}><Money minor={lateMinor} /></dd></div>
        </dl>
      </header>
      <ul className="divide-y divide-line-soft">
        {m.rows.map((r) => <MonthLine key={r.key} r={r} canEdit={canEdit} canSilence={canSilence} silenceKey={r.seriesKey ? missingKey.get(r.seriesKey) : undefined} />)}
      </ul>
    </section>
  );
}

function MonthLine({ r, canEdit, canSilence, silenceKey }: { r: MonthRow; canEdit: boolean; canSilence: boolean; silenceKey?: string }) {
  const st = STATUS[r.status];
  const diff = r.arrived ? r.arrived.amountMinor - r.expectedMinor : 0;
  const search = `/bank?show=all&q=${encodeURIComponent(r.label.slice(0, 30))}#transactions`;
  return (
    <li className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5 ${r.status === "LATE" ? "bg-danger-bg/50" : ""}`}>
      <div className="min-w-0 flex-1 basis-60">
        <p className="flex flex-wrap items-center gap-2 text-[13px] font-bold">
          <span className="min-w-0 break-words" dir="auto">{r.label}</span>
          <Badge tone={st.tone} dot>{st.label}</Badge>
          {!r.registeredId && <a href="#series" className="inline-flex min-h-11 items-center sm:min-h-0"><Badge tone="info">من الكشف، غير مسجّل</Badge></a>}
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
          {r.category && isTxCategory(r.category) ? `${CATEGORY_LABEL[r.category]} · ` : ""}
          {r.dueDay ? <T s="موعده {0}" a={[<bdi key="0">{formatDay(r.dueDay)}</bdi>]} /> : "يومه غير محدد"}
          {r.arrived && <> · <T s="وصل {0} {1}" a={[r.arrived.day ? <bdi key="0">{formatDay(r.arrived.day)}</bdi> : "", r.arrived.via === "EXPENSE" ? "(مصروف مسجّل)" : "(من الكشف)"]} /></>}
          {diff !== 0 && <span className={diff > 0 ? "font-bold text-warn" : ""}> · <T s="{0} بـ{1}" a={[diff > 0 ? "أعلى من المعتاد" : "أقل من المعتاد", <Money key="1" minor={Math.abs(diff)} />]} /></span>}
        </p>
      </div>
      <span className="shrink-0 text-[13px] font-bold"><Money minor={r.arrived?.amountMinor ?? r.expectedMinor} /></span>
      {r.status !== "ARRIVED" && r.status !== "UPCOMING" && (
        <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto">
          {r.status === "NOT_SEEN"
            ? <LinkButton href="/bank#import" size="sm" variant="secondary" icon={Upload}>استورد الكشف الأحدث</LinkButton>
            : <LinkButton href={search} size="sm" variant="secondary" icon={Search}>ابحث في البنك</LinkButton>}
          {canEdit && r.status === "LATE" && <LinkButton href="/money/expenses?add=1" size="sm" variant="quiet" icon={Wallet}>دفعته نقداً؟ سجّله</LinkButton>}
          {canSilence && silenceKey && <SignalControls signalKey={silenceKey} dismissLabel="أُلغي" snoozeDays={30} />}
        </div>
      )}
    </li>
  );
}
