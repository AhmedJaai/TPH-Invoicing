"use client";

import { DAY, INVOICE, countNoun } from "@/lib/arabic";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { SUPPLIER_CATEGORIES, SUPPLIER_CATEGORY_LABEL } from "@/lib/supplier-edit";
import { Sheet, toast } from "./ui-client";
import { buttonClass } from "./ui-tokens";
import { T } from "@/components/i18n/t";

/**
 * «عدّل بياناته» — ما يكتبه صاحبُ المقهى عن مورّده بعد إنشائه.
 *
 * كانت بياناتُه تُعرَض ولا تُصحَّح: رقمٌ ضريبيّ قُرئ خطأً، أو اسمٌ كُتب على
 * عجل، يبقى كذلك أبداً. ولا يُحفَظ شيءٌ حتى يُضغَط «احفظ»؛ وما يستحقّ سؤالاً
 * (تغييرُ الآيبان، رقمٌ يخالف فواتيرَه) يُعرَض تنبيهُه ثمّ يمضي بإقرارك —
 * تحذيرٌ لا منع.
 */
export interface SupplierEditInitial {
  nameAr: string;
  nameEn: string;
  vatNumber: string;
  crNumber: string;
  category: (typeof SUPPLIER_CATEGORIES)[number];
  paymentTermsDays: string;
  balanceAlert: string;
  phone: string;
  email: string;
  contactName: string;
  iban: string;
}

const FIELD = "mt-1 block min-h-11 w-full rounded-lg border border-line-input bg-raised px-3 text-sm sm:min-h-10";

