import Link from "next/link";
import { can, type Role } from "@/lib/permissions";

const LINKS: { href: string; label: string; needs?: Parameters<typeof can>[1] }[] = [
  { href: "/", label: "الرفع" },
  { href: "/dashboard", label: "لوحة القيادة", needs: "reports:view" },
  { href: "/audit", label: "التدقيق", needs: "amounts:view" },
  { href: "/analysis", label: "الاستهلاك", needs: "amounts:view" },
  { href: "/suppliers", label: "المورّدون" },
];

export function Nav({ role, active }: { role: Role; active: string }) {
  const visible = LINKS.filter((l) => !l.needs || can(role, l.needs));

  return (
    <nav className="flex gap-1 overflow-x-auto">
      {visible.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            active === l.href
              ? "bg-inverse-surface text-inverse-ink"
              : "text-ink-soft hover:bg-sunken"
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
