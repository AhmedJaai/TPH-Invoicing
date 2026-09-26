"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";

/**
 * «أدخل الكمّيّة المستلَمة» — داخل سطر الصنف، لا في صفحةٍ أخرى.
 *
 * ── الكمّيّةُ أوّلاً ──
 *
 * «وصل ٢٠ كجم بنّ يوم الأربعاء» — هذا كلُّ المطلوب. والمورّدُ ورقمُ
 * المستند والكلفة **اختياريّة** وتُطوى تحت «تفاصيل اختياريّة»: ليست
 * فاتورةً ولا ديناً، والكلفةُ لا تُشتقّ منها كمّيّة.
 *
 * ── والتكرارُ يُسأل عنه قبل الحفظ ──
 *
 * إن كان في الفواتير بندٌ يشبهه ردّ الخادمُ بمرشّحيه ولم يكتب شيئاً،
 * فيُسأل صاحبُ المقهى في المكان نفسه: **هو نفسُه** (يُربَط فيُحسَب
 * مرّة) أو **شحنةٌ أخرى** (يُحسَب الاثنان). ولا يُحسَم عنه.
 */
export interface Candidate {
  invoiceLineId: string;
  invoiceNumber: string;
  supplierName: string;
  effectiveDate: string;
  basis: "SAME_QUANTITY" | "UNKNOWN_QUANTITY";
}

