"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { ConfirmAction } from "./ui-client";

/**
 * إخراجُ صنفٍ من الجرد.
 *
 * والاسمُ «أخرِجه» لا «احذفه» لأنّ الذي يقع إخراجٌ: بنودُ فواتيره
 * وحركاتُه وأسطرُ الجرد المقفَل تبقى كما هي. ولو سُمّي حذفاً لظنّ
 * صاحبُه أنّ تاريخَه ذهب معه.
 */
export function RetireItem({ productId, name }: { productId: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <ConfirmAction
        label="أخرِجه"
        title={`إخراجُ «${name}» من الجرد`}
        consequence={
          "يختفي من شاشة العدّ ومن قوائم مكوّنات الوصفات. ولا يُحذَف شيءٌ ممّا مضى:"
          + " بنودُ فواتيره وحركاتُه وأسطرُ الجرد المقفَل تبقى كما حُسبت."
        }
        acknowledgement="أفهم أنّه يخرج من العدّ القادم ويبقى تاريخُه."
        confirmLabel="أخرِجه"
        tone="warn"
        variant="secondary"
        onConfirm={async () => {
          const res = await postJson("/api/inventory/item", { action: "retire", productId });
          if (!res.ok) { setError(res.error); return false; }
          setError(null);
          router.refresh();
          return true;
        }}
      />
      {error && <p className="mt-1 text-[11px] leading-relaxed text-danger">{error}</p>}
    </>
  );
}
