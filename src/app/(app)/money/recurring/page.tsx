import { redirect } from "next/navigation";
import { CalendarClock, CircleCheck, Copy, Landmark, Plus, Repeat, TrendingUp, Upload } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { PostAction } from "@/components/post-action";
import { SignalControls } from "@/components/signal-controls";
import { Badge, DataTable, EmptyState, KeyFigure, LinkButton, NoAccess, Section } from "@/components/ui";
import { MONTH, countNoun } from "@/lib/arabic";
import { CATEGORY_LABEL } from "@/lib/bank/rules";
import { formatRiyals } from "@/lib/money";
import { formatDay, formatMonth } from "@/lib/riyadh-time";
import { SERIES_MIN_MONTHS, nextDueOn, suggestionKey } from "@/lib/recurring-detect";
import { loadRecurringWatch, type SeriesView } from "@/services/recurring-watch.service";
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

  const notes = w.series.flatMap((s) => s.openNotes.map((n) => ({ series: s, ...n })));
  const unregistered = w.series.filter((s) => !s.registered && !s.suggestionSilenced);

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
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
            <KeyFigure
              icon={Repeat}
              label="خصومات شهرية في الكشف"
              value={<span className="nums nums-count">{w.series.length}</span>}
              sub="جهات يُخصم لها مبلغ متقارب كل شهر، تجدها في الجدول أدناه."
            />
            <KeyFigure
              icon={CalendarClock}
              label="مجموعها في السنة"
              value={<Money minor={w.annualMinor} />}
              sub="المبلغ المعتاد لكل جهة × 12. هذا تقدير، لا مبلغ فعلي."
            />
            <KeyFigure
              icon={Plus}
              tone={unregistered.length > 0 ? "warn" : "ok"}
              label="لم تُسجَّل مصروفاً متكرراً"
              value={<span className="nums nums-count">{unregistered.length}</span>}
              sub={unregistered.length > 0 ? "لن تظهر في «النقد القادم» حتى تسجّلها. أضفها من الجدول." : "كل ما في الكشف مسجّل، أو تجاهلت اقتراحه."}
              href={unregistered.length > 0 ? "#series" : "/cash"}
            />
          </div>

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
                        <span className="min-w-0 truncate">{s.label}</span>
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
            hint="«المعتاد» وسيط الخصومات السابقة، و«اليوم» وسيط أيامها. وحين تسجّله مصروفاً متكرراً يظهر في «النقد القادم» في ذلك اليوم، ويمكنك تعديل مبلغه ودورته من الإعدادات."
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
                      <span className="block truncate font-bold">{s.label}</span>
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