export function ReceiptForm({
  productId,
  productName,
  branchId,
  unitChoices,
  defaultUnit,
  defaultDate,
  periodStart,
  periodEnd,
  suppliers,
  onDone,
}: {
  productId: string;
  productName: string;
  branchId: string | null;
  unitChoices: { value: string; label: string }[];
  defaultUnit: string;
  defaultDate: string;
  periodStart: string;
  periodEnd: string;
  suppliers: { id: string; name: string }[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState(defaultUnit);
  const [date, setDate] = useState(defaultDate);
  const [more, setMore] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [documentRef, setDocumentRef] = useState("");
  const [cost, setCost] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [earlier, setEarlier] = useState<{ id: string; receivedOn: string }[]>([]);

  async function send(resolution: { kind: "LINK"; invoiceLineId: string } | { kind: "SEPARATE" } | null) {
    setBusy(true);
    setError(null);
    const r = await postJson("/api/inventory/receipt", {
      action: "create",
      productId,
      branchId,
      receivedOn: date,
      quantity: quantity.trim(),
      unit,
      supplierId: supplierId || null,
      documentRef: documentRef.trim() || null,
      cost: cost.trim() === "" ? null : cost.trim(),
      note: note.trim() || null,
      resolution,
    });
    setBusy(false);

    if (!r.ok) {
      const found = r.data.duplicateCandidates;
      const before = r.data.earlierReceipts;
      if (r.status === 409 && Array.isArray(found) && Array.isArray(before) && found.length + before.length > 0) {
        setCandidates(found as Candidate[]);
        setEarlier(before as { id: string; receivedOn: string }[]);
        return;
      }
      setError(r.error);
      return;
    }
    setCandidates(null);
    router.refresh();
    onDone();
  }

  const outside = date !== "" && (date < periodStart || date > periodEnd);

  return (
    <div className="mt-3 animate-rise rounded-xl border border-accent-line bg-accent-soft/40 p-4">
      <p className="text-[11px] font-bold">كمّيّةٌ دخلت الرفّ — {productName}</p>

      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-muted">
          الكمّيّة
          <input
            type="text" inputMode="decimal" dir="ltr" autoFocus
            value={quantity} onChange={(e) => setQuantity(e.target.value)} disabled={busy}
            placeholder="20"
            className="nums mt-1 block min-h-11 w-24 rounded-lg border border-line-input bg-raised px-2 text-center text-sm"
          />
        </label>
        <label className="text-[11px] text-muted">
          الوحدة
          <select
            value={unit} onChange={(e) => setUnit(e.target.value)} disabled={busy || unitChoices.length < 2}
            className="mt-1 block min-h-11 rounded-lg border border-line-input bg-raised px-2 text-xs"
          >
            {unitChoices.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-muted">
          تاريخ الاستلام
          <input
            type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy}
            className="nums mt-1 block min-h-11 rounded-lg border border-line-input bg-raised px-2 text-sm"
          />
        </label>
        <button type="button" onClick={() => setMore((m) => !m)} className={buttonClass("quiet", "sm")}>
          {more ? "أخفِ التفاصيل" : "تفاصيل اختياريّة"}
        </button>
      </div>

      {outside && (
        <p className="mt-2 text-[11px] text-warn">
          هذا التاريخ خارج أسبوع الجرد ({periodStart} → {periodEnd}) — فيدخل حسابَ أسبوعه هو لا هذا.
        </p>
      )}

      {more && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-muted">
            المورّد
            <select
              value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={busy}
              className="mt-1 block min-h-11 max-w-56 rounded-lg border border-line-input bg-raised px-2 text-xs"
            >
              <option value="">—</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="text-[11px] text-muted">
            رقم المستند
            <input
              type="text" value={documentRef} onChange={(e) => setDocumentRef(e.target.value)} disabled={busy}
              className="mt-1 block min-h-11 w-32 rounded-lg border border-line-input bg-raised px-2 text-sm"
            />
          </label>
          <label className="text-[11px] text-muted">
            الكلفة بالريال
            <input
              type="text" inputMode="decimal" dir="ltr" value={cost} onChange={(e) => setCost(e.target.value)} disabled={busy}
              placeholder="—"
              className="nums mt-1 block min-h-11 w-28 rounded-lg border border-line-input bg-raised px-2 text-center text-sm"
            />
          </label>
          <label className="min-w-40 flex-1 text-[11px] text-muted">
            ملاحظة
            <input
              type="text" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy}
              className="mt-1 block min-h-11 w-full rounded-lg border border-line-input bg-raised px-2 text-sm"
            />
          </label>
        </div>
      )}

      {candidates ? (
        <div className="mt-3 rounded-lg border border-warn/40 bg-warn-bg p-3">
          <p className="text-[11px] font-bold text-warn">
            {candidates.length > 0
              ? "في الفواتير ما يشبه هذا الاستلام — أهو هو، أم شحنةٌ أخرى؟"
              : `أدخلتَ الكمّيّةَ نفسَها يوم ${earlier[0]?.receivedOn ?? ""} — أهي شحنةٌ أخرى، أم أُدخلت مرّتين؟`}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
            لو حُسب الاثنان وهما شحنةٌ واحدة لظهر على الرفّ ضعفُ ما دخله. فلا يُحفَظ شيءٌ حتى تختار.
          </p>
          <ul className="mt-2 space-y-1.5">
            {candidates.map((c) => (
              <li key={c.invoiceLineId} className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="min-w-0 flex-1">
                  {c.supplierName} · {c.invoiceNumber} · <span className="nums">{c.effectiveDate}</span>
                  <span className="text-muted">
                    {c.basis === "SAME_QUANTITY" ? " — بالكمّيّة نفسِها" : " — كمّيّتُها في الفاتورة غير معروفة"}
                  </span>
                </span>
                <button
                  type="button" disabled={busy}
                  onClick={() => void send({ kind: "LINK", invoiceLineId: c.invoiceLineId })}
                  className={buttonClass("primary", "sm")}
                >
                  هي هذه الفاتورة — اربطها
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void send({ kind: "SEPARATE" })} className={buttonClass("secondary", "sm")}>
              شحنةٌ أخرى — احفظها منفصلة
            </button>
            <button type="button" disabled={busy} onClick={() => setCandidates(null)} className={buttonClass("quiet", "sm")}>
              تراجع
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            aria-busy={busy}
            type="button" disabled={busy || quantity.trim() === "" || date === ""}
            onClick={() => void send(null)}
            className={buttonClass("primary", "sm")}
          >
            احفظ الكمّيّة
          </button>
          <button type="button" disabled={busy} onClick={onDone} className={buttonClass("quiet", "sm")}>تراجع</button>
        </div>
      )}

      {error && <p className="mt-2 text-[11px] leading-relaxed text-danger">{error}</p>}
    </div>
  );
}
