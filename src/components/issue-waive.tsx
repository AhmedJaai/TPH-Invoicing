"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui-tokens";
import { ReadySubmit, toast } from "./ui-client";

/** «تجاوزه مع كتابة السبب» — لا يُرسل إلّا معرّفَ التنبيه وسببَه (`/api/issue-waive`). */
export function IssueWaive({ issueId }: { issueId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await postJson<{ message: string }>("/api/issue-waive", { issueId, reason });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast({ tone: "ok", title: r.data.message });
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("quiet", "sm")}>
        <CheckCheck className="h-3.5 w-3.5" aria-hidden />
        تجاوزه
      </button>
    );
  }
  return (
    <form onSubmit={run} className="flex w-full flex-wrap items-center gap-2">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="سبب التجاوز، مثل: الفاتورة لنا وأقررت بذلك"
        aria-label="سبب التجاوز"
        maxLength={300}
        autoFocus
        className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-raised px-3 text-xs sm:min-h-8"
      />
      <ReadySubmit ready={reason.trim().length >= 3} busy={busy} size="sm" missing="اكتب سبب التجاوز (ثلاثة أحرف على الأقل)، فهو يُحفظ مع القرار.">
        {busy ? "يحفظ…" : "تجاوزه"}
      </ReadySubmit>
      <button type="button" onClick={() => setOpen(false)} disabled={busy} className={buttonClass("quiet", "sm")}>تراجع</button>
      {error && <span role="alert" className="w-full text-xs text-danger">{error}</span>}
    </form>
  );
}
