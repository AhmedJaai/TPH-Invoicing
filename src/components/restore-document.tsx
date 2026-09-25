"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";

/** «أعِده للمراجعة» — المرفوضُ يُقرأ من جديد ويُحكَم عليه كأيّ مستندٍ ينتظر. */
export function RestoreDocument({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        disabled={busy}
        className={buttonClass("secondary", "sm")}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await postJson("/api/document-status", { documentId, action: "restore" });
          /* ثمّ يُحكَم عليه كأيّ مستندٍ ينتظر — فإن اجتمعت فيه الشروط دخل وحده */
          const then = r.ok ? await postJson<{ message?: string }>("/api/document-status", { action: "confirm-eligible" }) : null;
          setBusy(false);
          if (!r.ok) { setError(r.error); return; }
          toast({
            tone: "ok",
            title: "أُعيد المستند إلى المراجعة",
            body: then?.ok && then.data.message ? then.data.message : "تجده تحت «ينتظر المراجعة».",
          });
          router.refresh();
        }}
      >
        <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        {busy ? "يعيده…" : "أعِده للمراجعة"}
      </button>
      {error && <span className="text-[11px] font-bold text-danger" role="alert">{error}</span>}
    </span>
  );
}
