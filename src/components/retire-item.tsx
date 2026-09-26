"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { ActionButton, toast } from "./ui-client";

/**
 * إخراجُ صنفٍ من الجرد — بضغطةٍ وتراجعٍ من الإشعار.
 *
 * والاسمُ «أخرِجه» لا «احذفه» لأنّ الذي يقع إخراجٌ: بنودُ فواتيره
 * وحركاتُه وأسطرُ الجرد المقفَل تبقى كما هي. ولأنّه تعطيلٌ يُعكَس تماماً
 * (`restoreStockItem`) فلا يُسأل «هل أنت متأكّد؟» — يقع، ويُعرض التراجع.
 * الإقرارُ لما لا رجعة فيه أو ما يمسّ المال وحدهما.
 */
export function RetireItem({ productId, name }: { productId: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <ActionButton
        variant="secondary"
        size="sm"
        showDone={false}
        onAction={async () => {
          const res = await postJson<{ message?: string }>("/api/inventory/item", { action: "retire", productId });
          if (!res.ok) { setError(res.error); return false; }
          setError(null);
          toast({
            tone: "ok",
            title: `أُخرج «${name}» من الجرد`,
            body: "لا يظهر في العدّ القادم، وتاريخُه باقٍ كما حُسب.",
            undo: {
              label: "أعِده",
              run: async () => {
                const back = await postJson("/api/inventory/item", { action: "restore", productId });
                if (!back.ok) return false;
                router.refresh();
                return true;
              },
            },
          });
          router.refresh();
          return true;
        }}
      >
        <Archive className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        <span>أخرِجه من الجرد</span>
      </ActionButton>
      {error && <p role="alert" className="mt-1 text-[11px] leading-relaxed text-danger">{error}</p>}
    </>
  );
}
