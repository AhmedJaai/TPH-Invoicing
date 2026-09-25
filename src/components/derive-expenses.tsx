"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { buttonClass, type ButtonVariant } from "./ui-tokens";
import { toast } from "./ui-client";

/**
 * اشتقاق المصروفات الفعلية من كشف البنك.
 *
 * قابلٌ للتكرار بلا ضرر: الحركة المقيَّدة لا تُقيَّد ثانيةً (فهرسٌ فريد في
 * القاعدة). ولذلك لا إقرار هنا — الزرّ الذي لا يُفسد شيئاً لا يحتاج تأكيداً.
 * والنتيجةُ تُقال في إشعار بعد ردّ الخادم، والفشلُ بجانب الزرّ.
 */
export function DeriveExpenses({
  month,
  variant = "secondary",
  label,
}: {
  month?: string;
  variant?: ButtonVariant;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<{ message?: string; created?: number }>("/api/expense-actual", { action: "derive", month });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast({ tone: (r.data.created ?? 0) > 0 ? "ok" : "info", title: r.data.message ?? "تمّ" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={run} disabled={busy} className={buttonClass(variant, "sm")}>
        <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} strokeWidth={2} aria-hidden />
        {busy ? "يقيّد من الكشف…" : label ?? "قيّد من كشف البنك"}
      </button>
      {error && <span role="alert" className="text-[11px] font-bold text-danger">{error}</span>}
    </span>
  );
}
