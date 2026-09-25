import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray, not, sql, type SQL } from "drizzle-orm";
import {
  Boxes, FileText, Landmark, Sparkles, Store, UserRound, Wallet, CircleDot, type LucideIcon,
} from "lucide-react";
import { invoiceHref } from "@/lib/invoice-profile";
import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { EmptyState, LinkTabs, NoAccess } from "@/components/ui";
import { buttonClass } from "@/components/ui-tokens";
import { ENTITY_LABEL, actionLabel, labelValue } from "@/lib/audit-labels";
import { AUDIT_KIND_LABEL, KIND_PATTERN, LEARNED_ACTIONS, auditKind, isAuditKind, type AuditKind } from "@/lib/audit-kinds";
import { todayInRiyadh } from "@/lib/riyadh-time";

export const dynamic = "force-dynamic";

/**
 * سجلُّ التدقيق — «ما الذي تغيّر» مقروءاً.
 *
 * كان قائمةً واحدة بستّين سطراً، نصفُها تعلّمٌ آليّ يكتبه النظام بالمئات
 * فيُغرق ما فعله إنسان. صار أياماً (اليوم · أمس · تاريخ) وتحت كلّ يومٍ
 * أفعالُه برمز بابها، ومَن فعل، ووجهةُ السجلّ، والتفصيلُ خلف «التفاصيل».
 * والأبوابُ تُرشَّح من العنوان (`?kind=`)، والتعلّمُ الآليّ مخفيٌّ إلّا إذا طُلب.
 */

const WHEN_TIME = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", {
  timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const DAY_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" });
const DAY_LABEL = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { timeZone: "Asia/Riyadh", weekday: "long", day: "numeric", month: "long", year: "numeric" });

const KIND_ICON: Record<AuditKind, LucideIcon> = {
  money: Wallet,
  documents: FileText,
  bank: Landmark,
  suppliers: Store,
  inventory: Boxes,
  learned: Sparkles,
  other: CircleDot,
};

const KIND_TONE: Record<AuditKind, string> = {
  money: "bg-accent-soft text-accent",
  documents: "bg-info-bg text-info",
  bank: "bg-sand-bg text-sand",
  suppliers: "bg-plum-bg text-plum",
  inventory: "bg-ok-bg text-ok",
  learned: "bg-sunken text-muted",
  other: "bg-sunken text-ink-soft",
};

const SIZE = 60;