export function SupplierEdit({
  supplierId,
  initial,
  termsHint,
}: {
  supplierId: string;
  initial: SupplierEditInitial;
  /**
   * عادةُ السداد الفعليّة (وسيطُ الأيّام من الفاتورة إلى اكتمال سدادها، وعددُ العيّنات) —
   * تُقترَح أجلاً حين الحقلُ فارغ وحده، ولا يُكتب شيءٌ بلا ضغطة ثمّ «احفظ».
   */
  termsHint?: { medianDays: number; sampleCount: number };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const set = (patch: Partial<SupplierEditInitial>) => {
    setForm((f) => ({ ...f, ...patch }));
    setWarnings([]);
    setError(null);
  };
  const keys = Object.keys(initial).filter((k): k is keyof SupplierEditInitial => k in initial);
  const dirty = keys.some((k) => form[k] !== initial[k]);

  function close() {
    if (busy) return;
    setOpen(false);
    setForm(initial);
    setWarnings([]);
    setError(null);
  }

  async function save(confirm: boolean) {
    setBusy(true);
    setError(null);
    /* ما تغيّر وحده: الغائبُ لا يُمسّ في الخادم، والفارغُ يمحو */
    const patch = Object.fromEntries(keys.filter((k) => form[k] !== initial[k]).map((k) => [k, form[k]]));
    const r = await postJson<{ message?: string }>("/api/supplier-edit", { supplierId, ...patch, ...(confirm ? { confirm: true } : {}) });
    setBusy(false);
    if (!r.ok) {
      const w = r.status === 409 && Array.isArray(r.data.warnings)
        ? r.data.warnings.filter((x): x is string => typeof x === "string")
        : [];
      setWarnings(w);
      setError(w.length > 0 ? null : r.error);
      return;
    }
    toast({ tone: "ok", title: "حُفظت بيانات المورّد", body: r.data.message });
    setWarnings([]);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={() => { setForm(initial); setOpen(true); }} className={buttonClass("secondary", "sm")}>
        <T s="{0}عدّل بياناته" a={[<Pencil key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></button>
      <Sheet
        open={open}
        onClose={close}
        title="بيانات المورّد"
        description="الحقل الفارغ يعني «غير معروف». ولا يُحفظ شيء حتى تضغط «احفظ»."
        footer={
          <>
            <button type="button" className={buttonClass("quiet")} disabled={busy} onClick={close}>إلغاء</button>
            <button
              type="button"
              aria-busy={busy}
              className={buttonClass("primary")}
              disabled={busy || !dirty}
              onClick={() => save(warnings.length > 0)}
            >
              {warnings.length > 0 ? "نعم، احفظ مع التنبيه" : "احفظ"}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
          <label className="text-xs font-bold">
            <T s="الاسم بالعربية{0}" a={[<input key="0" value={form.nameAr} onChange={(e) => set({ nameAr: e.target.value })} disabled={busy} dir="auto" className={FIELD} />]} /></label>
          <label className="text-xs font-bold">
            <T s="الاسم بالإنجليزية{0}" a={[<input key="0" value={form.nameEn} onChange={(e) => set({ nameEn: e.target.value })} disabled={busy} dir="ltr" className={FIELD} />]} /></label>
          <label className="text-xs font-bold">
            <T s="الرقم الضريبي{0}" a={[<input key="0" value={form.vatNumber} onChange={(e) => set({ vatNumber: e.target.value })} disabled={busy} dir="ltr" inputMode="numeric" placeholder="15 رقماً" className={`nums ${FIELD}`} />]} /></label>
          <label className="text-xs font-bold">
            <T s="السجل التجاري{0}" a={[<input key="0" value={form.crNumber} onChange={(e) => set({ crNumber: e.target.value })} disabled={busy} dir="ltr" inputMode="numeric" className={`nums ${FIELD}`} />]} /></label>
          <label className="text-xs font-bold">
            <T s="التصنيف{0}" a={[<select key="0"
              value={form.category}
              onChange={(e) => {
                const c = SUPPLIER_CATEGORIES.find((x) => x === e.target.value);
                if (c) set({ category: c });
              }}
              disabled={busy}
              className={FIELD}
            >
              {SUPPLIER_CATEGORIES.map((c) => <option key={c} value={c}>{SUPPLIER_CATEGORY_LABEL[c]}</option>)}
            </select>]} /></label>
          <label className="text-xs font-bold">
            <T s="مهلة السداد (بالأيام){0}{1}{2}" a={[<input key="0" value={form.paymentTermsDays} onChange={(e) => set({ paymentTermsDays: e.target.value })} disabled={busy} dir="ltr" inputMode="numeric" placeholder="0 = نقداً، والفراغ = غير معروف" className={`nums ${FIELD}`} />, <span key="1" className="mt-1 block text-[11px] font-normal text-muted">بها تُحسب حالة «تجاوز المهلة» في صفحة المورّد، بدلاً من مهلة ثابتة (ستين يوماً) للجميع.</span>, termsHint && form.paymentTermsDays.trim() === "" && (
              <span key="2" className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-accent-line bg-accent-soft px-2.5 py-1.5 text-[11px] font-normal text-ink-soft">
                <span><T s="تدفع له عادةً بعد {0} (الوسيط لـ{1} مسدّدة)." a={[<bdi key="0" className="nums font-bold text-ink">{countNoun(termsHint.medianDays, DAY)}</bdi>, <bdi key="1" className="nums">{countNoun(termsHint.sampleCount, INVOICE)}</bdi>]} /></span>
                <button type="button" disabled={busy} onClick={() => set({ paymentTermsDays: String(termsHint.medianDays) })} className="font-bold text-accent hover:underline">
                  اعتمدها مهلة للسداد
                </button>
              </span>
            )]} /></label>
          <label className="text-xs font-bold">
            <T s="نبّهني إن تجاوز المستحق له (بالريال){0}" a={[<input key="0" value={form.balanceAlert} onChange={(e) => set({ balanceAlert: e.target.value })} disabled={busy} dir="ltr" inputMode="decimal" placeholder="الفراغ = بلا حد" className={`nums ${FIELD}`} />]} /></label>
          <label className="text-xs font-bold">
            <T s="اسم المندوب{0}" a={[<input key="0" value={form.contactName} onChange={(e) => set({ contactName: e.target.value })} disabled={busy} dir="auto" className={FIELD} />]} /></label>
          <label className="text-xs font-bold">
            <T s="جوال المندوب (واتساب){0}" a={[<input key="0" value={form.phone} onChange={(e) => set({ phone: e.target.value })} disabled={busy} dir="ltr" inputMode="tel" placeholder="05xxxxxxxx" className={`nums ${FIELD}`} />]} /></label>
          <label className="text-xs font-bold">
            <T s="البريد الإلكتروني{0}" a={[<input key="0" value={form.email} onChange={(e) => set({ email: e.target.value })} disabled={busy} dir="ltr" inputMode="email" className={FIELD} />]} /></label>
          <label className="text-xs font-bold sm:col-span-2">
            <T s="الآيبان{0}{1}" a={[<input key="0" value={form.iban} onChange={(e) => set({ iban: e.target.value })} disabled={busy} dir="ltr" placeholder="SA.. (24 خانة)" className={`nums font-mono ${FIELD}`} />, <span key="1" className="mt-1 block text-[11px] font-normal text-muted">
              يُتحقق من صحته تلقائياً، ويُستخدم في ملف التحويلات. أما الحساب الذي حوّلت له من قبل فيُقرأ تلقائياً من الكشوف، فاكتبه فقط إن لم تحوّل له قبل الآن أو غيّر حسابه.
            </span>]} /></label>
        </div>

        {warnings.length > 0 && (
          <div role="alert" className="mt-4 rounded-lg border border-warn/40 bg-warn-bg px-3 py-2.5 text-xs leading-relaxed text-ink">
            <p className="font-bold text-warn">قبل الحفظ:</p>
            <ul className="mt-1 list-disc space-y-1 ps-4">
              {warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
            <p className="mt-1.5 text-muted">لم يُحفظ شيء بعد، والقرار لك.</p>
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-xs font-bold text-danger">{error}</p>}
      </Sheet>
    </>
  );
}
