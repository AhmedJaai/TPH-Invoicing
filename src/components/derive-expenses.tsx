"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * اشتقاق المصروفات الفعلية من كشف البنك.
 *
 * قابل للتكرار بلا ضرر: الحركة المقيَّدة لا تُقيَّد ثانيةً. ولذلك لا
 * تحذير هنا — الزرّ الذي لا يُفسد شيئاً لا يحتاج تأكيداً.
 */
export function DeriveExpenses({ month }: { month?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function run() {
    setBusy(true);
    setMessage(null);
    setFailed(false);
    try {
      const res = await fetch("/api/expense-actual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "derive", month }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setFailed(true);
        setMessage(data.error ?? "تعذّر الاشتقاق");
      } else {
        setMessage(data.message ?? "تمّ");
        router.refresh();
      }
    } catch {
      setFailed(true);
      setMessage("تعذّر الاتصال بالخادم");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold transition-colors hover:border-ink-soft disabled:opacity-50"
      >
        {busy ? "يشتقّ…" : month ? `اشتقّ من كشف ${month}` : "اشتقّ من كشف البنك"}
      </button>
      {message && (
        <span className={`text-[11px] ${failed ? "text-danger" : "text-muted"}`}>{message}</span>
      )}
    </span>
  );
}