function Detail({ value, label }: { value: unknown; label: string }) {
  if (value === null || value === undefined || typeof value !== "object") return null;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))
    .slice(0, 12);
  if (entries.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-bold text-muted">{label}</p>
      <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
        {entries.map(([k, v]) => (
          <div key={k} className="contents text-[11px]">
            <dt className="text-muted">{k.replace(/_/g, " ")}</dt>
            <dd className="min-w-0 break-words text-ink-soft" dir="auto">{labelValue(v).slice(0, 240)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function entityLink(entityType: string, entityId: string): React.ReactNode {
  if (entityType === "invoice") return <Link href={invoiceHref(entityId)} className="font-bold text-accent hover:underline">فاتورة</Link>;
  if (entityType === "bank_transaction") return <Link href={`/bank?tx=${encodeURIComponent(entityId)}`} className="font-bold text-accent hover:underline">حركة بنك</Link>;
  if (entityType === "month") return <Link href="/close" className="font-bold text-accent hover:underline">الإقفال</Link>;
  return ENTITY_LABEL[entityType] ?? "سجلّ";
}

export default async function AuditTrailPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; page?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/settings/audit");
  if (!can(user.role, "audit:view")) {
    return (
      <PageShell user={user} width="wide" title="سجلّ التدقيق">
        <NoAccess what="سجلّ التدقيق" />
      </PageShell>
    );
  }

  const p = await searchParams;
  const page = Math.max(1, Math.min(10_000, Number(p.page ?? "1") || 1));
  const kind: AuditKind | null = isAuditKind(p.kind) ? p.kind : null;

  const conditions: SQL[] = [];
  if (kind === "learned") conditions.push(inArray(auditLogs.action, [...LEARNED_ACTIONS]));
  else conditions.push(not(inArray(auditLogs.action, [...LEARNED_ACTIONS])));
  if (kind && kind !== "learned") {
    if (kind === "other") {
      for (const [, pattern] of KIND_PATTERN) conditions.push(sql`${auditLogs.action} !~ ${pattern}`);
    } else {
      const pattern = KIND_PATTERN.find(([k]) => k === kind)?.[1];
      if (pattern) conditions.push(sql`${auditLogs.action} ~ ${pattern}`);
    }
  }

  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      before: auditLogs.before,
      after: auditLogs.after,
      at: auditLogs.at,
      actorName: users.name,
      actorEmail: users.email,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(and(...conditions))
    .orderBy(desc(auditLogs.at))
    .limit(SIZE)
    .offset((page - 1) * SIZE);

  /* أيّامٌ بتوقيت الرياض، بترتيب ما وقع */
  const today = todayInRiyadh();
  const y = new Date(`${today}T12:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  const yesterday = y.toISOString().slice(0, 10);
  const days = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = DAY_KEY.format(r.at);
    days.set(key, [...(days.get(key) ?? []), r]);
  }

  const tab = (k: AuditKind | null) => (k ? `/settings/audit?kind=${k}` : "/settings/audit");
  const pageHref = (n: number) => `/settings/audit?${kind ? `kind=${kind}&` : ""}page=${n}`;

  return (
    <PageShell
      user={user}
      width="page"
      title="سجلّ التدقيق"
      intro="ما فُعل، ومن فعله، ومتى — بتوقيت الرياض. لا يُعدَّل ولا يُحذف."
    >
      <div className="mb-6">
        <LinkTabs
          label="الباب"
          items={[
            { href: tab(null), label: "كلّ ما فعله إنسان", active: kind === null },
            ...(["money", "documents", "bank", "suppliers", "inventory", "learned"] as const).map((k) => ({
              href: tab(k),
              label: AUDIT_KIND_LABEL[k],
              active: kind === k,
            })),
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={page > 1 ? "لا أقدم من هذا." : "لا شيء في هذا الباب بعد."}
          hint="كلُّ فعلٍ يكتب مالاً أو يغيّر حالاً يُقيَّد هنا باسم فاعله ووقته."
          action={page > 1 ? <Link href={pageHref(page - 1)} className={buttonClass("secondary", "sm")}>الأحدث</Link> : undefined}
        />
      ) : (
        <div className="space-y-8">
          {[...days].map(([day, list]) => (
            <section key={day} aria-label={day}>
              <h2 className="sticky top-14 z-[5] -mx-1 mb-3 bg-surface/90 px-1 py-1.5 text-[13px] font-bold backdrop-blur lg:top-[60px]">
                {day === today ? "اليوم" : day === yesterday ? "أمس" : DAY_LABEL.format(new Date(`${day}T12:00:00+03:00`))}
                <span className="ms-2 text-[11px] font-medium text-muted"><span className="nums">{list.length}</span></span>
              </h2>
              <ol className="relative space-y-2">
                {list.map((r) => {
                  const k = auditKind(r.action);
                  const Icon = KIND_ICON[k];
                  const hasDetail = (r.after !== null && typeof r.after === "object") || (r.before !== null && typeof r.before === "object");
                  return (
                    <li key={r.id} className="rounded-xl border border-line bg-raised px-4 py-3 shadow-raised">
                      <div className="flex items-start gap-3">
                        <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${KIND_TONE[k]}`} title={AUDIT_KIND_LABEL[k]}>
                          <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <p className="text-[13px] font-bold">{actionLabel(r.action)}</p>
                            <p className="nums text-[11px] text-muted"><bdi>{WHEN_TIME.format(r.at)}</bdi></p>
                          </div>
                          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                            <UserRound className="h-3 w-3" strokeWidth={2} aria-hidden />
                            {r.actorName ?? r.actorEmail ?? "النظام"} · {entityLink(r.entityType, r.entityId)}
                          </p>
                          {hasDetail && (
                            <details className="group mt-2">
                              <summary className="inline-flex min-h-11 cursor-pointer items-center text-[11px] font-bold text-ink-soft hover:text-accent sm:min-h-6">
                                التفاصيل
                              </summary>
                              <div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-3 rounded-lg bg-sunken/60 p-3 sm:grid-cols-2">
                                <Detail value={r.before} label="قبل" />
                                <Detail value={r.after} label={r.before ? "بعد" : "ما كُتب"} />
                              </div>
                            </details>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}

      {(page > 1 || rows.length === SIZE) && rows.length > 0 && (
        <nav aria-label="الصفحات" className="mt-8 flex items-center justify-between gap-3">
          {page > 1 ? <Link href={pageHref(page - 1)} className={buttonClass("secondary", "sm")}>الأحدث</Link> : <span />}
          {rows.length === SIZE ? <Link href={pageHref(page + 1)} className={buttonClass("secondary", "sm")}>الأقدم</Link> : <span />}
        </nav>
      )}
    </PageShell>
  );
}
