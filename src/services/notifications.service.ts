/**
 * مركزُ الإشعارات والملخّصُ اليوميّ — ما تغيّر منذ آخر مرّة.
 *
 * الإشعارُ **يُشتقّ ممّا وقع ولا يُخزَّن**: مستنداتٌ وصلت وقُرئت، ومستنداتٌ
 * تنتظر عيناً، وقراءةٌ تعثّرت، ومورّدون تأخّر سدادُهم، وفعلٌ في سجلّ
 * التدقيق. فلا جدولَ إشعاراتٍ يتأخّر عن الحقيقة أو يُنسى تحديثه. والذي
 * يُخزَّن هو ما لا يُشتقّ وحده: متى قرأ المستخدمُ آخرَ مرّة (045).
 *
 * والمبلغ لا يُذكر لمن لا يرى المبالغ.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ACTION_LABEL } from "@/lib/audit-labels";
import { DAY, DOCUMENT, SUPPLIER, countNoun } from "@/lib/arabic";
import { can, type Role } from "@/lib/permissions";
import { todayInRiyadh } from "@/lib/riyadh-time";
import { loadOverdueBalances } from "./supplier-balance.service";

export type NoticeTone = "ok" | "warn" | "danger" | "info";

export interface Notice {
  /** مفتاحٌ ثابت للشيء نفسه — لا يتكرّر الإشعار بتكرار الطلب. */
  id: string;
  /** ISO — متى وقع. */
  at: string;
  title: string;
  body?: string;
  href: string;
  tone: NoticeTone;
  kind: "DOCUMENTS" | "REVIEW" | "STALLED" | "OVERDUE" | "ACTIVITY";
}

export interface Digest {
  /** بداية النافذة — آخر ٢٤ ساعة. */
  since: string;
  documentsArrived: number;
  documentsArchived: number;
  needsReview: number;
  paymentsRecorded: number;
  decisionsTaken: number;
}

export interface NoticeFeed {
  notices: Notice[];
  unread: number;
  seenAt: string | null;
  digest: Digest;
}

/** أفعالٌ في السجلّ لا يُشعَر بها: يكتبها النظام بنفسه بالمئات. */
const QUIET_ACTIONS = new Set(["SUPPLIER_ALIAS_LEARNED", "DRIVE_FILE_RENAMED", "AI_ANALYSIS_RUN"]);

/** أفعالٌ تُحسب «قراراتٍ» في الملخّص — ما حسمه إنسان. */
const DECISION_ACTIONS = [
  "AI_FINDING_DECIDED", "ALERT_RESOLVED", "DOCUMENT_ARCHIVED", "DOCUMENT_REJECTED",
  "STATEMENT_RECONCILED", "INVOICES_MARKED_PAID", "MONTH_CLOSED",
];

const WINDOW_DAYS = 14;

function actionLabel(action: string): string {
  return (ACTION_LABEL as Record<string, string>)[action] ?? action;
}

