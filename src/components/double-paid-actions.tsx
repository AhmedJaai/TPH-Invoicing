"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "./ui";
import { ConfirmAction } from "./ui-client";
import { postJson } from "@/lib/http-client";

/**
 * أفعالُ «سُدّد مرّتين» — رسالة المطالبة، ثمّ قرارُ صاحب العمل.
 *
 * كان القسم يقول «يُطالَب به الجهة» ولا يعطي رسالةً ولا زرّاً، والتنبيه
 * يبقى حرجاً في رأس القائمة مهما فعل. فالرسالة بالمرجعين والمبلغ تُرسَل
 * كما هي، والقرار ثلاثة: «طالبتُ» يُبقيه أهدأ، و«استُردّ» و«ليس
 * ازدواجاً» يُغلقانه — وكلّها تُردّ بـ«أعد فتحه».
 */
export function DoublePaidActions({
  transactionIds,
  decision,
  claimText,
  canEdit,
}: {
  transactionIds: string[];
  decision: "CLAIMED" | "RECOVERED" | "NOT_DUPLICATE" | null;
  claimText: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function decide(next: "CLAIMED" | "RECOVERED" | "NOT_DUPLICATE" | "OPEN"): Promise<boolean> {
    setBusy(true);
    setFailed(false);
    setMessage(null);
    try {
      const r = await postJson<{ message?: string }>("/api/alert-resolve", { transactionIds, decision: next });
      if (!r.ok) {
        setFailed(true);
        setMessage(r.error);
        return false;
      }
      setMessage(r.data.message ?? "حُفظ");
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  const closed = decision === "RECOVERED" || decision === "NOT_DUPLICATE";

  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {!closed && (
          <a
            href={`https://wa.me/?text=${encodeURIComponent(claimText)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass(decision === null ? "primary" : "secondary", "sm")}
          >
            رسالة مطالبة (واتساب)
          </a>
        )}
        {canEdit && decision === null && (
          <button type="button" disabled={busy} onClick={() => void decide("CLAIMED")} className={buttonClass("secondary", "sm")}>
            {busy ? "يحفظ…" : "طالبتُ الجهة"}
          </button>
        )}
        {canEdit && !closed && (
          <button type="button" disabled={busy} onClick={() => void decide("RECOVERED")} className={buttonClass("secondary", "sm")}>
            {busy ? "يحفظ…" : "استُردّ المال"}
          </button>
        )}
        {canEdit && !closed && (
          <ConfirmAction
            label="ليس ازدواجاً"
            variant="quiet"
            tone="warn"
            title="ليس سداداً مزدوجاً؟"
            consequence="يخرج هذا التنبيه من «يحتاج قرارك» ولا يُطالَب بالمال. استعمله حين تكون العمليّتان مستحقّتين فعلاً — فاتورتان بالمبلغ نفسه مثلاً. ويُكتب قرارك في سجلّ التدقيق باسمك، ويمكن فتحه ثانيةً."
            acknowledgement="تحقّقتُ أنّ المال خرج مرّتين عن حقّ"
            confirmLabel="نعم، ليس ازدواجاً"
            disabled={busy}
            onConfirm={() => decide("NOT_DUPLICATE")}
          />
        )}
        {canEdit && decision !== null && (
          <button type="button" disabled={busy} onClick={() => void decide("OPEN")} className={buttonClass("quiet", "sm")}>
            {busy ? "يحفظ…" : "أعد فتحه"}
          </button>
        )}
      </div>
      {message && (
        <p role="status" className={`mt-2 text-[11px] font-bold ${failed ? "text-danger" : "text-ok"}`}>{message}</p>
      )}
    </div>
  );
}
