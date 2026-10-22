"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { toast } from "./ui-client";

/**
 * سدادٌ من مالك: من تحويلات المقهى إليك (يُخصم منها في «كم ربحت؟») أم من مالك الخاصّ
 * (لا يُخصم)؟ تقرّره لكلّ سدادٍ بعينه — والأصلُ «من مالي الخاص» فلا يتغيّر رقمٌ بلا قرارك.
 */
export function OwnerPaymentSource({ paymentId, fromTransfers }: { paymentId: string; fromTransfers: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(fromTransfers);
  const [busy, setBusy] = useState(false);

  async function choose(next: boolean) {
    if (next === value || busy) return;
    setBusy(true);
    const res = await postJson("/api/owner-payment-source", { paymentId, fromTransfers: next });
    setBusy(false);
    if (!res.ok) {
      toast({ tone: "danger", title: "لم يُحفظ", body: res.error });
      return;
    }
    setValue(next);
    toast({
      tone: "ok",
      title: next ? "يُخصم من تحويلات المقهى إليك" : "من مالك الخاص",
      body: next ? "لن يُحسب المبلغ مرتين في «كم ربحت؟»." : "لا يُخصم شيء من التحويلات.",
    });
    router.refresh();
  }

  return (
    <span role="radiogroup" aria-label="من أين سدّدتها" aria-busy={busy} className="mt-1 inline-flex rounded-full border border-line bg-raised p-0.5 text-[11px]">
      {([[false, "من مالي الخاص"], [true, "من تحويلات المقهى"]] as const).map(([v, label]) => (
        <button
          key={label}
          type="button"
          role="radio"
          aria-checked={value === v}
          disabled={busy}
          onClick={() => void choose(v)}
          className={`min-h-8 rounded-full px-2.5 ${value === v ? "bg-accent font-bold text-accent-ink" : "text-ink-soft"}`}
        >
          {label}
        </button>
      ))}
    </span>
  );
}
