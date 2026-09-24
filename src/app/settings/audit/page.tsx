import Link from "next/link";
import { invoiceHref } from "@/lib/invoice-profile";
import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, PageShell } from "@/components/page-shell";
import { NoAccess } from "@/components/ui";
import { ENTITY_LABEL, actionLabel, labelValue } from "@/lib/audit-labels";

export const dynamic = "force-dynamic";

/**
 * الوقت بتوقيت الرياض — كان يُعرض UTC بلا إشارة، فالعاشرة صباحاً «07:00».
 *
 * و`hour12: false` يُخرج منتصف الليل «24:02» بتاريخ يومه السابق، فيُقرأ
 * اليومُ خطأً في سجلٍّ مرجعُه الزمن. و`hourCycle: "h23"` يُخرجها «00:02».
 */
const WHEN = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", {
  timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** يعرض محتوى jsonb سطراً سطراً بلا حشو. */
function Detail({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") {
    return <span className="text-[11px] text-ink-soft">{String(value)}</span>;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))
    .slice(0, 8);

  if (entries.length === 0) return null;

  return (
    <dl className="mt-1 space-y-0.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2 text-[11px]">
          <dt className="shrink-0 text-muted">{k.replace(/_/g, " ")}:</dt>
          <dd className="min-w-0 truncate text-ink-soft" dir="auto">
            {labelValue(v).slice(0, 90)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default async function AuditTrailPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; page?: string }>;
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
  const page = Math.max(1, Number(p.page ?? "1") || 1);
  const SIZE = 60;

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
    .orderBy(desc(auditLogs.at))
    .limit(SIZE)
    .offset((page - 1) * SIZE);

  return (
    <PageShell
      user={user}
     
      title="سجلّ التدقيق"
      intro="ما فُعل، ومن فعله، ومتى — بتوقيت الرياض."
    >
      {rows.length === 0 ? (
        <Empty message="لا سجلات بعد." />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-bold">
                  {actionLabel(r.action)}
                </span>
                <span className="nums text-[11px] text-muted">
                  <bdi>{WHEN.format(r.at)}</bdi>
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-muted">
                {r.actorName ?? r.actorEmail ?? "النظام"} ·{" "}
                {/* ما له صفحةٌ يُفتَح منها — السجلُّ مرجعٌ عند الخلاف، والخلافُ على سجلٍّ بعينه */}
                {r.entityType === "invoice" ? (
                  <Link href={invoiceHref(r.entityId)} className="underline underline-offset-4">فاتورة</Link>
                ) : r.entityType === "bank_transaction" ? (
                  <Link href={`/bank?tx=${encodeURIComponent(r.entityId)}`} className="underline underline-offset-4">حركة بنك</Link>
                ) : (
                  ENTITY_LABEL[r.entityType] ?? "سجلّ"
                )}
              </p>
              <Detail value={r.after} />
            </li>
          ))}
        </ul>
      )}

      {(page > 1 || rows.length === SIZE) && (
        <div className="mt-4 flex items-center justify-between gap-3">
          {page > 1 ? (
            <a href={`/settings/audit?page=${page - 1}`} className="rounded-lg border border-line px-3 py-2 text-xs font-medium hover:border-ink-soft">
              الأحدث
            </a>
          ) : <span />}
          {rows.length === SIZE ? (
            <a href={`/settings/audit?page=${page + 1}`} className="rounded-lg border border-line px-3 py-2 text-xs font-medium hover:border-ink-soft">
              الأقدم
            </a>
          ) : <span />}
        </div>
      )}
    </PageShell>
  );
}
