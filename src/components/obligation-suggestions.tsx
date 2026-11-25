"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { formatRiyalsDisplay } from "@/lib/money";
import { formatDay } from "@/lib/riyadh-time";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";
import type { ObligationSuggestion } from "@/lib/obligation-suggest";

/**
 * وثائقُ مقترحة من مدفوعاتك الحكوميّة — ضغطةٌ تضيفها بتاريخ تجديدٍ تقديريّ (سنةٌ بعد آخر سداد)،
 * ويُقال إنّه تقدير يُصحَّح من الشهادة. لا يُحفظ شيءٌ بلا ضغطة.
 */
export function ObligationSuggestions({ items }: { items: ObligationSuggestion[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  if (items.length === 0) return null;

  async function add(s: ObligationSuggestion) {
    setBusy(s.kind);
    const r = await postJson<{ message?: string }>("/api/obligation", {
      action: "create", kind: s.kind, title: s.title, issuer: s.issuer, expiresOn: s.expiresOn, remindDays: 30,
      note: `تاريخ التجديد تقدير: سنة بعد آخر سداد في ${formatDay(s.paidOn)} (${formatRiyalsDisplay(s.amountMinor)} ريال). صحّحه من الشهادة.`,
    });
    setBusy(null);
    if (!r.ok) { toast({ tone: "danger", title: "لم تُضف الوثيقة", body: r.error }); return; }
    toast({ tone: "ok", title: `أُضيفت «${s.title}»`, body: "صحّح تاريخ الانتهاء من الشهادة متى أمكن." });
    router.refresh();
  }

  return (
    <section aria-labelledby="ob-suggest" className="mb-6 rounded-2xl border border-accent-line bg-accent-soft/40 p-4 sm:p-5">
      <h2 id="ob-suggest" className="flex items-center gap-2 text-sm font-bold">
        <Sparkles className="h-4 w-4 text-accent" strokeWidth={2} aria-hidden /> من مدفوعاتك الحكومية
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">سدّدت رسوماً تُجدَّد كل سنة غالباً. أضفها بضغطة، ويذكّرك النظام قبل موعدها بثلاثين يوماً. التاريخ تقدير، فصحّحه من الشهادة.</p>
      <ul className="mt-3 space-y-2">
        {items.map((s) => (
          <li key={s.kind} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-raised px-4 py-3">
            <span className="min-w-0">
              <span className="block text-sm font-bold">{s.title}</span>
              <span className="block text-[11px] text-muted">آخر سداد {formatDay(s.paidOn)} · {formatRiyalsDisplay(s.amountMinor)} ريال · التجديد قرابة {formatDay(s.expiresOn)}</span>
            </span>
            <button type="button" onClick={() => void add(s)} disabled={busy !== null} aria-busy={busy === s.kind} className={buttonClass("secondary", "sm")}>أضفها</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
