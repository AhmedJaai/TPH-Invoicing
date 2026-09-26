"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { Trash2 } from "lucide-react";
import { buttonClass } from "./ui";

/**
 * تسجيلُ هدرٍ — **داخل الجرد، حيث يُتذكَّر**.
 *
 * ولا مساحةَ عليا له: لو صار وجهةً تُزار لَما زارها أحد، فيبقى الجدولُ
 * فارغاً و«الفرقُ غير المفسَّر» يشمل ما هو مفسَّر. أمّا هنا فيُفتَح
 * وصاحبُ المقهى ينظر إلى صنفٍ نقص، فيقول «منه كيلو انسكب».
 *
 * **وتسجيلُه لا يزيد شيئاً ولا ينقصه من الرفّ** — ينقل كمّيّةً من
 * «فرقٍ غير مفسَّر» إلى «هدرٍ مسجَّل». وذاك هو الفرقُ كلُّه: الأوّل
 * سؤالٌ مفتوح، والثاني جوابٌ مكتوب.
 */
const REASONS = [
  { value: "EXPIRED", label: "انتهت صلاحيّته" },
  { value: "SPILLED", label: "انسكب" },
  { value: "FAILED_PREP", label: "تحضيرٌ فاشل" },
  { value: "CALIBRATION", label: "معايرةُ الماكينة" },
  { value: "STAFF_DRINK", label: "مشروبُ موظَّف" },
  { value: "DAMAGED", label: "تلف" },
  { value: "OTHER", label: "سببٌ آخر" },
];

export function InventoryWaste({
  countId,
  branchId,
  defaultDate,
  items,
  canEdit,
}: {
  countId: string;
  branchId: string | null;
  defaultDate: string;
  items: { id: string; name: string; baseUnit: string; unitLabel: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [occurredOn, setOccurredOn] = useState(defaultDate);
  const [reason, setReason] = useState("SPILLED");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const item = items.find((i) => i.id === productId);

  async function submit() {
    if (!item) return;
    setBusy(true);
    setFailed(false);
    setMessage(null);

    const r = await postJson("/api/inventory/waste", {
      action: "waste",
      productId,
      quantity: quantity.trim(),
      unit: item.baseUnit,
      occurredOn,
      reason,
      note: note.trim() || null,
      branchId,
      countId,
    });

    setBusy(false);
    if (!r.ok) {
      setFailed(true);
      setMessage(r.error);
      return;
    }
    setMessage(String(r.data.message ?? "سُجّل."));
    setQuantity("");
    setNote("");
    router.refresh();
  }

  if (!canEdit) return null;

  return (
    <div className="rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
      <h3 className="flex items-center gap-2 text-sm font-bold">
        <Trash2 className="h-4 w-4 text-muted" strokeWidth={2} aria-hidden />
        سجِّل هدراً تعرفه
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        ما تُسجّله هنا يخرج من «الفرق غير المفسَّر» ويُعرَض باسمه. وما لا تعرف سببه
        يبقى سؤالاً مفتوحاً — ولا يُسمّى هدراً.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="block text-[11px] text-muted">الصنف</span>
          <select
            value={productId} onChange={(e) => setProductId(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-line-input bg-raised px-2 text-xs"
          >
            <option value="">اختر…</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
        <label className="w-28">
          <span className="block text-[11px] text-muted">الكمّيّة {item ? `(${item.unitLabel})` : ""}</span>
          <input
            type="text" inputMode="decimal" dir="ltr"
            value={quantity} onChange={(e) => setQuantity(e.target.value)}
            className="nums mt-1 min-h-11 w-full rounded-lg border border-line-input bg-raised px-2 text-center text-sm"
          />
        </label>
        <label className="w-40">
          <span className="block text-[11px] text-muted">السبب</span>
          <select
            value={reason} onChange={(e) => setReason(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-line-input bg-raised px-2 text-xs"
          >
            {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <label className="w-36">
          <span className="block text-[11px] text-muted">التاريخ</span>
          <input
            type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)}
            className="nums mt-1 min-h-11 w-full rounded-lg border border-line-input bg-raised px-2 text-sm"
          />
        </label>
        <input
          type="text" value={note} onChange={(e) => setNote(e.target.value)}
          aria-label="ملاحظة على هذا الهدر"
          placeholder="ملاحظة (اختياريّة)"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-input bg-raised px-3 text-xs"
        />
        <button
          aria-busy={busy}
          type="button" onClick={submit}
          disabled={busy || !productId || quantity.trim() === ""}
          className={buttonClass("primary")}
        >
          سجِّل الهدر
        </button>
      </div>

      {message && <p role={failed ? "alert" : "status"} className={`mt-2 text-xs ${failed ? "text-danger" : "text-ok"}`}>{message}</p>}
    </div>
  );
}
