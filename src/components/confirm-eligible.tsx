"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";

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
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        className={buttonClass("primary", "sm")}
        onClick={async () => {
          setBusy(true);
          setMessage(null);
          const r = await postJson<{ message?: string }>("/api/document-status", { action: "confirm-eligible" });
          setBusy(false);
          if (!r.ok) { setMessage({ ok: false, text: r.error }); return; }
          setMessage({ ok: true, text: r.data.message ?? "اعتُمدت" });
          router.refresh();
        }}
      >
        {busy ? "يعتمد…" : count === 1 ? "اعتمده" : "اعتمدها كلَّها"}
      </button>
      {message && (
        <span role="status" className={`text-[11px] ${message.ok ? "text-ok" : "text-danger"}`}>{message.text}</span>
      )}
    </span>
  );
}
