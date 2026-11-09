/**
 * رسائلُ الفريق — اقتراحٌ أو شكوى من الموظّف عبر «TPH Team» إلى صاحب المقهى، وردُّه عليها.
 *
 *   الموظّف (رابطُه إذنُه) ← رسالة ← «يحتاج قرارك» ← صاحبُ المقهى يقرؤها ويردّ ← يرى الموظّفُ الردّ
 *
 * المرسَلةُ بلا اسم لا يُحفظ معها الموظّف أصلاً (`employee_id` فارغ): لا يعرفه صاحبُ المقهى ولا
 * القاعدة، ولا تعود إلى صاحبها فلا ردَّ يصله. والرسالةُ تُغلَق ولا تُحذف.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, teamMessages, type TeamMessageKind } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { pgErrorCode } from "@/lib/pg-error";
import type { Conn } from "./types";


export const TEAM_MESSAGE_LABEL: Record<TeamMessageKind, string> = {
  SUGGESTION: "اقتراح",
  COMPLAINT: "شكوى",
  OTHER: "رسالة",
};

export const TEAM_MESSAGE_MIN = 3;
export const TEAM_MESSAGE_MAX = 2000;
export const TEAM_REPLY_MAX = 1000;

export class TeamMessageRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamMessageRefused";
  }
}

/** يحفظ رسالةَ الموظّف. بلا اسم: لا يُحفظ معها من أرسلها. */
export async function sendTeamMessage(input: { employeeId: string; kind: TeamMessageKind; body: string; anonymous: boolean }): Promise<string> {
  const body = input.body.trim();
  if (body.length < TEAM_MESSAGE_MIN) throw new TeamMessageRefused("اكتب رسالتك أولاً.");
  if (body.length > TEAM_MESSAGE_MAX) throw new TeamMessageRefused(`الرسالة أطول من ${TEAM_MESSAGE_MAX} حرف. اختصرها أو قسّمها.`);
  const [row] = await db.insert(teamMessages)
    .values({ employeeId: input.anonymous ? null : input.employeeId, kind: input.kind, body })
    .returning({ id: teamMessages.id });
  return row.id;
}

export interface MyMessage {
  id: string;
  kind: TeamMessageKind;
  body: string;
  createdAt: Date;
  read: boolean;
  reply: string | null;
  repliedAt: Date | null;
  closed: boolean;
}

/** رسائلُ الموظّف التي أرسلها باسمه — وردُّ صاحب المقهى عليها. */
export async function myMessages(employeeId: string, limit = 10): Promise<MyMessage[]> {
  try {
    const rows = await db.select().from(teamMessages).where(eq(teamMessages.employeeId, employeeId)).orderBy(desc(teamMessages.createdAt)).limit(limit);
    return rows.map((r) => ({ id: r.id, kind: r.kind, body: r.body, createdAt: r.createdAt, read: r.readAt !== null, reply: r.reply, repliedAt: r.repliedAt, closed: r.closedAt !== null }));
  } catch (e) {
    /* الجدولُ قبل هجرته (نافذةُ النشر) لا يُسقط صفحةَ الموظّف */
    if (pgErrorCode(e) === "42P01") return [];
    throw e;
  }
}

export interface TeamMessageView {
  id: string;
  kind: TeamMessageKind;
  body: string;
  createdAt: Date;
  /** `null`: أُرسلت بلا اسم. */
  employeeId: string | null;
  employeeName: string | null;
  readAt: Date | null;
  reply: string | null;
  repliedAt: Date | null;
  closedAt: Date | null;
}

