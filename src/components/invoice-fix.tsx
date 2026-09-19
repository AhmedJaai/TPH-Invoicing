"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";
import type { InvoiceReason } from "@/lib/invoice-findings";

/**
 * «لماذا ناقصةُ ركن» — ومعها ما يُصلحها.
 *
 * ── العطب الذي يُصلحه هذا المكوّن ──
 *
 * كانت الشاشة تقول «ينقصها ركن» ولا تقول أيّ ركن، وتقول «لا يوجد رقم
 * فاتورة» **والرقمُ على الورقة** لم يقرأه النموذج. فيقف صاحب المقهى
 * أمام طريقٍ مسدود: لا اعتمادٌ ينفع (تبقى ناقصة)، ولا رفضٌ يصحّ
 * (الفاتورة سليمة)، ولا موضعَ يكتب فيه ما يعرفه.
 *
 * فصار لكلّ سببٍ نصُّه وفعلُه، وتحته حقولٌ تُصحَّح بيد الإنسان.
 *
 * **ولا يُقرّر المتصفّحُ حالَ الضريبة**: يُرسل الحقولَ وحدها، ويُعيد
 * الخادمُ اشتقاق الحال بـ`reviewConfirmed` — وهي الدالّة نفسها التي
 * يحكم بها مسارُ الأرشفة. فمن يصحّح رقماً لا يقرّر معه أنّ الفاتورة
 * صارت صالحة.
 */
export function InvoiceFix({
  invoiceId,
  reasons,
  initial,
  canEdit,
}: {
  invoiceId: string;
  reasons: InvoiceReason[];
  initial: {
    invoiceNumber: string;
    sellerVat: string;
    buyerVat: string;
    subtotal: string;
    vat: string;
    total: string;
  };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => form[k] !== initial[k]);

  async function save() {
    setBusy(true);
    setFailed(false);
    setMessage(null);
    const r = await postJson<{ taxStatus: string }>("/api/invoice-fields", {
      invoiceId,
      invoiceNumber: form.invoiceNumber,
      sellerVat: form.sellerVat,
      buyerVat: form.buyerVat,
      subtotal: form.subtotal,
      vat: form.vat,
      total: form.total,
    });
    setBusy(false);
    if (!r.ok) {
      setFailed(true);
      setMessage(r.error);
      return;
    }
    setMessage(
      r.data.taxStatus === "VALID"
        ? "حُفظ — وصارت الفاتورة مستوفيةَ الأركان."
        : "حُفظ. وما زال فيها ما يُراجَع — انظر الأسباب أعلاه بعد التحديث.",
    );
    router.refresh();
  }

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  if (reasons.length === 0 && !open) {
    return (
      <p className="text-xs text-ok">
        مستوفيةُ الأركان — لا شيء ينقصها.
        {canEdit && (
          <button type="button" onClick={() => setOpen(true)} className="ms-2 underline underline-offset-4">
            صحّح حقلاً على أيّ حال
          </button>
        )}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {reasons.length > 0 && (
        <ul className="space-y-1.5">
          {reasons.map((r) => (
            <li
              key={r.code}
              className={`rounded-lg border px-3 py-2 ${
                r.severity === "BLOCKER" ? "border-danger/40 bg-danger-bg" : "border-warn/40 bg-warn-bg"
              }`}
            >
              <p className="text-xs font-bold">
                {r.severity === "BLOCKER" ? "يمنع القيد: " : "يحتاج معالجة: "}
                {r.what}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-soft">{r.fix}</p>
            </li>
          ))}
        </ul>
      )}

      {canEdit && !open && (
        <button type="button" onClick={() => setOpen(true)} className={buttonClass("secondary", "sm")}>
          صحّح الحقول بيدك
        </button>
      )}

      {canEdit && open && (
        <div className="rounded-xl border border-line bg-sunken/50 p-3">
          <p className="mb-2.5 text-[11px] leading-relaxed text-muted">
            اكتب ما على الورقة. والنظامُ يعيد الحكمَ على الفاتورة بعد الحفظ — لا تُكتَب الحالُ من هنا.
          </p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="رقم الفاتورة" value={form.invoiceNumber} onChange={(v) => set({ invoiceNumber: v })} ltr />
            <Field label="الرقم الضريبيّ للبائع" value={form.sellerVat} onChange={(v) => set({ sellerVat: v })} ltr />
            <Field label="الرقم الضريبيّ للمشتري" value={form.buyerVat} onChange={(v) => set({ buyerVat: v })} ltr />
            <Field label="الصافي قبل الضريبة" value={form.subtotal} onChange={(v) => set({ subtotal: v })} ltr />
            <Field label="الضريبة" value={form.vat} onChange={(v) => set({ vat: v })} ltr />
            <Field label="الإجماليّ" value={form.total} onChange={(v) => set({ total: v })} ltr />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={busy || !dirty}
              className={buttonClass("primary", "sm")}
            >
              {busy ? "يُحفظ…" : "احفظ التصحيح"}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setForm(initial); setMessage(null); }}
              disabled={busy}
              className={buttonClass("quiet", "sm")}
            >
              إلغاء
            </button>
            {message && <span className={`text-xs ${failed ? "text-danger" : "text-ok"}`}>{message}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  ltr,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  ltr?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        dir={ltr ? "ltr" : undefined}
        /*
          `inputMode` رقميّ على المبالغ يفتح لوحةَ الأرقام على الجوّال —
          وأحمد يكتبها بإبهامه عند الكاشير.
        */
        inputMode={/الضريب|الصافي|الإجمال/.test(label) ? "decimal" : undefined}
        className={`w-full rounded-lg border border-line-input bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-ink ${ltr ? "nums" : ""}`}
      />
    </label>
  );
}
