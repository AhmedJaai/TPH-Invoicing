"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { describeRequested } from "@/lib/supplier-requests";
import { buttonClass } from "./ui-tokens";

/**
 * «اطلب الفاتورة (واتساب)» — يفتح الرسالةَ ويقيّد أنّه طولب.
 *
 * الرابطُ رابطٌ حقيقيّ (يُفتح ولو تعطّل القيد)، والقيدُ يُرسَل بجانبه ولا يُنتظر.
 * وإن فشل قيل بجانبه — الرسالةُ فُتحت، والأثرُ وحده لم يُحفظ. ومن لا يملك الكتابة
 * يفتح الرسالةَ بلا قيد.
 */
export function RequestInvoiceLink({
  href,
  supplierId,
  label,
  requestedDaysAgo,
  canMark,
}: {
  href: string;
  supplierId: string;
  label: string;
  /** كم يوماً مضى على آخر طلب — `null` لم يُطلَب. */
  requestedDaysAgo: number | null;
  canMark: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);

  function mark() {
    if (!canMark) return;
    setNote(null);
    void postJson("/api/supplier-request", { supplierId }).then((r) => {
      if (r.ok) router.refresh();
      else setNote(`فُتحت الرسالة، ولم يُقيَّد الطلب: ${r.error}`);
    });
  }

  return (
    <>
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={mark} className={buttonClass(requestedDaysAgo === null ? "primary" : "secondary", "sm")}>
        <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        {label}
      </a>
      {requestedDaysAgo !== null && (
        <span className="inline-flex items-center text-[11px] font-bold text-ink-soft">{describeRequested(requestedDaysAgo)}</span>
      )}
      {note && <span role="alert" className="basis-full text-[11px] font-bold text-warn">{note}</span>}
    </>
  );
}
