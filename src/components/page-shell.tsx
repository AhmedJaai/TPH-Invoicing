import { Nav } from "./nav";
import { UserMenu } from "./user-menu";
import type { Role } from "@/lib/permissions";

export function PageShell({
  user,
  active,
  title,
  intro,
  children,
}: {
  user: { name?: string | null; role: Role };
  active: string;
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="mx-auto max-w-5xl px-5 py-3">
          <div className="flex items-center justify-between gap-4">
            <p className="truncate font-display text-base font-bold leading-tight">
              فواتير ذا بوبليك هاوس
            </p>
            <UserMenu name={user.name} role={user.role} />
          </div>
          <div className="mt-2.5">
            <Nav role={user.role} active={active} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-8">
        <h1 className="font-display text-2xl font-black leading-tight sm:text-3xl">{title}</h1>
        {intro && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">{intro}</p>}
        <div className="mt-7">{children}</div>
      </main>
    </div>
  );
}

export function Empty({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-5 py-10 text-center">
      <p className="text-sm text-muted">{message}</p>
    </div>
  );
}

export function Money({ minor, tone }: { minor: number; tone?: "warn" | "danger" | "ok" }) {
  const cls = tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : tone === "ok" ? "text-ok" : "";
  const whole = Math.floor(Math.abs(minor) / 100);
  const frac = String(Math.abs(minor) % 100).padStart(2, "0");
  const digits = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (
    <span className={`nums ${cls}`} dir="ltr">
      {minor < 0 ? "-" : ""}
      {digits}.{frac}
    </span>
  );
}
