import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, FileBadge, Percent, Plus, Repeat, Store, TriangleAlert, type LucideIcon } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Badge, Callout, EmptyState, LinkButton, NoAccess, Section } from "@/components/ui";
import { formatDay, formatMonth, formatWeekday } from "@/lib/riyadh-time";
import { COMMITMENT_LABEL, type Commitment, type CommitmentKind } from "@/lib/commitments";
import { COMMITMENT_MONTHS, loadCommitments } from "@/services/cash-outlook.service";
import { T } from "@/components/i18n/t";

export const dynamic = "force-dynamic";

const ICON: Record<CommitmentKind, LucideIcon> = { SUPPLIER_RUN: Store, RECURRING: Repeat, VAT: Percent, EXPIRY: FileBadge };

/**
 * تقويمُ الالتزامات — يوماً بيوم ما يُدفع وما ينتهي، في الأشهر الثلاثة القادمة.
 *
 * من وقائع «النقد القادم» نفسها ووثائقِ الانتهاء (`lib/commitments.ts`). قائمةٌ
 * بالأيّام التي فيها شيء — لا شبكةٌ فارغةُ الخانات. وما لا يومَ له «بلا يوم».
 */
export default async function CommitmentsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/cash/calendar");
  if (!can(user.role, "bank:view")) {
    return (
      <PageShell user={user} title="تقويم الالتزامات">
        <NoAccess what="تقويم الالتزامات" />
      </PageShell>
    );
  }

  const c = await loadCommitments();
  const canPay = can(user.role, "payment:approve");
  const canVat = can(user.role, "month:close");
  const canDocs = can(user.role, "reports:view");
  /* سطرٌ لا يملك الدورُ صفحتَه يُقرأ ولا يُفتح — لا رابطَ إلى «خارج صلاحيتك» */
  const hrefFor = (i: Commitment): string | null =>
    i.kind === "SUPPLIER_RUN" ? (canPay ? i.href : "/suppliers")
    : i.kind === "VAT" ? (canVat ? i.href : null)
    : i.kind === "EXPIRY" ? (canDocs ? i.href : null)
    : i.href;
  const nothing = c.days.length === 0 && c.undated.length === 0 && c.overdue.length === 0;
  const months = [...new Set(c.days.map((d) => d.day.slice(0, 7)))];

  return (
    <PageShell
      user={user}
      title="تقويم الالتزامات"
      intro={`ما ستدفعه وما سينتهي يوماً بيوم في ${COMMITMENT_MONTHS === 3 ? "الأشهر الثلاثة" : `${COMMITMENT_MONTHS} أشهر`} القادمة: دفعات المورّدين، والمصروفات المتكررة، وموعد الإقرار الضريبي، وانتهاء الوثائق.`}
      actions={<LinkButton href="/settings#recurring" icon={Plus} variant="secondary">مصروف متكرر</LinkButton>}
    >
      {nothing ? (
        <EmptyState
          icon={CalendarDays}
          title="لا توجد التزامات معروفة في الأشهر القادمة."
          hint="يُبنى التقويم من أربعة مصادر: دفعات المورّدين، والمصروفات المتكررة المسجّلة بأيامها، والإقرار الضريبي، والوثائق التي لها تاريخ انتهاء. سجّل الإيجار والرواتب كمصروفات متكررة، وأضف وثائق المقهى."
          action={
            <>
              <LinkButton href="/settings#recurring" variant="primary" icon={Plus}>سجّل مصروفاً متكرراً</LinkButton>
              {canDocs && <LinkButton href="/settings/obligations" variant="secondary" icon={FileBadge}>أضف وثيقة</LinkButton>}
            </>
          }
        />
      ) : (
        <>
          {c.overdue.length > 0 && (
            <Callout tone="danger" icon={TriangleAlert} title="فات موعده ولم يُنفَّذ">
              <ul className="mt-1 space-y-1">
                {c.overdue.map((i) => (
                  <li key={i.id}><Entry item={i} href={hrefFor(i)} /></li>
                ))}
              </ul>
            </Callout>
          )}

          {months.map((month, index) => (
            <Section key={month} title={formatMonth(month)} icon={CalendarDays} className={index === 0 && c.overdue.length === 0 ? "mt-0!" : ""}>
              <ol className="space-y-2">
                {c.days.filter((d) => d.day.startsWith(month)).map((d) => (
                  <li
                    key={d.day}
                    className={`rounded-xl border bg-raised px-4 py-3 shadow-raised ${d.today ? "border-accent-line" : "border-line"} ${d.past ? "opacity-80" : ""}`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="text-sm font-bold">
                        {formatWeekday(d.day)} <bdi>{formatDay(d.day)}</bdi>
                        {d.today && <span className="ms-2"><Badge tone="accent">اليوم</Badge></span>}
                        {d.past && <span className="ms-2"><Badge>انقضى</Badge></span>}
                      </p>
                      {(d.totalMinor > 0 || d.hasUnknown) && (
                        <p className="text-sm font-bold">
                          {d.totalMinor > 0 && <Money minor={d.totalMinor} />}
                          {d.hasUnknown && <span className="ms-2 text-[11px] font-medium text-warn">{d.totalMinor > 0 ? "+ بنود مبالغها غير معروفة" : "مبلغ غير معروف"}</span>}
                        </p>
                      )}
                    </div>
                    <ul className="mt-2 space-y-1">
                      {d.items.map((i) => (
                        <li key={i.id}><Entry item={i} href={hrefFor(i)} /></li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </Section>
          ))}

          {c.undated.length > 0 && (
            <Section
              title="بلا يوم محدد"
              icon={Repeat}
              hint="مصروفات متكررة تقع في هذا الشهر بلا تاريخ استحقاق أول، والنظام لن يخترع لها يوماً. أضف تاريخها من الإعدادات لتظهر في التقويم."
              action={<LinkButton href="/settings#recurring" variant="secondary" size="sm">حدّد يومها</LinkButton>}
            >
              <ul className="space-y-2">
                {c.undated.map((u) => (
                  <li key={u.month} className="rounded-xl border border-dashed border-line bg-raised/60 px-4 py-3">
                    <p className="text-xs font-bold text-ink-soft">{formatMonth(u.month)}</p>
                    <ul className="mt-2 space-y-1">
                      {u.items.map((i) => (
                        <li key={i.id}><Entry item={i} href={hrefFor(i)} /></li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {!c.hasObligations && canDocs && (
            <Callout tone="accent" icon={FileBadge} className="mt-8" title="الوثائق لا تظهر بعد" action={<LinkButton href="/settings/obligations" variant="primary" size="sm">أضفها</LinkButton>}>
              لم تُضف أي وثيقة بتاريخ انتهائها، لذلك يعرض التقويم الالتزامات المالية فقط. أضف الرخص والإقامات وعقد الإيجار لتظهر في مواعيدها.
            </Callout>
          )}

          <p className="mt-8 text-xs leading-relaxed text-muted">
            <T s="لا يشمل التقويم المبالغ الداخلة، ولا المصروفات غير المسجّلة كمتكررة. لمقارنة هذه الالتزامات بالرصيد افتح {0}." a={[<Link key="0" href="/cash" className="font-bold text-accent hover:underline">السيولة القادمة</Link>]} /></p>
        </>
      )}
    </PageShell>
  );
}

function Entry({ item, href }: { item: Commitment; href: string | null }) {
  const Icon = ICON[item.kind];
  const body = (
    <>
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sunken text-ink-soft">
        <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{item.label}</span>
        <span className="block truncate text-[11px] text-muted">{COMMITMENT_LABEL[item.kind]}{item.sub && <> · {item.sub}</>}</span>
      </span>
      {item.amountMinor !== null
        ? <span className="shrink-0 text-[13px] font-bold"><Money minor={item.amountMinor} /></span>
        : item.kind !== "EXPIRY" && <span className="shrink-0 text-[11px] text-warn">غير معروف</span>}
    </>
  );
  const cls = "flex min-h-11 items-center gap-3 rounded-lg px-1";
  return href
    ? <Link href={href} className={`${cls} transition-colors hover:bg-hover`}>{body}</Link>
    : <div className={cls}>{body}</div>;
}
