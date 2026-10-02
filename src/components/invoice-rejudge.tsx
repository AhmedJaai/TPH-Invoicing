"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";

/**
 * «أعِد الحكم» — الحالُ الضريبيّة المحفوظة تخالف حقولَ الفاتورة.
 *
 * لا يُرسل حقلاً: الخادمُ يعيد الحكم على ما في الصفّ (`correctInvoice`)
 * ويكتبه، والشهرُ المقفل يردّه بجملته.
 */
export function InvoiceRejudge({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const r = await postJson<{ taxStatus: string }>("/api/invoice-fields", { invoiceId });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast({ tone: r.data.taxStatus === "VALID" ? "ok" : "warn", title: "أُعيد الحكم على الفاتورة" });
    router.refresh();
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={run} disabled={busy} aria-busy={busy} className={buttonClass("secondary", "sm")}>
        <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden />
        {busy ? "يُعاد…" : "أعِد الحكم"}
      </button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </span>
  );
}
