import { cache } from "react";
/** مساعدات الجلسة للواجهات البرمجية وصفحات الخادم. */
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { can, ForbiddenError, type Capability, type Role } from "./permissions";
import { previewAllowed, previewRole } from "./preview-mode";

export interface CurrentUser {
  id: string;
  email: string;
  name?: string | null;
  role: Role;
}

/**
 * وضع التجربة: يتخطّى تسجيل الدخول ويعطي صلاحية المالك.
 *
 * للتجربة وحدها. متى كان مفعَّلاً، فكل من يعرف الرابط يدخل — فلا ترفع
 * فواتير حقيقية وهو مشتغل. يظهر شريط تحذير في كل صفحة كي لا يُنسى.
 *
 * ولا يعمل في الإنتاج مهما فُعِّل المتغيّر — راجع `preview-mode.ts`.
 */
export function isAuthBypassed(): boolean {
  return previewAllowed(process.env);
}

const TRIAL_USER: CurrentUser = {
  id: "trial-user",
  email: "trial@local",
  name: "وضع التجربة",
  role: "OWNER",
};

/**
 * هويّة وضع التجربة — تُستعار من مستخدمٍ قائم.
 *
 * كان `trial-user` معرّفاً مخترَعاً لا وجود له في جدول `users`، وكل
 * كتابةٍ تحمل `created_by_id` مقيَّدةٌ بمفتاحٍ أجنبيّ إليه. فوضع التجربة
 * يقرأ كلّ شيء ولا يكتب شيئاً: كل فعلٍ يكتب يسقط بـ‏500 وبرسالةٍ لا
 * تقول السبب. أي أنّ الوضع الذي بُني ليُجرَّب فيه النظام كان يمنع
 * تجربة نصفه.
 *
 * فيُؤخَذ أوّل مستخدمٍ حقيقيّ إن وُجد، ويُستعمَل معرّفه في القيود —
 * فيصير الأثر منسوباً إلى حسابٍ قائم، ويبقى الاسم المعروض «وضع
 * التجربة» كي لا يُظنّ أنّ صاحب الحساب هو من فعل.
 *
 * والنتيجة تُحفَظ لأنّ الجلسة الواحدة قد تستدعيها في كل طلب.
 */
let cachedTrialId: string | null = null;

async function trialUser(): Promise<CurrentUser> {
  const role = previewRole(process.env.AUTH_BYPASS_ROLE);
  if (cachedTrialId) return { ...TRIAL_USER, id: cachedTrialId, role };

  try {
    const { db } = await import("@/db");
    const { users } = await import("@/db/schema");
    const [row] = await db.select({ id: users.id }).from(users).limit(1);
    if (row?.id) {
      cachedTrialId = row.id;
      return { ...TRIAL_USER, id: row.id, role };
    }
  } catch {
    /* لا قاعدة في متناول اليد — يبقى المعرّف المخترَع، والقراءة تعمل */
  }
  return { ...TRIAL_USER, role };
}

/*
  مرّةً في الطلب: التخطيطُ يقرؤه للقشرة والصفحةُ لمحتواها — وكلٌّ منهما
  جلسةٌ واستعلامٌ عن حال المستخدم. و`cache` من React تجعلهما واحداً.
*/
export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  if (isAuthBypassed()) return await trialUser();

  const session = await auth();
  if (!session?.user?.id || !session.user.email) return null;

  /*
    المعطَّل لا يمرّ — ولا طلبُه الأوّل.

    مستدعي الجلسة في `auth.ts` يحذف جلسة المعطَّل ويُرجع جلسةً بلا مستخدم،
    لكنّ غلاف Auth.js يضمّ صفَّ المستخدم إلى ما يُرجعه، فكان الطلب الجاري
    يرى مستخدماً كاملاً بدوره: محاسبٌ عُطِّل كتب مصروفاً بعد تعطيله. فالحال
    تُقرأ هنا من القاعدة، في كلّ طلب.
  */
  const [row] = await db
    .select({ isActive: users.isActive })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!row?.isActive) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
  };
});

/** يرمي عند غياب الجلسة أو الصلاحية — تُترجم في الواجهة إلى 401 أو 403. */
export class UnauthenticatedError extends Error {
  constructor() {
    super("يلزم تسجيل الدخول");
    this.name = "UnauthenticatedError";
  }
}

export async function requireUser(capability?: Capability): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) throw new UnauthenticatedError();
  if (capability && !can(user.role, capability)) throw new ForbiddenError(capability);
  return user;
}
