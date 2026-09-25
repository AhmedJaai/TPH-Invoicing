"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { buttonClass, type ButtonVariant } from "./ui-tokens";
import { toast } from "./ui-client";
import { ACT } from "@/lib/ui-terms";

/**
 * «اعتمد المستند» لما قرأه النموذج — افتح الملفّ وقارن ثمّ اعتمد.
 * وحتى يُعتمَد لا تدخل فاتورتُه ملفّ التحويلات.
 *
 * والإشعارُ بعد ردّ الخادم لا قبله: الاعتمادُ يخصم رصيدَ المورّد، فلا
 * يُقال «اعتُمد» عن كتابةٍ ماليّة لم تقع.
 */
export function ConfirmDocument({
  documentId,
  variant = "secondary",
}: {
  documentId: string;
  variant?: ButtonVariant;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        disabled={busy}
        className={buttonClass(variant, "sm")}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await postJson("/api/document-status", { documentId, action: "confirm" });
          setBusy(false);
          if (!r.ok) { setError(r.error); return; }
          toast({
            tone: "ok",
            title: "اعتُمد المستند",
            body: "دخلت فاتورتُه المستحقَّ، وخُصم منها ما دفعتَه للمورّد مقدَّماً.",
          });
          router.refresh();
        }}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
        {busy ? "يعتمد…" : ACT.approveDocument}
      </button>
      {error && <span className="text-[11px] font-bold text-danger" role="alert">{error}</span>}
    </span>
  );
}
