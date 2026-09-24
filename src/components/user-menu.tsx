import { LogOut } from "lucide-react";
import { signOut } from "@/auth";
import { isAuthBypassed } from "@/lib/session";
import { ROLE_LABEL, type Role } from "@/lib/permissions";

/** المستخدمُ ودورُه والخروج — في ذيل الإطار على الحاسوب، وفي «المزيد» على الجوّال. */
export function UserMenu({ name, role, tone = "surface" }: { name?: string | null; role: Role; tone?: "frame" | "surface" }) {
  const frame = tone === "frame";
  const initial = (name ?? "م").trim().charAt(0);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <span
        aria-hidden
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-bold ${
          frame ? "bg-frame-raised text-frame-accent" : "bg-accent-soft text-accent"
        }`}
      >
        {initial}
      </span>
      <div className="min-w-0 flex-1 text-start">
        <p className={`truncate text-[13px] font-bold ${frame ? "text-frame-ink" : ""}`}>{name ?? "مستخدم"}</p>
        <p className={`text-[11px] ${frame ? "text-frame-muted" : "text-muted"}`}>{ROLE_LABEL[role]}</p>
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
            aria-label="اخرج من الحساب"
            title="اخرج"
            className={`grid h-11 w-11 place-items-center rounded-lg transition-colors sm:h-8 sm:w-8 ${
              frame ? "text-frame-muted hover:bg-frame-raised hover:text-frame-ink" : "text-muted hover:bg-hover hover:text-ink"
            }`}
          >
            <LogOut className="h-4 w-4" strokeWidth={2} aria-hidden />
          </button>
        </form>
      )}
    </div>
  );
}
