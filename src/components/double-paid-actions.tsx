"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, CircleAlert, MessageCircle, RotateCcw } from "lucide-react";
import { buttonClass } from "./ui";
import { ConfirmAction, toast } from "./ui-client";
import { postJson } from "@/lib/http-client";

/**
 * أفعالُ «سُدّد مرّتين» — رسالة المطالبة، ثمّ قرارُ صاحب العمل.
 *
 * كان القسم يقول «يُطالَب به الجهة» ولا يعطي رسالةً ولا زرّاً، والتنبيه
 * يبقى حرجاً في رأس القائمة مهما فعل. فالرسالة بالمرجعين والمبلغ تُرسَل
 * كما هي، والقرار ثلاثة: «طالبتُ» يُبقيه أهدأ، و«استُردّ» و«ليس
 * ازدواجاً» يُغلقانه — وكلّها تُردّ بـ«أعد فتحه» أو بـ«تراجع» في الإشعار.
 */
type Decision = "CLAIMED" | "RECOVERED" | "NOT_DUPLICATE";

export function DoublePaidActions({
  transactionIds,
  decision,
  claimText,
  canEdit,
}: {
  transactionIds: string[];
  decision: Decision | null;
  claimText: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
    القرارُ يُكتب ثمّ يُعلَن — لا يُعرَض متفائلاً. وكلُّ قرارٍ هنا يُردّ:
    فالإشعارُ يحمل «تراجع» يعيد القرارَ السابق كما كان (أو يفتحه إن لم
    يكن)، والخادمُ يُعيد فحصَ المجموعة في الحالين.
  */
  async function send(next: Decision | "OPEN") {
    return postJson<{ message?: string }>("/api/alert-resolve", { transactionIds, decision: next });
  }

  async function decide(next: Decision | "OPEN"): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const r = await send(next);
      if (!r.ok) {
        setError(r.error);
        return false;
      }
      const previous: Decision | "OPEN" = decision ?? "OPEN";
      toast({
        tone: next === "OPEN" ? "info" : "ok",
        title: r.data.message ?? "حُفظ",
        body: "كُتب القرارُ في سجلّ التدقيق باسمك.",
        undo: {
          run: async () => {
            const u = await send(previous);
            if (u.ok) router.refresh();
            return u.ok;
          },
        },
      });
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  const closed = decision === "RECOVERED" || decision === "NOT_DUPLICATE";

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        {!closed && (
          <a
            href={`https://wa.me/?text=${encodeURIComponent(claimText)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass(decision === null ? "primary" : "secondary", "sm")}
          >
            <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
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
            <Check className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
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
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            {busy ? "يحفظ…" : "أعد فتحه"}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 rounded-lg border border-danger/25 bg-danger-bg px-3 py-2 text-[11px] font-bold text-danger">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
