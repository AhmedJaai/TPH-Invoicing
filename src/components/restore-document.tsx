"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";

/** «أعِده للمراجعة» — المرفوضُ يُقرأ من جديد ويُحكَم عليه كأيّ مستندٍ ينتظر. */
export function RestoreDocument({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        disabled={busy}
        className={buttonClass("secondary", "sm")}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await postJson("/api/document-status", { documentId, action: "restore" });
          if (r.ok) await postJson("/api/document-status", { action: "confirm-eligible" });
          setBusy(false);
          if (!r.ok) { setError(r.error); return; }
          router.refresh();
        }}
      >
        {busy ? "يعيده…" : "أعِده للمراجعة"}
      </button>
      {error && <span className="text-[11px] text-danger" role="alert">{error}</span>}
    </span>
  );
}
