"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";

/**
 * «أين نقدُ الصندوق؟» — جوابُ المالك بضغطة. يغيّر تفسيرَ الأرقام لا الأرقام: محفوظٌ عنده ليس
 * تكلفةً غائبة، وما يُصرف منه يُدخَل في «ما لا يظهر في الكشف». وضريبتُه مستحقّةٌ في الحالين.
 */
export function CashCustodyChoice({ value }: { value: "OWNER_HOLDS" | "SPENT" | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function choose(next: "OWNER_HOLDS" | "SPENT" | null) {
    setBusy(true);
    const r = await postJson<{ message?: string }>("/api/app-setting", { setting: "cash-custody", value: next });
    setBusy(false);
    if (!r.ok) { toast({ tone: "danger", title: "تعذّر الحفظ", body: r.error }); return; }
    toast({ tone: "ok", title: r.data.message ?? "حُفظ" });
    router.refresh();
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="أين نقد الصندوق">
      <span className="text-xs font-bold text-ink">أين هذا النقد؟</span>
      {([["OWNER_HOLDS", "عندي نقداً ولم يُصرف"], ["SPENT", "يُصرف منه على المقهى"]] as const).map(([v, label]) => (
        <button key={v} type="button" disabled={busy} aria-pressed={value === v} onClick={() => void choose(value === v ? null : v)}
          className={`${buttonClass(value === v ? "primary" : "secondary", "sm")}`}>
          {label}
        </button>
      ))}
    </div>
  );
}
