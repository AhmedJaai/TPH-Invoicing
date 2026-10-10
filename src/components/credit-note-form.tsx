"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ReceiptText } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui-tokens";
import { Field, Input, MoneyInput, toast } from "./ui-client";

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
  /* على الفاتورة إشعارٌ يشبهه — يُسأل ولا يُمنَع */
  const [duplicate, setDuplicate] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-xs font-bold text-accent hover:underline sm:min-h-0">
        <ReceiptText className="h-3.5 w-3.5" aria-hidden />
        وصل إشعارٌ دائن؟ (مرتجع أو خصم)
      </button>
    );
  }

  async function save(acknowledgeDuplicate = false) {
    /* Enter مرّتين أو ضغطتان: الثانيةُ لا تُرسل إشعاراً ثانياً */
    if (busy || amount.trim() === "") return;
    setBusy(true);
    setError(null);
    const r = await postJson<{ message?: string }>("/api/credit-note", {
      invoiceId,
      amount: amount.trim(),
      issuedOn,
      ...(reference.trim() ? { reference: reference.trim() } : {}),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
      ...(acknowledgeDuplicate ? { acknowledgeDuplicate: true } : {}),
    });
    setBusy(false);
    if (!r.ok) {
      setDuplicate(r.status === 409 && r.data.duplicate === true);
      setError(r.error);
      return;
    }
    setDuplicate(false);
    toast({ title: r.data.message ?? "قُيِّد الإشعار", tone: "ok" });
    setOpen(false);
    setAmount("");
    setReference("");
    setReason("");
    router.refresh();
  }

  return (
    /* نموذجٌ حقيقيّ: Enter في أيّ حقلٍ يقيّد، و«تمّ» في لوحة مفاتيح الهاتف كذلك */
    <form
      onSubmit={(e) => { e.preventDefault(); void save(duplicate); }}
      className="mt-4 animate-rise rounded-xl border border-line bg-raised p-4"
    >
      <p className="text-xs font-bold">إشعارٌ دائن على هذه الفاتورة</p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        يُنقص ما بقي عليها ولا يُعدّ مالاً خرج — ولا ينتظر كشفَ بنك.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="المبلغ (ريال)" required>
          {({ invalid, ...p }) => (
            <MoneyInput
              {...p}
              invalid={invalid}
              autoFocus
              enterKeyHint="done"
              value={amount}
              onChange={(v) => { setAmount(v); setDuplicate(false); }}
              disabled={busy}
              placeholder="700"
            />
          )}
        </Field>
        <Field label="تاريخه">
          {({ invalid, ...p }) => (
            <Input {...p} invalid={invalid} type="date" className="nums" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} disabled={busy} />
          )}
        </Field>
        <Field label="رقمُه (اختياريّ)" className="col-span-2 sm:col-span-1">
          {({ invalid, ...p }) => (
            <Input {...p} invalid={invalid} type="text" dir="ltr" className="nums" enterKeyHint="done" value={reference} onChange={(e) => setReference(e.target.value)} disabled={busy} maxLength={60} />
          )}
        </Field>
      </div>
      <Field label="السبب (اختياريّ)" className="mt-3">
        {({ invalid, ...p }) => (
          <Input
            {...p}
            invalid={invalid}
            type="text"
            enterKeyHint="done"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            maxLength={200}
            placeholder="مرتجعُ حليبٍ منتهٍ · خصمُ كمّيّة"
          />
        )}
      </Field>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="submit" aria-busy={busy} disabled={busy || amount.trim() === ""} className={buttonClass("primary", "sm")}>
          <span>{duplicate ? "إشعارٌ آخر — قيّده" : "قيّد الإشعار"}</span>
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null); }} disabled={busy} className={buttonClass("quiet", "sm")}>
          ألغِ
        </button>
      </div>
    </form>
  );
}
