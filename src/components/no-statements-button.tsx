"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";

/**
 * «لا يصدر كشوفاً» — يُعلَن مرّةً فلا يُطلَب منه كشفٌ بعدها (044).
 * ويُعاد من صفحة المورّد إن تغيّر حالُه.
 */
export function NoStatementsButton({ supplierId }: { supplierId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        disabled={busy}
        className={buttonClass("quiet", "sm")}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await postJson("/api/supplier-policy", { supplierId, issuesStatements: false });
          setBusy(false);
          if (!r.ok) { setError(r.error); return; }
          router.refresh();
        }}
      >
        {busy ? "يحفظ…" : "لا يصدر كشوفاً"}
      </button>
      {error && <span className="text-[11px] text-danger" role="alert">{error}</span>}
    </span>
  );
}
