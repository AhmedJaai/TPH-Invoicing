/** مساعدات الجلسة للواجهات البرمجية وصفحات الخادم. */
import { auth } from "@/auth";
import { can, ForbiddenError, type Capability, type Role } from "./permissions";

export interface CurrentUser {
  id: string;
  email: string;
  name?: string | null;
  role: Role;
}

export async function currentUser(): Promise<CurrentUser | null> {
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
