"use client";

import { useState } from "react";
import { Languages } from "lucide-react";
import { LOCALE_COOKIE, type Locale } from "@/lib/i18n/locale";

const OPTIONS: { value: Locale; label: string; lang: string }[] = [
  { value: "ar", label: "العربية", lang: "ar" },
  { value: "en", label: "English", lang: "en" },
];

/** يكتب الكعكةَ ويعيد التحميل — خارج المكوّن، فالمتصفّحُ لا حالُ React. */
function applyLocale(next: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  window.location.reload();
}

/**
 * زرُّ لغة الواجهة — في الإعدادات. يكتب الكعكةَ ثمّ يعيد تحميل الصفحة، لأنّ
 * الاتّجاهَ (`dir`) واللغةَ يُكتبان على `<html>` في الخادم قبل أوّل رسم.
 * واسمُ كلّ لغةٍ بلغتها، فيجد طريقَ العودة من لا يقرأ الأخرى.
 */
export function LanguageSwitch({ current }: { current: Locale }) {
  const [busy, setBusy] = useState(false);

  const choose = (next: Locale) => {
    if (next === current || busy) return;
    setBusy(true);
    applyLocale(next);
  };

  return (
    <div role="radiogroup" aria-label="لغة الواجهة" className="inline-flex gap-1 rounded-xl border border-line bg-raised p-1 shadow-raised" data-no-translate>
      {OPTIONS.map((o) => {
        const on = o.value === current;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            lang={o.lang}
            disabled={busy}
            onClick={() => choose(o.value)}
            className={`flex min-h-11 sm:min-h-10 items-center gap-2 rounded-lg px-4 text-sm font-bold transition-colors ${
              on ? "bg-accent text-accent-ink" : "text-ink-soft hover:bg-hover hover:text-ink"
            } disabled:opacity-60`}
          >
            {on && <Languages className="h-4 w-4" strokeWidth={2} aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
