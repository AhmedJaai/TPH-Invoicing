"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CircleAlert, CircleCheck, Info, PenLine, TriangleAlert } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";
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
    const valid = r.data.taxStatus === "VALID";
    toast({
      tone: valid ? "ok" : "warn",
      title: "حُفظ التصحيح",
      body: valid ? "وأعاد الخادمُ الحكمَ عليها: صارت مستوفيةَ الأركان." : "وما زال فيها ما يُراجَع — الأسبابُ أعلاه.",
    });
    setOpen(false);
    router.refresh();
  }

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  if (reasons.every((r) => r.severity === "INFO") && !open) {
    return (
      <div className="space-y-1.5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5 font-bold text-ok">
            <CircleCheck className="h-4 w-4" strokeWidth={2} aria-hidden />
            مستوفيةُ الأركان — لا شيء ينقصها.
          </span>
          {canEdit && (
            <button type="button" onClick={() => setOpen(true)} className={buttonClass("quiet", "sm")}>
              <PenLine className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              صحّح حقلاً على أيّ حال
            </button>
          )}
        </p>
        {reasons.map((r) => (
          <p key={r.code} className="text-[11px] leading-relaxed text-muted">
            للعلم: {r.what} — {r.fix}
          </p>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reasons.length > 0 && (
        <ul className="space-y-1.5">
          {reasons.map((r) => (
            <li
              key={r.code}
              className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${
                r.severity === "BLOCKER"
                  ? "border-danger/25 bg-danger-bg"
                  : r.severity === "WARN" ? "border-warn/25 bg-warn-bg" : "border-line bg-sunken"
              }`}
            >
              {r.severity === "BLOCKER"
                ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={2} aria-hidden />
                : r.severity === "WARN"
                  ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" strokeWidth={2} aria-hidden />
                  : <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted" strokeWidth={2} aria-hidden />}
              <div className="min-w-0">
                <p className="text-xs font-bold">
                  {/* ما هو للعلم لا يُكتب «يحتاج معالجة» — وإلّا صار كلُّ تقريبٍ عطباً */}
                  {r.severity === "BLOCKER" ? "يمنع القيد: " : r.severity === "WARN" ? "يحتاج معالجة: " : "للعلم: "}
                  {r.what}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-soft">{r.fix}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canEdit && !open && (
        <button type="button" onClick={() => setOpen(true)} className={buttonClass("secondary", "sm")}>
          <PenLine className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          صحّح الحقول بيدك
        </button>
      )}

      {canEdit && open && (
        <div className="rounded-xl border border-line bg-raised p-3.5 shadow-raised">
          <p className="mb-2.5 text-[11px] leading-relaxed text-muted">
            اكتب ما على الورقة. والنظامُ يعيد الحكمَ على الفاتورة بعد الحفظ — لا تُكتَب الحالُ من هنا.
          </p>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 sm:grid-cols-2">
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
            {message && <span role={failed ? "alert" : "status"} className={`text-xs font-bold ${failed ? "text-danger" : "text-ok"}`}>{message}</span>}
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
        className={`min-h-11 w-full rounded-lg border border-line-input bg-raised px-2.5 text-sm sm:min-h-9 ${ltr ? "nums" : ""}`}
      />
    </label>
  );
}
