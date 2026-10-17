import { redirect } from "next/navigation";
import { Archive, CalendarClock, FileBadge, RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { ObligationForm } from "@/components/obligation-form";
import { PostAction } from "@/components/post-action";
import { SignalControls } from "@/components/signal-controls";
import { Badge, DataTable, EmptyState, KeyFigure, NoAccess, Section, type Tone } from "@/components/ui";
import { formatDay, formatHijri, todayInRiyadh } from "@/lib/riyadh-time";
import {
  EXPIRY_LEVEL_LABEL, OBLIGATION_KIND_LABEL, daysLeft, describeDaysLeft, expiryLevel, obligationKey,
  type ExpiryLevel, type Obligation,
} from "@/lib/obligations";
import { loadObligations } from "@/services/obligation.service";

export const dynamic = "force-dynamic";

const LEVEL_TONE: Record<ExpiryLevel, Tone> = { EXPIRED: "danger", URGENT: "danger", SOON: "warn", OK: "ok" };

/**
 * الوثائق والتراخيص — ما له تاريخُ انتهاءٍ يُغرَّم على فواته.
 *
 * يكتبها صاحبُ المقهى بيده، ويذكّر بها النظامُ في «يحتاج قرارك» قبل موعدها
 * بمهلتها. ولا يُقال «لا شيء ينتهي» قبل أن تُدخَل وثيقةٌ واحدة.
 */
export default async function ObligationsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/settings/obligations");
  if (!can(user.role, "reports:view")) {
    return (
      <PageShell user={user} width="wide" title="الوثائق والتراخيص">
        <NoAccess what="الوثائق والتراخيص" />
      </PageShell>
    );
  }

  const view = await loadObligations();
  const canEdit = can(user.role, "expense:edit");
  const canSnooze = can(user.role, "bank:edit");
  const today = todayInRiyadh();
  const rows = view.open.map((o) => ({ ...o, left: daysLeft(o.expiresOn, today), level: expiryLevel(o, today), snoozed: view.silenced.has(obligationKey(o)) }));
  const expired = rows.filter((r) => r.level === "EXPIRED");
  const due = rows.filter((r) => r.level === "URGENT" || r.level === "SOON");
  const next = rows.find((r) => r.level !== "EXPIRED") ?? null;

  if (view.open.length === 0 && view.archived.length === 0) {
    return (
      <PageShell user={user} width="wide" title="الوثائق والتراخيص" intro="وثائق لها تاريخ انتهاء: السجل التجاري، رخصة البلدية، الدفاع المدني، الشهادات الصحية، الإقامات، عقد الإيجار.">
        <EmptyState
          icon={FileBadge}
          title="لم تُضف أي وثيقة بعد."
          hint="أضف وثائق المقهى مع تاريخ انتهاء كل منها (نحو عشر وثائق)، وسيذكّرك النظام قبل انتهائها في «يحتاج قرارك». وإلى أن تضيفها لا نستطيع القول إن «لا شيء ينتهي»، لأن النظام لا يعرف شيئاً عنها."
          action={canEdit ? <ObligationForm /> : undefined}
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      user={user}
      width="wide"
      title="الوثائق والتراخيص"
      intro="التأخر في تجديد هذه الوثائق قد يعرّضك لغرامات، وسيذكّرك النظام قبل انتهاء كل منها في «يحتاج قرارك»."
      actions={canEdit ? <ObligationForm /> : undefined}
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        <KeyFigure
          icon={TriangleAlert}
          tone={expired.length > 0 ? "danger" : "ok"}
          label="انتهت"
          value={<span className="nums nums-count">{expired.length}</span>}
          sub={expired.length > 0 ? expired.slice(0, 3).map((r) => r.title).join("، ") : "لا توجد وثيقة منتهية بين ما أضفته."}
        />
        <KeyFigure
          icon={CalendarClock}
          tone={due.length > 0 ? "warn" : undefined}
          label="داخل مهلة التذكير"
          value={<span className="nums nums-count">{due.length}</span>}
          sub={due.length > 0 ? due.slice(0, 3).map((r) => r.title).join("، ") : "لا توجد وثيقة يقترب موعد انتهائها."}
        />
        <KeyFigure
          icon={ShieldCheck}
          label="أقرب موعد"
          value={next ? <bdi className="text-xl">{formatDay(next.expiresOn)}</bdi> : <span className="text-xl text-muted">—</span>}
          sub={next ? `${next.title} — ${describeDaysLeft(next.left)}` : "جميع الوثائق التي أضفتها منتهية."}
        />
      </div>

      <Section title="الوثائق" icon={FileBadge} count={rows.length} hint="الأقرب انتهاءً أولاً. للتجديد عدّل تاريخ الانتهاء، وأرشف ما لم تعد بحاجة إليه (الأرشفة لا تحذفه).">
        <DataTable<(typeof rows)[number]>
          rows={rows}
          keyOf={(r) => r.id}
          searchOf={(r) => `${r.title} ${OBLIGATION_KIND_LABEL[r.kind]} ${r.holder ?? ""} ${r.issuer ?? ""} ${r.reference ?? ""}`}
          columns={[
            {
              key: "title",
              header: "الوثيقة",
              primary: true,
              cell: (r) => (
                <span className="min-w-0">
                  <span className="block truncate font-bold">{r.title}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {OBLIGATION_KIND_LABEL[r.kind]}
                    {r.holder && <> · {r.holder}</>}
                    {r.issuer && <> · {r.issuer}</>}
                    {r.reference && <> · <bdi>{r.reference}</bdi></>}
                  </span>
                </span>
              ),
            },
            {
              key: "expires",
              header: "تنتهي",
              cell: (r) => (
                <span>
                  <bdi className="font-bold">{formatDay(r.expiresOn)}</bdi>
                  {formatHijri(r.expiresOn) && <span className="block text-[11px] text-muted">{formatHijri(r.expiresOn)}</span>}
                </span>
              ),
            },
            {
              key: "state",
              header: "الحال",
              cell: (r) => (
                <span className="flex flex-col items-start gap-1">
                  <Badge tone={LEVEL_TONE[r.level]} dot>{EXPIRY_LEVEL_LABEL[r.level]}</Badge>
                  <span className="text-[11px] text-muted">{describeDaysLeft(r.left)} · التذكير قبل {r.remindDays} يوماً{r.snoozed && " · أجّلتَ التذكير"}</span>
                </span>
              ),
            },
            ...(canEdit || canSnooze
              ? [{
                  key: "act",
                  header: "",
                  align: "end" as const,
                  wrap: true,
                  cell: (r: (typeof rows)[number]) => (
                    <span className="relative flex flex-wrap items-center justify-end gap-1">
                      {canEdit && <ObligationForm existing={strip(r)} />}
                      {canSnooze && (r.level === "URGENT" || r.level === "SOON") && (
                        r.snoozed
                          ? <SignalControls signalKey={obligationKey(r)} silenced />
                          : <SignalControls signalKey={obligationKey(r)} dismissLabel="لا تذكّرني" />
                      )}
                      {canEdit && (
                        <PostAction url="/api/obligation" body={{ action: "close", id: r.id }} undo={{ body: { action: "reopen", id: r.id } }} variant="quiet">
                          <Archive className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                          أرشف
                        </PostAction>
                      )}
                    </span>
                  ),
                }]
              : []),
          ]}
        />
      </Section>

      {view.archived.length > 0 && (
        <Section title="المؤرشف" icon={Archive} count={view.archived.length} hint="لا يذكّرك النظام بها. يمكنك إعادتها إن أرشفتها بالخطأ.">
          <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
            {view.archived.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                <span className="min-w-0 truncate">
                  <span className="font-bold">{o.title}</span>
                  <span className="ms-2 text-[11px] text-muted">{OBLIGATION_KIND_LABEL[o.kind]} · كان تاريخ انتهائها <bdi>{formatDay(o.expiresOn)}</bdi></span>
                </span>
                {canEdit && (
                  <PostAction url="/api/obligation" body={{ action: "reopen", id: o.id }} variant="quiet">
                    <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                    أعدها
                  </PostAction>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </PageShell>
  );
}

/** ما يحتاجه نموذجُ التعديل وحده — لا يُرسَل إلى المتصفّح ما حُسب للعرض. */
function strip(o: Obligation): Obligation {
  return {
    id: o.id, kind: o.kind, title: o.title, issuer: o.issuer, reference: o.reference, holder: o.holder,
    expiresOn: o.expiresOn, remindDays: o.remindDays, note: o.note,
  };
}
