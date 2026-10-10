"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { normalizeArabic } from "@/lib/search";
import { Popover } from "./ui-client";

/** فوق هذا العدد تصير القائمةُ لوحاً فيه بحث — ثلاثون مورّداً لا يُمرَّر فيهم. */
const SEARCH_ABOVE = 12;

/**
 * ترشيحٌ بقائمةٍ منسدلة — والوجهةُ رابطٌ يبنيه الخادم.
 *
 * كانت المرشِّحات صفوفاً من الشارات: ثلاثون مورّداً وخمسة أشهر وعشرة
 * أنواع، أربعةُ أسطرٍ تسبق أوّلَ مستند. والقائمةُ المنسدلة سطرٌ واحد،
 * والترشيحُ يبقى في العنوان فيُحفَظ ويُشارَك.
 *
 * الخياراتُ روابطُ جاهزة لا دالّة: مكوّنُ الخادم لا يمرّر دالّةً إلى المتصفّح.
 *
 * والقائمةُ الطويلة (المورّدون) لوحٌ فيه حقلُ بحثٍ بتطبيع العربيّة — القائمةُ
 * الأصليّة تطابق أوّلَ الحرف وحده، و«ال…» أوّلُ نصف الأسماء.
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
  /* التصفيةُ رحلةٌ إلى الخادم — والدوّارةُ مكانَ السهم تقول إنّها وصلت ولم تُنسَ */
  const [pending, start] = useTransition();
  const active = value !== "" && value !== options[0]?.value;
  const [q, setQ] = useState("");

  if (options.length > SEARCH_ABOVE) {
    const needle = normalizeArabic(q);
    const shown = needle ? options.filter((o) => normalizeArabic(o.label).includes(needle)) : options;
    const current = options.find((o) => o.value === value) ?? options[0];
    return (
      <Popover
        buttonLabel={`${label}: ${current?.label ?? ""}`}
        buttonClassName={`relative inline-flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-lg border ps-3 pe-2.5 text-[13px] font-bold transition-colors sm:min-h-9 ${
          active ? "border-accent-line bg-accent-soft text-accent" : "border-line-input bg-raised text-ink-soft hover:border-ink-soft"
        }`}
        button={
          <>
            <span className="truncate">{current?.label}</span>
            {pending
              ? <span aria-hidden className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-e-transparent opacity-70" />
              : <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={2} aria-hidden />}
          </>
        }
      >
        {(close) => (
          <div className="flex max-h-[min(22rem,60vh)] flex-col">
            <label className="relative flex items-center border-b border-line-soft p-2">
              <Search className="pointer-events-none absolute start-4 h-4 w-4 text-muted" strokeWidth={2} aria-hidden />
              <input
                type="search"
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`ابحث في ${label}`}
                aria-label={`ابحث في ${label}`}
                dir="auto"
                className="min-h-11 w-full rounded-lg border border-line-input bg-raised ps-8 pe-3 text-sm sm:min-h-9"
              />
            </label>
            <ul className="min-h-0 flex-1 overflow-y-auto p-1" aria-label={label}>
              {shown.length === 0 && <li className="px-3 py-3 text-xs text-muted">لا شيء يطابق «{q}».</li>}
              {shown.map((o) => (
                <li key={o.value}>
                  <button
                    type="button"
                    aria-current={o.value === value ? "true" : undefined}
                    onClick={() => {
                      close();
                      setQ("");
                      if (o.value !== value) start(() => router.push(o.href, { scroll: false }));
                    }}
                    className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-start text-[13px] hover:bg-hover sm:min-h-9 ${o.value === value ? "font-bold text-accent" : ""}`}
                  >
                    <span className="min-w-0 flex-1 truncate" dir="auto">{o.label}</span>
                    {o.value === value && <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Popover>
    );
  }

  return (
    <label
      aria-busy={pending || undefined}
      className={`relative inline-flex min-h-11 min-w-0 items-center rounded-lg border text-[13px] transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-(--ring) sm:min-h-9 ${
        active ? "border-accent-line bg-accent-soft text-accent" : "border-line-input bg-raised text-ink-soft hover:border-ink-soft"
      }`}
    >
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => {
          const next = options.find((o) => o.value === e.target.value);
          if (next) start(() => router.push(next.href, { scroll: false }));
        }}
        className="h-full min-h-11 w-full min-w-0 cursor-pointer appearance-none truncate bg-transparent ps-3 pe-8 font-bold outline-none sm:min-h-9"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {pending ? (
        <span aria-hidden className="pointer-events-none absolute end-2.5 h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-e-transparent opacity-70" />
      ) : (
        <ChevronDown className="pointer-events-none absolute end-2.5 h-3.5 w-3.5 opacity-70" strokeWidth={2} aria-hidden />
      )}
    </label>
  );
}
