"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ReceiptText } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";

/**
 * «وصل إشعارٌ دائن؟» — مرتجعٌ أو خصمٌ من المورّد على هذه الفاتورة.
 *
 * ليس سداداً: لم يخرج مال. يُنقص ما بقي على الفاتورة ويبقى في سجلّ سدادها
 * «إشعار دائن»، ولا يُطابَق بحوالة. والخادمُ يرفض ما يتجاوز المتبقّي.
 */
export function CreditNoteForm({ invoiceId, today }: { invoiceId: string; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [issuedOn, setIssuedOn] = useState(today);
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-xs font-bold text-accent hover:underline sm:min-h-0">
        <ReceiptText className="h-3.5 w-3.5" aria-hidden />
        وصل إشعارٌ دائن؟ (مرتجع أو خصم)
      </button>
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    const r = await postJson<{ message?: string }>("/api/credit-note", {
      invoiceId,
      amount: amount.trim(),
      issuedOn,
      ...(reference.trim() ? { reference: reference.trim() } : {}),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast({ title: r.data.message ?? "قُيِّد الإشعار", tone: "ok" });
    setOpen(false);
    setAmount("");
    setReference("");
    setReason("");
    router.refresh();
  }

  return (
    <div className="mt-4 animate-rise rounded-xl border border-line bg-raised p-4">
      <p className="text-xs font-bold">إشعارٌ دائن على هذه الفاتورة</p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        يُنقص ما بقي عليها ولا يُعدّ مالاً خرج — ولا ينتظر كشفَ بنك.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-muted">
          المبلغ (ريال)
          <input
            type="text" inputMode="decimal" dir="ltr" autoFocus
            value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} placeholder="700"
            className="nums mt-1 block min-h-11 w-28 rounded-lg border border-line-input bg-raised px-2 text-center text-sm"
          />
        </label>
        <label className="text-[11px] text-muted">
          تاريخه
          <input
            type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} disabled={busy}
            className="nums mt-1 block min-h-11 rounded-lg border border-line-input bg-raised px-2 text-sm"
          />
        </label>
        <label className="text-[11px] text-muted">
          رقمُه (اختياريّ)
          <input
            type="text" dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} disabled={busy} maxLength={60}
            className="nums mt-1 block min-h-11 w-32 rounded-lg border border-line-input bg-raised px-2 text-sm"
          />
        </label>
      </div>
      <label className="mt-2 block text-[11px] text-muted">
        السبب (اختياريّ)
        <input
          type="text" value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} maxLength={200}
          placeholder="مرتجعُ حليبٍ منتهٍ · خصمُ كمّيّة"
          className="mt-1 block min-h-11 w-full rounded-lg border border-line-input bg-raised px-2 text-sm"
        />
      </label>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={save} disabled={busy || amount.trim() === ""} className={buttonClass("primary", "sm")}>
          {busy ? "يُقيَّد…" : "قيّد الإشعار"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null); }} disabled={busy} className={buttonClass("quiet", "sm")}>
          ألغِ
        </button>
      </div>
    </div>
  );
}
