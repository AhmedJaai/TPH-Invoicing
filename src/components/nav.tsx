import Link from "next/link";
import { can, type Role } from "@/lib/permissions";

/**
 * التنقّل حول عمل صاحب المقهى لا حول جداول القاعدة.
 *
 * كانت عشر صفحات مسطّحة بأسماء تقنية — «التدقيق» و«التحليل» — يفتحها
 * المستخدم واحدةً واحدة ليعرف إن كان فيها شيء. صارت ستّ مساحات، لكلٍّ
 * منها سؤال يجيب عنه.
 */
const LINKS: { href: string; label: string; needs?: Parameters<typeof can>[1] }[] = [
  { href: "/", label: "الرئيسية" },
  { href: "/attention", label: "يحتاج انتباهك", needs: "reports:view" },
  { href: "/purchases", label: "المشتريات", needs: "amounts:view" },
  { href: "/money", label: "المال", needs: "bank:view" },
  { href: "/performance", label: "الأداء", needs: "amounts:view" },
  { href: "/documents", label: "المستندات" },
  { href: "/settings", label: "الإعدادات", needs: "supplier:view" },
];

export function Nav({ role, active }: { role: Role; active: string }) {
  const visible = LINKS.filter((l) => !l.needs || can(role, l.needs));

  return (
    <nav className="flex items-center gap-1 overflow-x-auto">
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

      {/* الرفع فعلٌ لا مساحة — فيبقى ظاهراً وممتازاً عن بقيّة الروابط */}
      {can(role, "document:upload") && (
        <Link
          href="/upload"
          className={`ms-1 shrink-0 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
            active === "/upload"
              ? "border-ink bg-inverse-surface text-inverse-ink"
              : "border-line hover:border-ink-soft"
          }`}
        >
          + رفع
        </Link>
      )}
    </nav>
  );
}
