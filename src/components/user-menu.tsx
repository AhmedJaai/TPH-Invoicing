import { signOut } from "@/auth";
import { ROLE_LABEL, type Role } from "@/lib/permissions";

export function UserMenu({ name, role }: { name?: string | null; role: Role }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="text-left">
        <p className="max-w-[9rem] truncate text-xs font-medium">{name ?? "مستخدم"}</p>
        <p className="text-[10px] text-muted">{ROLE_LABEL[role]}</p>
      </div>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button
          type="submit"
          className="rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-soft hover:border-ink-soft"
        >
          خروج
        </button>
      </form>
    </div>
  );
}
