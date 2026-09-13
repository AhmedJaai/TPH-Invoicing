"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";

/** رفضٌ بخطوتين: الضغطة الأولى تسأل، والثانية ترفض — ولا يُحذف الملفّ. */
export function RejectDocument({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!asking) {
    return (
      <button type="button" className={buttonClass("quiet", "sm")} onClick={() => setAsking(true)}>
        ارفضه
      </button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        disabled={busy}
        className={buttonClass("danger", "sm")}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await postJson("/api/document-status", { documentId });
          setBusy(false);
          if (!r.ok) { setError(r.error); return; }
          router.refresh();
        }}
      >
        {busy ? "يرفض…" : "نعم، ارفضه"}
      </button>
      <button type="button" className={buttonClass("quiet", "sm")} onClick={() => setAsking(false)}>
        إلغاء
      </button>
      {error && <span className="text-[11px] text-danger" role="alert">{error}</span>}
    </span>
  );
}
