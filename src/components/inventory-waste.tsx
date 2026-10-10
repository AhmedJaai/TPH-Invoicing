"use client";

import { DateChips } from "./date-chips";
import { useRef, useState } from "react";
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

/** هدرٌ مسجَّل في أسبوع هذا الجرد — يُعرَض ليُراجَع ويُبطَل إن أخطأ صاحبُه. */
export interface WasteRow {
  id: string;
  productName: string;
  occurredOn: string;
  quantityText: string;
  reason: string;
  note: string | null;
}

/** مفتاحٌ لكلّ نموذج — يتجدّد بعد نجاح التسجيل، فالضغطتان على شبكةٍ بطيئة سطرٌ واحد. */
function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function InventoryWaste({
  countId,
  branchId,
  defaultDate,
  items,
  recorded,
  canEdit,
}: {
  countId: string;
  branchId: string | null;
  defaultDate: string;
  items: { id: string; name: string; baseUnit: string; unitLabel: string }[];
  /** ما سُجّل في هذا الأسبوع ولم يُبطَل. */
  recorded: WasteRow[];
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
  const requestId = useRef<string | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);

  const item = items.find((i) => i.id === productId);

  async function voidIt(id: string) {
    setBusy(true);
    setVoidError(null);
    const r = await postJson("/api/inventory/waste", { action: "void", wasteId: id, reason: voidReason.trim(), countId });
    setBusy(false);
    if (!r.ok) { setVoidError(r.error); return; }
    setVoiding(null);
    setVoidReason("");
    setFailed(false);
    setMessage(String(r.data.message ?? "أُبطل."));
    router.refresh();
  }

  async function submit() {
    if (!item || busy) return;
    /* المفتاحُ يبقى ما بقي الطلبُ نفسُه — فإعادةُ المحاولة بعد انقطاعٍ لا تكتب مرّتين */
    requestId.current ??= newRequestId();
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
      clientRequestId: requestId.current,
    });

    setBusy(false);
    if (!r.ok) {
      setFailed(true);
      setMessage(r.error);
      return;
    }
    requestId.current = null;
    setMessage(String(r.data.message ?? "سُجّل."));
    setQuantity("");
    setNote("");
    router.refresh();
  }

  if (!canEdit) return null;

  /* تغييرُ ما في النموذج طلبٌ آخر — فمفتاحُه آخر */
  const edit = <T,>(set: (v: T) => void) => (v: T) => { requestId.current = null; set(v); };

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

      {/* نموذجٌ حقيقيّ: Enter في حقل الكمّيّة يسجّل، و«تمّ» في لوحة مفاتيح الهاتف كذلك */}
      <form
        onSubmit={(e) => { e.preventDefault(); if (productId && quantity.trim() !== "") void submit(); }}
        className="mt-3 flex flex-wrap items-end gap-2"
      >
        <label className="min-w-0 flex-1">
          <span className="block text-[11px] text-muted">الصنف</span>
          <select
            value={productId} onChange={(e) => edit(setProductId)(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-line-input bg-raised px-2 text-xs"
          >
            <option value="">اختر…</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
        <label className="w-28">
          <span className="block text-[11px] text-muted">الكمّيّة {item ? `(${item.unitLabel})` : ""}</span>
          <input
            type="text" inputMode="decimal" dir="ltr" enterKeyHint="done"
            value={quantity} onChange={(e) => edit(setQuantity)(e.target.value)}
            className="nums mt-1 min-h-11 w-full rounded-lg border border-line-input bg-raised px-2 text-center text-sm"
          />
        </label>
        <label className="w-40">
          <span className="block text-[11px] text-muted">السبب</span>
          <select
            value={reason} onChange={(e) => edit(setReason)(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-line-input bg-raised px-2 text-xs"
          >
            {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <label className="min-w-36">
          <span className="block text-[11px] text-muted">التاريخ</span>
          <input
            type="date" value={occurredOn} onChange={(e) => edit(setOccurredOn)(e.target.value)}
            className="nums mt-1 block min-h-11 w-36 rounded-lg border border-line-input bg-raised px-2 text-sm"
          />
          <DateChips value={occurredOn} onPick={edit(setOccurredOn)} hijri={false} />
        </label>
        <input
          type="text" value={note} onChange={(e) => setNote(e.target.value)}
          aria-label="ملاحظة على هذا الهدر"
          placeholder="ملاحظة (اختياريّة)"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-input bg-raised px-3 text-xs"
        />
        <button
          aria-busy={busy}
          type="submit"
          disabled={busy || !productId || quantity.trim() === ""}
          className={buttonClass("primary")}
        >
          سجِّل الهدر
        </button>
      </form>

      {message && <p role={failed ? "alert" : "status"} className={`mt-2 text-xs ${failed ? "text-danger" : "text-ok"}`}>{message}</p>}

      {/*
        ── ما سُجّل، وبجانبه «أبطِل» ──

        من كتب «٥٠٠» بدل «٥٠» يُبطل السطرَ بسببه ويكتب الصحيح. والمُبطَلُ يبقى
        في سجلّ الصنف ويخرج من الحساب.
      */}
      {recorded.length > 0 && (
        <div className="mt-4 border-t border-line-soft pt-3">
          <h4 className="text-xs font-bold">هدرُ هذا الأسبوع المسجَّل</h4>
          <ul className="mt-2 space-y-1.5 text-xs">
            {recorded.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="nums text-muted">{w.occurredOn}</span>
                <span className="font-bold">{w.productName}</span>
                <span className="nums font-bold">{w.quantityText}</span>
                <span className="text-muted">
                  {REASONS.find((r) => r.value === w.reason)?.label ?? w.reason}
                  {w.note && ` · ${w.note}`}
                </span>
                {voiding !== w.id && (
                  <button
                    type="button" disabled={busy}
                    onClick={() => { setVoiding(w.id); setVoidReason(""); setVoidError(null); }}
                    className={buttonClass("quiet", "sm")}
                  >
                    أبطِله
                  </button>
                )}
                {voiding === w.id && (
                  <span className="flex w-full flex-wrap items-center gap-2">
                    <input
                      type="text" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} autoFocus
                      placeholder="سببُ الإبطال" aria-label="سببُ الإبطال"
                      className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-input bg-raised px-3 text-sm"
                    />
                    <button
                      aria-busy={busy} type="button"
                      disabled={busy || voidReason.trim().length < 3}
                      onClick={() => void voidIt(w.id)}
                      className={buttonClass("danger", "sm")}
                    >
                      أبطِل الهدر
                    </button>
                    <button type="button" disabled={busy} onClick={() => setVoiding(null)} className={buttonClass("quiet", "sm")}>تراجع</button>
                    {voidError && <span role="alert" className="w-full text-danger">{voidError}</span>}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
