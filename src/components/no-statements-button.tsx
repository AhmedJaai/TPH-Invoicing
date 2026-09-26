"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileX } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";
import { toast } from "./ui-client";

/**
 * «لا يصدر كشوفاً» — يُعلَن مرّةً فلا يُطلَب منه كشفٌ بعدها (044).
 * ويُعاد من صفحة المورّد إن تغيّر حالُه.
 */
export function NoStatementsButton({ supplierId }: { supplierId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button
        aria-busy={busy}
        type="button"
        disabled={busy}
        className={buttonClass("quiet", "sm")}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await postJson("/api/supplier-policy", { supplierId, issuesStatements: false });
          setBusy(false);
          if (!r.ok) { setError(r.error); return; }
          toast({ tone: "ok", title: "حُفظ: لا يصدر كشوفاً", body: "لن يُطلَب منه كشفٌ بعد اليوم — ويُعاد من صفحته إن تغيّر." });
          router.refresh();
        }}
      >
        <FileX className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        لا يصدر كشوفاً
      </button>
      {error && <span className="text-[11px] font-bold text-danger" role="alert">{error}</span>}
    </span>
  );
}
