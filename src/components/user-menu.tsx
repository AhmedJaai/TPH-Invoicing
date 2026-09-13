import { signOut } from "@/auth";
import { isAuthBypassed } from "@/lib/session";
import { ROLE_LABEL, type Role } from "@/lib/permissions";

export function UserMenu({ name, role }: { name?: string | null; role: Role }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="text-start">
        <p className="max-w-[9rem] truncate text-xs font-medium">{name ?? "مستخدم"}</p>
        <p className="text-[11px] text-muted">{ROLE_LABEL[role]}</p>
      </div>
      {/* في وضع التجربة لا جلسة تُنهى، فإظهار زرّ خروج لا يعمل تضليل */}
      {!isAuthBypassed() && (
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            className="inline-flex min-h-11 items-center rounded-lg border border-line px-2.5 text-[11px] text-ink-soft hover:border-ink-soft sm:min-h-0 sm:py-1"
          >
            خروج
          </button>
        </form>
      )}
    </div>
  );
}
