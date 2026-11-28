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
  nextHref,
  keyAction = false,
}: {
  documentId: string;
  variant?: ButtonVariant;
  /** بعد النجاح: إلى التالي في الطابور بدل البقاء على ما حُسم. */
  nextHref?: string | null;
  /** في صفٍّ من طابور: `A` يضغطه، ثمّ تنتقل العلامةُ إلى ما يليه (`keyboard.tsx`). */
  keyAction?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button
        aria-busy={busy}
        type="button"
        disabled={busy}
        data-key-action={keyAction ? "approve" : undefined}
        data-key-then={keyAction ? "next" : undefined}
        aria-keyshortcuts={keyAction ? "A" : undefined}
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
            body: nextHref
              ? "دخلت فاتورته في المستحقات، وخُصم منها ما دفعته للمورّد مقدّماً. وفُتح لك التالي."
              : "دخلت فاتورته في المستحقات، وخُصم منها ما دفعته للمورّد مقدّماً.",
          });
          if (nextHref) router.replace(nextHref, { scroll: false });
          else router.refresh();
        }}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
        {ACT.approveDocument}
        {keyAction && <kbd aria-hidden className="hidden rounded border border-current/30 px-1 text-[10px] font-bold leading-4 opacity-70 lg:inline">A</kbd>}
      </button>
      {error && <span className="text-[11px] font-bold text-danger" role="alert">{error}</span>}
    </span>
  );
}
