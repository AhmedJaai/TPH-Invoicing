import Link from "next/link";
import { Money } from "@/components/page-shell";

/**
 * بطاقة قسم في صفحة جامعة.
 *
 * الصفحات الجامعة ليست قوائم روابط: كلٌّ منها يحمل رقمه الحيّ، فيعرف
 * صاحب العمل أين يذهب قبل أن يذهب. والرابط بلا رقم يجعله يفتح كل صفحة
 * ليرى إن كان فيها شيء.
 */
export interface HubTile {
  href: string;
  title: string;
  detail: string;
  value?: React.ReactNode;
  amountMinor?: number;
  tone?: "warn" | "danger" | "ok" | "muted";
  disabled?: boolean;
}

export function HubGrid({ tiles }: { tiles: readonly HubTile[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((t) => {
        const cls =
          t.tone === "warn" ? "text-warn" : t.tone === "danger" ? "text-danger"
          : t.tone === "ok" ? "text-ok" : t.tone === "muted" ? "text-muted" : "";

        const body = (
          <>
            <p className="text-sm font-bold">{t.title}</p>
            <p className={`mt-2 text-xl font-bold leading-none ${cls}`}>
              {t.amountMinor !== undefined ? <Money minor={t.amountMinor} /> : t.value}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">{t.detail}</p>
          </>
        );

        const box = "rounded-xl border border-line bg-raised px-4 py-3.5";
        return t.disabled ? (
          <div key={t.href} className={`${box} opacity-60`}>{body}</div>
        ) : (
          <Link key={t.href} href={t.href} className={`${box} transition-colors hover:border-ink-soft`}>
            {body}
          </Link>
        );
      })}
    </div>
  );
}
