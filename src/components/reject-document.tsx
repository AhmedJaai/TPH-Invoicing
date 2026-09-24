"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";

/** رفضٌ بخطوتين: الضغطة الأولى تسأل، والثانية ترفض — ولا يُحذف الملفّ. */
export function RejectDocument({ documentId, cancel = false }: {
  documentId: string;
  /** مستندٌ معتمَد يُلغى — فاتورةٌ ألغاها المورّد. ويُكتَب السبب. */
  cancel?: boolean;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState(cancel ? "ألغاها المورّد" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!asking) {
    return (
      <button type="button" className={buttonClass("quiet", "sm")} onClick={() => setAsking(true)}>
        {cancel ? "ألغِ الفاتورة" : "ارفضه"}
      </button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="السبب (اختياريّ)"
        aria-label="سبب الرفض"
        className="min-h-11 w-44 rounded-lg border border-line bg-surface px-2 text-xs lg:min-h-9"
      />
      <button
        type="button"
        disabled={busy}
        className={buttonClass("danger", "sm")}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await postJson("/api/document-status", { documentId, reason: reason.trim() || undefined });
          setBusy(false);
          if (!r.ok) { setError(r.error); return; }
          router.refresh();
        }}
      >
        {busy ? "يرفض…" : cancel ? "نعم، ألغِها" : "نعم، ارفضه"}
      </button>
      <button type="button" className={buttonClass("quiet", "sm")} onClick={() => setAsking(false)}>
        إلغاء
      </button>
      {error && <span className="text-[11px] text-danger" role="alert">{error}</span>}
    </span>
  );
}
