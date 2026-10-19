"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileX } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";
import { toast } from "./ui-client";
import { T } from "@/components/i18n/t";

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
          toast({ tone: "ok", title: "حُفظ: المورّد لا يصدر كشوف حساب", body: "لن نطلب منه كشف حساب بعد اليوم، ويمكنك تغيير ذلك من صفحته." });
          router.refresh();
        }}
      >
        <T s="{0}لا يصدر كشوف حساب" a={[<FileX key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></button>
      {error && <span className="text-[11px] font-bold text-danger" role="alert">{error}</span>}
    </span>
  );
}
