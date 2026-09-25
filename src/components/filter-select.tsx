"use client";

import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";

/**
 * ترشيحٌ بقائمةٍ منسدلة — والوجهةُ رابطٌ يبنيه الخادم.
 *
 * كانت المرشِّحات صفوفاً من الشارات: ثلاثون مورّداً وخمسة أشهر وعشرة
 * أنواع، أربعةُ أسطرٍ تسبق أوّلَ مستند. والقائمةُ المنسدلة سطرٌ واحد،
 * والترشيحُ يبقى في العنوان فيُحفَظ ويُشارَك.
 *
 * الخياراتُ روابطُ جاهزة لا دالّة: مكوّنُ الخادم لا يمرّر دالّةً إلى المتصفّح.
 */
export function FilterSelect({
  label,
  options,
  value,
}: {
  label: string;
  /** أوّلُها «الكلّ» — وهو ما يُعدّ غيرَ مرشَّح. */
  options: readonly { value: string; label: string; href: string }[];
  value: string;
}) {
  const router = useRouter();
  const active = value !== "" && value !== options[0]?.value;

  return (
    <label
      className={`relative inline-flex min-h-11 min-w-0 items-center rounded-lg border text-[13px] transition-colors sm:min-h-9 ${
        active ? "border-accent-line bg-accent-soft text-accent" : "border-line-input bg-raised text-ink-soft hover:border-ink-soft"
      }`}
    >
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => {
          const next = options.find((o) => o.value === e.target.value);
          if (next) router.push(next.href, { scroll: false });
        }}
        className="h-full min-h-11 w-full min-w-0 cursor-pointer appearance-none truncate bg-transparent ps-3 pe-8 font-bold outline-none sm:min-h-9"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute end-2.5 h-3.5 w-3.5 opacity-70" strokeWidth={2} aria-hidden />
    </label>
  );
}
