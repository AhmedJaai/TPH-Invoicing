import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleCheck, CircleSlash, ListChecks, Lock, Undo2 } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { PostAction } from "@/components/post-action";
import { Badge, Callout, EmptyState, LinkButton, NoAccess, Section } from "@/components/ui";
import { ITEM, countNoun } from "@/lib/arabic";
import {
  CHOICE_GROUP_HINT, CHOICE_GROUP_LABEL, CHOICE_STATE_LABEL, type ChoiceRow, type ChoiceState,
} from "@/lib/choices";
import { formatDay } from "@/lib/riyadh-time";
import { loadChoiceLedger } from "@/services/choices.service";
import type { Role } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const STATE_UI: Record<ChoiceState, { tone: "ok" | "warn" | "muted"; icon: typeof CircleCheck }> = {
  APPLIED: { tone: "ok", icon: CircleCheck },
  NOT_APPLIED: { tone: "warn", icon: CircleSlash },
  LOCKED: { tone: "muted", icon: Lock },
};

function Row({ row: r, role }: { row: ChoiceRow; role: Role }) {
  const ui = STATE_UI[r.state];
  return (
    <li className="px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-56">
          <p className="break-words text-[13px] font-bold leading-snug [overflow-wrap:anywhere]" dir="auto">
            {r.href ? <Link href={r.href} className="hover:underline">{r.subject}</Link> : r.subject}
          </p>
          <p className="mt-0.5 break-words text-xs leading-relaxed text-ink-soft [overflow-wrap:anywhere]" dir="auto">{r.choice}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
            <Badge tone={ui.tone} dot>{CHOICE_STATE_LABEL[r.state]}</Badge>
            <span>{r.decidedOn ? formatDay(r.decidedOn) : "تاريخُه غير محفوظ"}</span>
          </p>
        </div>
        <div className="shrink-0 text-end">
          {r.effectMinor !== null ? (
            <>
              <span className="block text-[11px] text-muted">{r.effectLabel}</span>
              <span className="block text-sm font-bold"><Money minor={r.effectMinor} signed /></span>
            </>
          ) : (
            <span className="block text-[11px] text-muted">لا أثرَ يُحسب بالريال</span>
          )}
        </div>
      </div>
      {r.reason && (
        <p className={`mt-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${r.state === "NOT_APPLIED" ? "border-warn/25 bg-warn-bg text-ink" : "border-line-soft bg-sunken/60 text-ink-soft"}`} dir="auto">
          {r.reason}
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {r.revoke && can(role, r.revoke.needs) && (
          <PostAction url={r.revoke.url} body={r.revoke.body} variant="secondary" done="سُحب الاختيار">
            <Undo2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            {r.revoke.label}
          </PostAction>
        )}
        {!r.revoke && r.href && (
          <LinkButton href={r.href} size="sm" variant="quiet">
            {r.state === "LOCKED" ? "افتح الإقرار" : "غيّره في موضعه"}
          </LinkButton>
        )}
      </div>
    </li>
  );
}

/**
 * «ما قرّرتَه» — دفترُ اختيارات صاحب المقهى (`lib/choices.ts`).
 *
 * كلُّ ما كتبه أو اختاره بيده في موضعٍ واحد، بحاله اليوم وأثره بالريال، ومعه زرُّ
 * سحبه. وما اختاره ولا يُطبَّق الآن يُرفع إلى رأس الصفحة بسببه — فلا يُكتشف من
 * ارتفاع رقم.
 */
export default async function ChoicesPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/settings/choices");
  if (!can(user.role, "amounts:view")) {
    return (
      <PageShell user={user} title="ما قرّرتَه">
        <NoAccess what="دفترُ الاختيارات" />
      </PageShell>
    );
  }

  const ledger = await loadChoiceLedger();

  return (
    <PageShell
      user={user}
      title="ما قرّرتَه"
      intro="كلُّ ما اخترتَه أو كتبتَه بيدك: حالُه اليوم، وأثرُه بالريال حيث يُحسب، وزرُّ سحبه. لا يُبطَل اختيارٌ منها بصمت — وما لا يُطبَّق يُقال هنا بسببه."
    >
      {ledger.total === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="لم تقرّر شيئاً بيدك بعد."
          hint="حين تضمّ حركةً إلى الإقرار، أو تغلق تنبيهاً، أو تكتب سياسةَ مورّدٍ أو قاعدةَ تصنيف، يظهر هنا بتاريخه وأثره."
        />
      ) : (
        <>
          {ledger.notApplied.length > 0 ? (
            <Callout tone="warn" icon={CircleSlash} title={`ممّا اخترتَ لا يُطبَّق الآن: ${countNoun(ledger.notApplied.length, ITEM)}`}>
              اخترتَها وهي لا تعمل اليوم — كلٌّ بسببه في بابه أدناه، مرفوعةً إلى أوّله. اختيارُك محفوظٌ كما هو؛ اسحبه أو عالِج سببَه.
            </Callout>
          ) : (
            <Callout tone="ok" icon={CircleCheck} title={`${countNoun(ledger.total, ITEM)} — كلُّها تعمل كما اخترتَ أو مقفلةٌ بإقرارٍ قُدِّم`} />
          )}

          {ledger.byGroup.map((g) => (
            <Section key={g.group} id={g.group} title={CHOICE_GROUP_LABEL[g.group]} hint={CHOICE_GROUP_HINT[g.group]} count={g.rows.length}>
              <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
                {g.rows.map((r) => <Row key={r.id} row={r} role={user.role} />)}
              </ul>
            </Section>
          ))}

          {ledger.olderVatChoices.count > 0 && (
            <Section title="اختياراتُ إقرارٍ أقدم" hint="أرباعٌ سابقة لا يُعاد حسابُها هنا — تُفتح من صفحة إقرارها.">
              <div className="flex flex-wrap gap-2">
                {ledger.olderVatChoices.quarters.map((q) => (
                  <LinkButton key={q.key} href={`/close/vat?period=${q.key}`} size="sm">{q.label}</LinkButton>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </PageShell>
  );
}
