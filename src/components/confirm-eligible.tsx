"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";

/**
 * «اعتمد ما اجتمعت فيه الشروط» — لما انتظر قبل أن توجد القاعدة.
 *
 * الخادمُ يعيد الحكم على كلّ مستند ولا يأخذ من المتصفّح قائمة: فما تغيّر
 * بين عرض الصفحة والضغط (مورّدٌ عُدّل رقمُه، مستندٌ حُسم من نافذةٍ أخرى)
 * يُحكَم عليه كما هو الآن.
 */
export function ConfirmEligible({ count }: { count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        className={buttonClass("primary", "sm")}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await postJson<{ message?: string }>("/api/document-status", { action: "confirm-eligible" });
          setBusy(false);
          if (!r.ok) { setError(r.error); return; }
          toast({ tone: "ok", title: "حُسم ما اجتمعت فيه الشروط", body: r.data.message ?? "اعتُمدت" });
          router.refresh();
        }}
      >
        <CheckCheck className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
        {busy ? "يعتمد…" : count === 1 ? "اعتمده" : "اعتمدها كلَّها"}
      </button>
      {error && <span role="alert" className="text-[11px] font-bold text-danger">{error}</span>}
    </span>
  );
}
