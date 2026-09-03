/**
 * تسجيل الدخول بجوجل.
 *
 * الدخول مقصور على قائمة بيضاء صريحة في ALLOWED_EMAILS — لا يكفي امتلاك
 * حساب جوجل. والدور يُقرأ من القائمة عند أول دخول ويُخزَّن في قاعدة البيانات،
 * فتغييره لاحقاً يتم من النظام لا من متغيّر البيئة.
 *
 * نطاق drive مطلوب لأن الرفع يتم بصلاحية المستخدم نفسه، وليظهر في سجل
 * نشاط الدرايف من رفع ماذا.
 */
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { allowlist, type Role } from "@/lib/permissions";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),

  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: `openid email profile ${DRIVE_SCOPE}`,
          // إجباريان للحصول على refresh token يبقى بعد انتهاء الجلسة
          access_type: "offline",
          prompt: "consent",
        },
      },
      allowDangerousEmailAccountLinking: false,
    }),
  ],

  session: { strategy: "database" },
  pages: { signIn: "/login", error: "/login" },

  callbacks: {
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;

      const list = allowlist();
      if (!list.has(email)) return false;

      // المستخدم المعطَّل في النظام يُمنع ولو بقي في القائمة البيضاء
      const [existing] = await db
        .select({ isActive: users.isActive })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      return existing ? existing.isActive : true;
    },

    async session({ session, user }) {
      const [row] = await db
        .select({ role: users.role, isActive: users.isActive })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);

      session.user.id = user.id;
      session.user.role = (row?.role as Role) ?? "PURCHASING";
      return session;
    },
  },

  events: {
    /** أول دخول: نثبّت الدور من القائمة البيضاء مرة واحدة. */
    async createUser({ user }) {
      const email = user.email?.toLowerCase();
      if (!email || !user.id) return;
      const role = allowlist().get(email);
      if (!role) return;
      await db.update(users).set({ role }).where(eq(users.id, user.id));
    },
  },

  trustHost: true,
});
