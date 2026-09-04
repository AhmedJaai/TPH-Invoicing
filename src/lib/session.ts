/** مساعدات الجلسة للواجهات البرمجية وصفحات الخادم. */
import { auth } from "@/auth";
import { can, ForbiddenError, type Capability, type Role } from "./permissions";
import { previewAllowed } from "./preview-mode";

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

export async function currentUser(): Promise<CurrentUser | null> {
  if (isAuthBypassed()) return TRIAL_USER;

  const session = await auth();
  if (!session?.user?.id || !session.user.email) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
  };
}

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
