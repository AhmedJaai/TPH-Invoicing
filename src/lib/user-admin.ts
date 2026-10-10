/**
 * قواعدُ إدارة المستخدمين — خالصة، والخدمةُ تقرأ وتكتب.
 *
 * كانت `users:manage` و`isActive` و`USER_ROLE_CHANGED` معرَّفةً ولا يكتبها مسار: لا
 * يُعطَّل مستخدم ولا يتغيّر دوره إلّا بتعديل `ALLOWED_EMAILS` وإعادة النشر أو بيدٍ في
 * القاعدة. فصار ذلك من «المستخدمون» في الإعدادات — والقاعدةُ الأولى ألّا يحبس المالكُ
 * نفسَه خارج نظامه: لا يغيّر دورَه ولا يعطّل نفسَه، ولا يُترك النظامُ بلا مالكٍ يدخل.
 *
 * **والقائمة البيضاء بابُ الدخول، والقاعدةُ صاحبةُ الدور**: الدورُ في `ALLOWED_EMAILS`
 * يُقرأ عند أوّل دخولٍ وحده. فمن خُفِّض هناك وبقي دورُه هنا يُعرَض اختلافُه — كان المالكُ
 * يظنّ أنّه خفّضه.
 */
import type { Role } from "./permissions";

export interface AdminUser {
  id: string;
  role: Role;
  isActive: boolean;
  /** في القائمة البيضاء اليوم — من ليس فيها لا يدخل مهما كان دورُه. */
  allowlisted: boolean;
}

export type UserChange =
  | { kind: "role"; role: Role }
  | { kind: "active"; active: boolean }
  | { kind: "end-sessions" };

export type UserChangeVerdict = { ok: true } | { ok: false; reason: string };

/** مالكٌ يستطيع الدخول: نشِطٌ وفي القائمة البيضاء. */
function canSignInAsOwner(u: AdminUser): boolean {
  return u.role === "OWNER" && u.isActive && u.allowlisted;
}

export function checkUserChange(
  actorId: string,
  target: AdminUser,
  change: UserChange,
  everyone: readonly AdminUser[],
): UserChangeVerdict {
  const self = target.id === actorId;

  if (change.kind === "end-sessions") return { ok: true };

  if (change.kind === "role") {
    if (change.role === target.role) return { ok: false, reason: "هذا دورُه الآن — لم يتغيّر شيء" };
    if (self) return { ok: false, reason: "لا تغيّر دورَك بنفسك — يغيّره مالكٌ آخر، كي لا تفقد إدارة النظام" };
  }
  if (change.kind === "active") {
    if (change.active === target.isActive) {
      return { ok: false, reason: change.active ? "حسابُه مفعَّل الآن" : "حسابُه معطَّل الآن" };
    }
    if (self && !change.active) return { ok: false, reason: "لا تعطّل حسابَك بنفسك — تُحبَس خارج النظام" };
  }

  /* بعد التغيير: أيبقى مالكٌ يدخل؟ */
  const after = everyone.map((u) => u.id !== target.id ? u : {
    ...u,
    role: change.kind === "role" ? change.role : u.role,
    isActive: change.kind === "active" ? change.active : u.isActive,
  });
  if (everyone.some(canSignInAsOwner) && !after.some(canSignInAsOwner)) {
    return { ok: false, reason: "هو المالكُ الوحيد الذي يستطيع الدخول — لا يُترك النظامُ بلا مالك" };
  }
  return { ok: true };
}

/** ما يُقال حين يخالف الدورُ هنا ما في قائمة الدخول — أو `null` إن اتّفقا. */
export function allowlistNote(dbRole: Role, listed: Role | undefined, roleLabel: Record<Role, string>): string | null {
  if (listed === undefined) return "ليس في قائمة الدخول (ALLOWED_EMAILS) — لا يستطيع الدخول";
  if (listed !== dbRole) {
    return `في قائمة الدخول «${roleLabel[listed]}» ودورُه هنا «${roleLabel[dbRole]}» — الدورُ هنا هو النافذ؛ القائمةُ تُقرأ عند أوّل دخولٍ وحده`;
  }
  return null;
}

/**
 * آخرُ نشاطٍ تقريباً من انتهاء الجلسة: الجلسةُ تمتدّ `maxAgeSeconds` من آخر تجديد،
 * وتُجدَّد مرّةً في اليوم — فالجوابُ «نحو» لا «تماماً». ولا جلسةَ = غير معروف.
 */
export function approxLastSeen(latestExpiry: Date | null, maxAgeSeconds: number): Date | null {
  return latestExpiry ? new Date(latestExpiry.getTime() - maxAgeSeconds * 1000) : null;
}
