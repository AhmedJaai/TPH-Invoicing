import Link from "next/link";
import { Money } from "@/components/money";
import { TONE_TEXT, type Tone } from "@/components/ui";

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
  tone?: Tone;
  disabled?: boolean;
  /** سببُ التعطيل — البطاقة المعطَّلة بلا سبب تُحيّر. */
  disabledReason?: string;
}

export function HubGrid({ tiles }: { tiles: readonly HubTile[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((t) => {
        const cls = t.tone ? TONE_TEXT[t.tone] : "";

        const body = (
          <div className="flex h-full flex-col">
            <p className="text-sm font-bold leading-snug">{t.title}</p>
            <p className={`nums mt-2.5 font-display text-2xl font-bold leading-none ${cls}`}>
              {t.amountMinor !== undefined ? <Money minor={t.amountMinor} /> : t.value}
            </p>
            <p className="mt-2.5 text-[11px] leading-relaxed text-muted">{t.detail}</p>
            {t.disabled && t.disabledReason && (
              <p className="mt-2 text-[10px] text-muted">{t.disabledReason}</p>
            )}
          </div>
        );

        const box = "rounded-2xl border border-line bg-raised px-4 py-4 shadow-raised sm:px-5";
        return t.disabled ? (
          <div key={t.href} className={`${box} opacity-55`}>{body}</div>
        ) : (
          <Link
            key={t.href}
            href={t.href}
            className={`${box} group transition-all hover:border-ink-soft hover:shadow-lifted`}
          >
            {body}
          </Link>
        );
      })}
    </div>
  );
}
