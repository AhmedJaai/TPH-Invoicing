import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, PageShell } from "@/components/page-shell";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  DOCUMENT_UPLOADED: "رفع مستند",
  DOCUMENT_ARCHIVED: "أرشفة مستند",
  DOCUMENT_REJECTED: "رفض مستند",
  FIELD_CORRECTED: "تصحيح حقل",
  SUPPLIER_CREATED: "إنشاء مورّد",
  SUPPLIER_UPDATED: "تعديل مورّد",
  ISSUE_WAIVED: "تجاوز تنبيه",
  MONTH_CLOSED: "إقفال شهر",
  USER_ROLE_CHANGED: "تغيير دور",
  DRIVE_SYNCED: "مزامنة الدرايف",
  BANK_IMPORTED: "استيراد كشف بنك",
  INVOICES_MARKED_PAID: "وسم فواتير مسدَّدة",
  SUPPLIER_ALIAS_LEARNED: "تعلّم اسم بنكي",
  STATEMENT_RECONCILED: "مطابقة كشف مورّد",
  PRODUCT_LINKED: "ربط صنف معياري",
  PRODUCT_UNLINKED: "فكّ ربط صنف",
  EXPENSE_ADDED: "إضافة مصروف متكرّر",
  EXPENSE_REMOVED: "تعطيل مصروف متكرّر",
};

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
            {typeof v === "object" ? JSON.stringify(v).slice(0, 90) : String(v).slice(0, 90)}
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
  if (!user) redirect("/login");
  if (!can(user.role, "audit:view")) {
    return (
      <PageShell user={user} active="/settings" title="سجل التدقيق">
        <Empty message="سجل التدقيق للمالك والمحاسب." />
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
      active="/settings"
      title="سجل التدقيق"
      intro="ما فُعل، ومن فعله، ومتى — غير قابل للتعديل ولا الحذف، مفروضاً بمشغّلات في القاعدة لا باتفاق برمجي."
    >
      {rows.length === 0 ? (
        <Empty message="لا سجلات بعد." />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-bold">
                  {ACTION_LABEL[r.action] ?? r.action}
                </span>
                <span className="nums text-[11px] text-muted" dir="ltr">
                  {r.at.toISOString().replace("T", " ").slice(0, 16)}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-muted">
                {r.actorName ?? r.actorEmail ?? "النظام"} · {r.entityType}
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
