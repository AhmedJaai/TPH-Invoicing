"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { CircleAlert, CircleCheck, Info, PenLine, TriangleAlert } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui-tokens";
import { Reveal, toast } from "./ui-client";
import { Money } from "./money";
import { parseRiyals, TOTAL_ROUNDING_TOLERANCE_MINOR } from "@/lib/money";
import { isValidSaudiVat } from "@/lib/validation";
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
  /* مبلغٌ لا يُقرأ لا يُرسَل ليُردّ — يُقال تحت حقله، والزرُّ يقول لماذا لا يعمل */
  const unreadable = !form.total.trim()
    || [form.subtotal, form.vat, form.total].some((v) => v.trim() !== "" && parseRiyals(v) === null);

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

      {canEdit && (
        <Reveal open={open}>
        <div className="rounded-xl border border-line bg-raised p-3.5 shadow-raised">
          <p className="mb-2.5 text-[11px] leading-relaxed text-muted">
            اكتب ما على الورقة. والنظامُ يعيد الحكمَ على الفاتورة بعد الحفظ — لا تُكتَب الحالُ من هنا.
          </p>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 sm:grid-cols-2">
            <Field label="رقم الفاتورة" value={form.invoiceNumber} onChange={(v) => set({ invoiceNumber: v })} ltr />
            <Field label="الرقم الضريبيّ للبائع" value={form.sellerVat} onChange={(v) => set({ sellerVat: v })} ltr hint={vatHint(form.sellerVat)} />
            <Field label="الرقم الضريبيّ للمشتري" value={form.buyerVat} onChange={(v) => set({ buyerVat: v })} ltr hint={vatHint(form.buyerVat)} />
            <Field label="الصافي قبل الضريبة" value={form.subtotal} onChange={(v) => set({ subtotal: v })} ltr hint={amountHint(form.subtotal)} />
            <Field label="الضريبة" value={form.vat} onChange={(v) => set({ vat: v })} ltr hint={amountHint(form.vat)} />
            <Field label="الإجماليّ" value={form.total} onChange={(v) => set({ total: v })} ltr hint={amountHint(form.total, true)} />
          </div>
          <SumCheck subtotal={form.subtotal} vat={form.vat} total={form.total} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              aria-busy={busy}
              type="button"
              onClick={save}
              disabled={busy || !dirty || unreadable}
              title={unreadable ? "صحّح المبلغ الذي لا يُقرأ أوّلاً" : !dirty ? "لم يتغيّر حقل" : undefined}
              className={buttonClass("primary", "sm")}
            >
              احفظ التصحيح
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
        </Reveal>
      )}
    </div>
  );
}

/*
 * ── التحقّقُ أثناء الكتابة ──
 *
 * ما يُقال هنا عونٌ لا حكم: الخادمُ يعيد القراءة والحكمَ بعد الحفظ
 * (`reviewConfirmed`). والغرضُ أن يرى من يكتب خطأه قبل أن يرسله — رقمٌ
 * ضريبيٌّ بأربع عشرة خانة، أو مجموعٌ لا يطابق — لا أن يعرفه من ردٍّ مرفوض.
 */
type Hint = { tone: "ok" | "warn" | "danger"; text: React.ReactNode } | null;

function vatHint(v: string): Hint {
  if (!v.trim()) return null;
  return isValidSaudiVat(v)
    ? { tone: "ok", text: "رقمٌ ضريبيٌّ سليمُ الشكل" }
    : { tone: "warn", text: "15 خانة، يبدأ بـ3 وينتهي بـ3" };
}

function amountHint(v: string, required = false): Hint {
  if (!v.trim()) return required ? { tone: "danger", text: "الإجماليّ مطلوب" } : { tone: "warn", text: "فارغ — يُحفظ «غير معروف»" };
  const minor = parseRiyals(v);
  if (minor === null) return { tone: "danger", text: "لا يُقرأ مبلغاً — مثل 1250.50" };
  /* ما كُتب بأرقامٍ هنديّة أو بفواصل يُعرض كما سيُحفظ */
  return /[٠-٩۰-۹٬٫,]/.test(v) ? { tone: "ok", text: <>يُحفظ <Money minor={minor} /></> } : null;
}

function SumCheck({ subtotal, vat, total }: { subtotal: string; vat: string; total: string }) {
  const s = subtotal.trim() ? parseRiyals(subtotal) : null;
  const v = vat.trim() ? parseRiyals(vat) : null;
  const t = total.trim() ? parseRiyals(total) : null;
  if (s === null || v === null || t === null) return null;
  const gap = s + v - t;
  const ok = Math.abs(gap) <= TOTAL_ROUNDING_TOLERANCE_MINOR;
  return (
    <p
      aria-live="polite"
      className={`mt-2.5 flex flex-wrap items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-bold ${ok ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn"}`}
    >
      {ok ? <CircleCheck className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden /> : <TriangleAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden />}
      الصافي + الضريبة = <Money minor={s + v} />
      {ok ? " — يطابق الإجماليّ" : <> — يخالف الإجماليّ بـ<Money minor={Math.abs(gap)} /></>}
    </p>
  );
}

function Field({
  label,
  value,
  onChange,
  ltr,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  ltr?: boolean;
  hint?: Hint;
}) {
  const hintId = useId();
  /* التلميحُ وصفٌ للحقل (`aria-describedby`) لا جزءٌ من اسمه — وإلّا قرأه قارئُ الشاشة اسماً */
  return (
    <div>
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
          aria-invalid={hint?.tone === "danger" || undefined}
          aria-describedby={hint ? hintId : undefined}
          className={`min-h-11 w-full rounded-lg border bg-raised px-2.5 text-sm transition-colors sm:min-h-9 ${ltr ? "nums" : ""} ${
            hint?.tone === "danger" ? "border-danger" : "border-line-input"
          }`}
        />
      </label>
      {hint && (
        <span id={hintId} className={`mt-1 block text-[11px] ${hint.tone === "ok" ? "text-ok" : hint.tone === "warn" ? "text-warn" : "text-danger"}`}>
          {hint.text}
        </span>
      )}
    </div>
  );
}
