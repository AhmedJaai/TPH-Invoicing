/**
 * إدارةُ المستخدمين: مَن هم، ما أدوارُهم، ومَن جلستُه قائمة — وتغييرُ ذلك بقيدٍ في السجلّ.
 *
 * القواعدُ في `lib/user-admin.ts`. والتعطيلُ يُنهي الجلسات **في المعاملة نفسها**: كان
 * حذفُها يقع حين يطلب المعطَّلُ صفحةً (`auth.ts`)، لا حين يُعطَّل.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { allowlist, isRole, ROLE_LABEL, type Role } from "@/lib/permissions";
import { allowlistNote, approxLastSeen, checkUserChange, type AdminUser, type UserChange } from "@/lib/user-admin";

/** عمرُ الجلسة في `auth.ts` — به يُقدَّر آخرُ نشاط. */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export interface UserAdminRow extends AdminUser {
  name: string | null;
  email: string;
  activeSessions: number;
  /** نحو آخر نشاط — أو `null`: لا جلسةَ قائمة، فلا يُعرف. */
  lastSeenAbout: Date | null;
  /** اختلافُ الدور عن قائمة الدخول، أو غيابُه عنها. */
  note: string | null;
}

/** خطأٌ يُقال لصاحبه بنصّه (400). */
export class UserChangeRefused extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UserChangeRefused";
  }
}

export async function listUsersForAdmin(): Promise<UserAdminRow[]> {
  const list = allowlist();
  const result = await db.execute<{
    id: string; name: string | null; email: string; role: string; is_active: boolean;
    active_sessions: number; latest_expiry: string | null;
  }>(sql`
    select u.id, u.name, u.email, u.role::text as role, u.is_active,
           count(s.session_token)::int as active_sessions,
           max(s.expires) as latest_expiry
      from ${users} u
      left join ${sessions} s on s.user_id = u.id and s.expires > now()
     group by u.id
     order by u.created_at
  `);
  return result.rows.map((r) => {
    const role: Role = isRole(r.role) ? r.role : "PURCHASING";
    const listed = list.get(r.email.toLowerCase());
    return {
      id: r.id, name: r.name, email: r.email, role, isActive: r.is_active,
      allowlisted: listed !== undefined,
      activeSessions: Number(r.active_sessions),
      lastSeenAbout: approxLastSeen(r.latest_expiry ? new Date(r.latest_expiry) : null, SESSION_MAX_AGE_SECONDS),
      note: allowlistNote(role, listed, ROLE_LABEL),
    };
  });
}

export interface UserChangeResult {
  message: string;
  /** المالكُ أنهى جلساتِه هو — الشاشةُ تذهب إلى الدخول. */
  signedOutSelf: boolean;
}

export async function applyUserChange(actorId: string, targetId: string, change: UserChange): Promise<UserChangeResult> {
  return db.transaction(async (t) => {
    /* الصفوفُ تُقفَل: تغييران متزامنان لا يُنزلان المالكَين معاً */
    const rows = await t
      .select({ id: users.id, email: users.email, name: users.name, role: users.role, isActive: users.isActive })
      .from(users)
      .for("update");
    const list = allowlist();
    const everyone: (AdminUser & { email: string; name: string | null })[] = rows.map((r) => ({
      id: r.id, email: r.email, name: r.name, role: r.role, isActive: r.isActive,
      allowlisted: list.has(r.email.toLowerCase()),
    }));
    const target = everyone.find((u) => u.id === targetId);
    if (!target) throw new UserChangeRefused("المستخدم غير موجود — حدّث الصفحة");

    const verdict = checkUserChange(actorId, target, change, everyone);
    if (!verdict.ok) throw new UserChangeRefused(verdict.reason);

    const who = target.name ?? target.email;

    if (change.kind === "role") {
      await t.update(users).set({ role: change.role }).where(eq(users.id, target.id));
      await recordAudit({
        actorId, action: "USER_ROLE_CHANGED", entityType: "user", entityId: target.id,
        before: { المستخدم: target.email, الدور: target.role },
        after: { المستخدم: target.email, الدور: change.role },
      }, t);
      return { message: `صار دورُ ${who} «${ROLE_LABEL[change.role]}» — يسري من طلبه التالي`, signedOutSelf: false };
    }

    if (change.kind === "active") {
      await t.update(users).set({ isActive: change.active }).where(eq(users.id, target.id));
      const ended = change.active
        ? []
        : await t.delete(sessions).where(eq(sessions.userId, target.id)).returning({ token: sessions.sessionToken });
      await recordAudit({
        actorId, action: "USER_ACCESS_CHANGED", entityType: "user", entityId: target.id,
        before: { المستخدم: target.email, الحساب: target.isActive ? "مفعَّل" : "معطَّل" },
        after: {
          المستخدم: target.email, الحساب: change.active ? "مفعَّل" : "معطَّل",
          ...(change.active ? {} : { "جلساتٌ أُنهيت": ended.length }),
        },
      }, t);
      return {
        message: change.active
          ? `أُعيد تفعيلُ ${who} — يدخل بجوجل متى شاء`
          : `عُطِّل ${who} وأُنهيت جلساتُه — لا يدخل حتى تُعيد تفعيلَه`,
        signedOutSelf: false,
      };
    }

    const ended = await t.delete(sessions).where(eq(sessions.userId, target.id)).returning({ token: sessions.sessionToken });
    await recordAudit({
      actorId, action: "USER_SESSIONS_ENDED", entityType: "user", entityId: target.id,
      after: { المستخدم: target.email, "جلساتٌ أُنهيت": ended.length },
    }, t);
    return {
      message: ended.length === 0 ? `لا جلسةَ قائمة لـ${who}` : `أُنهيت جلساتُ ${who} على كلّ الأجهزة — يدخل من جديد بجوجل`,
      signedOutSelf: target.id === actorId && ended.length > 0,
    };
  });
}