export async function loadNoticeFeed(user: { id: string; role: Role }): Promise<NoticeFeed> {
  const money = can(user.role, "amounts:view");
  const audit = can(user.role, "audit:view");

  const [seenRow] = await db
    .select({ seenAt: users.notificationsSeenAt })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  const seenAt = seenRow?.seenAt ?? null;

  const [arrivals, pending, activity, digestRow, overdue] = await Promise.all([
    db.execute<{ day: string; arrived: number; archived: number; last_at: string }>(sql`
      select to_char(created_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as day,
             count(*)::int as arrived,
             count(*) filter (where status = 'ARCHIVED')::int as archived,
             max(created_at) as last_at
        from documents
       where created_at > now() - make_interval(days => ${WINDOW_DAYS})
       group by 1
       order by 1 desc
    `),
    db.execute<{ review: number; review_at: string | null; stalled: number; stalled_at: string | null }>(sql`
      select count(*) filter (where status = 'NEEDS_REVIEW')::int as review,
             max(updated_at) filter (where status = 'NEEDS_REVIEW') as review_at,
             count(*) filter (where status = 'PENDING' and created_at < now() - interval '15 minutes')::int as stalled,
             max(created_at) filter (where status = 'PENDING' and created_at < now() - interval '15 minutes') as stalled_at
        from documents
    `),
    audit
      ? db.execute<{ id: string; action: string; entity_type: string; at: string; actor: string | null }>(sql`
          select a.id, a.action, a.entity_type, a.at, u.name as actor
            from audit_logs a
            left join users u on u.id = a.actor_id
           where a.at > now() - make_interval(days => ${WINDOW_DAYS})
             and a.action not in ('SUPPLIER_ALIAS_LEARNED', 'DRIVE_FILE_RENAMED', 'AI_ANALYSIS_RUN')
           order by a.at desc
           limit 25
        `)
      : Promise.resolve({ rows: [] as { id: string; action: string; entity_type: string; at: string; actor: string | null }[] }),
    db.execute<{ arrived: number; archived: number; payments: number; decisions: number }>(sql`
      select
        (select count(*)::int from documents where created_at > now() - interval '24 hours') as arrived,
        (select count(*)::int from documents where status = 'ARCHIVED' and updated_at > now() - interval '24 hours') as archived,
        (select count(*)::int from payments where created_at > now() - interval '24 hours') as payments,
        (select count(*)::int from audit_logs
          where at > now() - interval '24 hours'
            and action in (${sql.join(DECISION_ACTIONS.map((a) => sql`${a}`), sql`, `)})) as decisions
    `),
    money ? loadOverdueBalances() : Promise.resolve([]),
  ]);

  const notices: Notice[] = [];

  for (const d of arrivals.rows) {
    notices.push({
      id: `docs:${d.day}`,
      at: new Date(d.last_at).toISOString(),
      kind: "DOCUMENTS",
      tone: "info",
      title: `وصل ${countNoun(Number(d.arrived), DOCUMENT)}`,
      body: Number(d.archived) === Number(d.arrived)
        ? "قُرئت كلُّها وأُرشِفت."
        : `أُرشِف منها ${countNoun(Number(d.archived), DOCUMENT)} والباقي ينتظر.`,
      href: "/documents",
    });
  }

  const p = pending.rows[0];
  if (p && Number(p.review) > 0 && p.review_at) {
    notices.push({
      id: `review:${todayInRiyadh()}`,
      at: new Date(p.review_at).toISOString(),
      kind: "REVIEW",
      tone: "warn",
      title: `${countNoun(Number(p.review), DOCUMENT)} تنتظر مراجعتك`,
      body: "قرأها النظام ولم تجتمع شروطُ أرشفتها وحدها.",
      href: "/documents",
    });
  }
  if (p && Number(p.stalled) > 0 && p.stalled_at) {
    notices.push({
      id: `stalled:${todayInRiyadh()}`,
      at: new Date(p.stalled_at).toISOString(),
      kind: "STALLED",
      tone: "danger",
      title: `${countNoun(Number(p.stalled), DOCUMENT)} لم تُقرأ بعد`,
      body: "تعثّرت قراءتُها — أعد قراءتها من صفحة المستندات.",
      href: "/documents",
    });
  }

  if (overdue.length > 0) {
    const oldest = overdue.reduce((m, r) => Math.max(m, r.oldestDays), 0);
    notices.push({
      id: `overdue:${todayInRiyadh()}`,
      /* حالٌ قائمة لا حدث — تُؤرَّخ بأوّل اليوم فلا تقفز فوق ما وقع فعلاً */
      at: new Date(`${todayInRiyadh()}T00:00:00+03:00`).toISOString(),
      kind: "OVERDUE",
      tone: "warn",
      title: `${countNoun(overdue.length, SUPPLIER)} تأخّر سدادُهم أكثر من ${countNoun(60, DAY)}`,
      body: `أقدمُ دَينٍ منذ ${countNoun(oldest, DAY)}.`,
      href: "/payments",
    });
  }

  for (const a of activity.rows) {
    if (QUIET_ACTIONS.has(a.action)) continue;
    notices.push({
      id: `audit:${a.id}`,
      at: new Date(a.at).toISOString(),
      kind: "ACTIVITY",
      tone: "ok",
      title: actionLabel(a.action),
      body: a.actor ? `بيد ${a.actor}` : "آلياً",
      href: "/settings/audit",
    });
  }

  notices.sort((x, y) => y.at.localeCompare(x.at));
  const top = notices.slice(0, 30);
  const seenIso = seenAt ? seenAt.toISOString() : null;
  const unread = top.filter((n) => !seenIso || n.at > seenIso).length;

  const dg = digestRow.rows[0];
  return {
    notices: top,
    unread,
    seenAt: seenIso,
    digest: {
      since: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      documentsArrived: Number(dg?.arrived ?? 0),
      documentsArchived: Number(dg?.archived ?? 0),
      needsReview: Number(p?.review ?? 0),
      paymentsRecorded: money ? Number(dg?.payments ?? 0) : 0,
      decisionsTaken: Number(dg?.decisions ?? 0),
    },
  };
}

/** «علّم الكلّ مقروءاً» — الحدُّ يصير الآن. */
export async function markNoticesSeen(userId: string): Promise<string> {
  const now = new Date();
  await db.update(users).set({ notificationsSeenAt: now }).where(eq(users.id, userId));
  return now.toISOString();
}
