"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";

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
      const r = await postJson<{ message?: string }>("/api/expense-actual", { action: "derive", month });
      if (!r.ok) {
        setFailed(true);
        setMessage(r.error);
      } else {
        setMessage(r.data.message ?? "تمّ");
        router.refresh();
      }
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
        className={buttonClass("secondary", "sm")}
      >
        {busy ? "يشتقّ…" : month ? `اشتقّ من كشف ${month}` : "اشتقّ من كشف البنك"}
      </button>
      {message && (
        <span className={`text-[11px] ${failed ? "text-danger" : "text-muted"}`}>{message}</span>
      )}
    </span>
  );
}