/** ما يراه صاحبُ المقهى: المفتوحةُ أوّلاً بأحدثها، ثمّ المغلقةُ الأخيرة. */
export async function loadTeamMessages(conn: Conn = db): Promise<{ open: TeamMessageView[]; closed: TeamMessageView[] }> {
  const pick = {
    id: teamMessages.id, kind: teamMessages.kind, body: teamMessages.body, createdAt: teamMessages.createdAt,
    employeeId: teamMessages.employeeId, employeeName: employees.name, readAt: teamMessages.readAt,
    reply: teamMessages.reply, repliedAt: teamMessages.repliedAt, closedAt: teamMessages.closedAt,
  };
  const [open, closed] = await Promise.all([
    conn.select(pick).from(teamMessages).leftJoin(employees, eq(employees.id, teamMessages.employeeId))
      .where(isNull(teamMessages.closedAt)).orderBy(desc(teamMessages.createdAt)).limit(200),
    conn.select(pick).from(teamMessages).leftJoin(employees, eq(employees.id, teamMessages.employeeId))
      .where(sql`${teamMessages}.closed_at is not null`).orderBy(desc(teamMessages.closedAt)).limit(30),
  ]);
  return { open, closed };
}

/** رسائلُ لم تُقرأ، ومنها الشكاوى — بندُ «يحتاج قرارك». الجدولُ قبل هجرته لا رسائلَ فيه، لا خطأ. */
export async function unreadTeamMessages(conn: Conn = db): Promise<{ count: number; complaints: number }> {
  try {
    const r = await conn.execute<{ n: number; c: number }>(sql`select count(*)::int as n, count(*) filter (where kind = 'COMPLAINT')::int as c from team_messages where read_at is null and closed_at is null`);
    return { count: Number(r.rows[0]?.n ?? 0), complaints: Number(r.rows[0]?.c ?? 0) };
  } catch (e) {
    if (pgErrorCode(e) === "42P01") return { count: 0, complaints: 0 };
    throw e;
  }
}

/** قرأها — تخرج من «يحتاج قرارك» وتبقى مفتوحةً حتى تُغلَق. */
export async function markTeamMessageRead(id: string, actorId: string): Promise<boolean> {
  const done = await db.update(teamMessages).set({ readAt: new Date(), readById: actorId })
    .where(and(eq(teamMessages.id, id), isNull(teamMessages.readAt))).returning({ id: teamMessages.id });
  return done.length > 0;
}

/** يردّ على الرسالة (ويُعدّ قراءةً لها). يراه الموظّفُ في تطبيقه إن أرسلها باسمه. */
export async function replyToTeamMessage(id: string, reply: string, actorId: string): Promise<{ toEmployee: boolean }> {
  const text = reply.trim();
  if (text.length === 0) throw new TeamMessageRefused("اكتب الرد أولاً.");
  if (text.length > TEAM_REPLY_MAX) throw new TeamMessageRefused(`الرد أطول من ${TEAM_REPLY_MAX} حرف.`);
  return db.transaction(async (t) => {
    const [before] = await t.select().from(teamMessages).where(eq(teamMessages.id, id)).for("update");
    if (!before) throw new TeamMessageRefused("الرسالة غير موجودة. حدّث الصفحة.");
    const now = new Date();
    await t.update(teamMessages).set({ reply: text, repliedAt: now, repliedById: actorId, readAt: before.readAt ?? now, readById: before.readById ?? actorId })
      .where(eq(teamMessages.id, id));
    await recordAudit({ actorId, action: "TEAM_MESSAGE_REPLIED", entityType: "team_message", entityId: id, before: { reply: before.reply }, after: { reply: text } }, t);
    return { toEmployee: before.employeeId !== null };
  });
}

/** يُغلقها (عولجت) أو يعيد فتحها. */
export async function setTeamMessageClosed(id: string, closed: boolean, actorId: string): Promise<boolean> {
  return db.transaction(async (t) => {
    const now = new Date();
    const done = await t.update(teamMessages)
      .set(closed ? { closedAt: now, closedById: actorId, readAt: sql`coalesce(${teamMessages}.read_at, now())`, readById: sql`coalesce(${teamMessages}.read_by_id, ${actorId})` } : { closedAt: null, closedById: null })
      .where(and(eq(teamMessages.id, id), closed ? isNull(teamMessages.closedAt) : sql`${teamMessages}.closed_at is not null`))
      .returning({ id: teamMessages.id });
    if (done.length === 0) return false;
    await recordAudit({ actorId, action: closed ? "TEAM_MESSAGE_CLOSED" : "TEAM_MESSAGE_REOPENED", entityType: "team_message", entityId: id, before: null, after: { closed } }, t);
    return true;
  });
}
