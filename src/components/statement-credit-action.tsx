"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ReceiptText } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { toast } from "./ui-client";
import { buttonClass } from "./ui-tokens";

/**
 * «سجّله إشعاراً» بجانب دائنٍ في كشف المورّد بلا إشعار مسجَّل.
 *
 * يُرسل معرّفَ السطر وحده — المبلغُ والتاريخُ والمرجعُ يقرؤها الخادم من الكشف المحفوظ. وإن ردّ بأنّه
 * يشبه إشعاراً مسجّلاً صار الزرُّ «سجّله إشعاراً آخر» بسببه، فلا يُقيَّد مرّتين بسهو ولا يُمنَع ما أُقرّ.
 */
export function StatementCreditAction({ statementLineId }: { statementLineId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    const r = await postJson<{ message: string }>("/api/statement-credit", {
      statementLineId,
      ...(duplicate ? { acknowledgeDuplicate: true } : {}),
    });
    setBusy(false);
    if (!r.ok) {
      setDuplicate(r.status === 409 && r.data.duplicate === true);
      setError(r.error);
      return;
    }
    toast({ tone: "ok", title: "سُجّل الإشعار من الكشف", body: r.data.message });
    router.refresh();
  }

  return (
    <span className="flex flex-col items-end gap-1 text-end">
      <button type="button" onClick={run} disabled={busy} aria-busy={busy} className={`${buttonClass("secondary", "sm")} whitespace-nowrap`}>
        <ReceiptText className="h-4 w-4" strokeWidth={2} aria-hidden />
        {busy ? "يسجّل…" : duplicate ? "سجّله إشعاراً آخر" : "سجّله إشعاراً"}
      </button>
      {error && <span role="alert" className="max-w-64 text-[11px] leading-relaxed text-danger">{error}</span>}
    </span>
  );
}
