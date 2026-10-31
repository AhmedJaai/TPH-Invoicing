"use client";

import { todayInRiyadh } from "@/lib/riyadh-time";
import { useRouter } from "next/navigation";
import { useId, useState, Fragment } from "react";
import { CircleAlert, CircleCheck, Info, PenLine, TriangleAlert } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui-tokens";
import { Reveal, toast } from "./ui-client";
import { Money } from "./money";
import { checkInvoiceTotals, parseRiyals } from "@/lib/money";
import { isValidSaudiVat } from "@/lib/validation";
import type { InvoiceReason } from "@/lib/invoice-findings";
import { changesLine, fixChanges } from "@/lib/invoice-fix-changes";
import { T } from "@/components/i18n/t";

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
  suppliers,
  paidMinor,
  startOpen = false,
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
    /** خصمٌ بعد الضريبة — فراغُه «لا خصم» */
    discount: string;
    /** رسومُ توصيلٍ أو شحنٍ بعد الضريبة — فراغُها «لا رسوم» */
    charges: string;
    /** YYYY-MM-DD */
    invoiceDate: string;
    supplierId: string;
  };
  canEdit: boolean;
  /** للتصحيح حين قُرئ المورّدُ خطأً — تغييرُه يفكّ عنها سدادَ السابق. */
  suppliers: { id: string; name: string }[];
  /** ما خُصّص عليها — يُقال قبل تغيير المورّد إنّه سيُفكّ. */
  paidMinor: number;
  /** يُفتح من رابطٍ جاء لتصحيحه (`?act=fix`) — لا يُطلب ضغطةٌ ثانية. */
  startOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen && canEdit);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => form[k] !== initial[k]);
  /* مبلغٌ لا يُقرأ لا يُرسَل ليُردّ — يُقال تحت حقله، والزرُّ يقول لماذا لا يعمل */
  const unreadable = !form.total.trim()
    || [form.subtotal, form.vat, form.total, form.discount, form.charges].some((v) => v.trim() !== "" && parseRiyals(v) === null);

  /** الحقولُ كما تُرسَل — `to` ما يُكتب، و`from` ما كان (ما لم يتغيّر لا يُرسَل). */
  const payload = (to: typeof initial, from: typeof initial) => ({
    invoiceId,
    invoiceNumber: to.invoiceNumber,
    sellerVat: to.sellerVat,
    buyerVat: to.buyerVat,
    subtotal: to.subtotal,
    vat: to.vat,
    total: to.total,
    ...(to.discount !== from.discount ? { discount: to.discount } : {}),
    ...(to.charges !== from.charges ? { charges: to.charges } : {}),
    /* ما لم يتغيّر لا يُرسَل — فلا يُسأل عن صلاحيةٍ لم يُطلب بها شيء */
    ...(to.invoiceDate !== from.invoiceDate ? { invoiceDate: to.invoiceDate } : {}),
    ...(to.supplierId !== from.supplierId ? { supplierId: to.supplierId } : {}),
  });

  async function save() {
    setBusy(true);
    setFailed(false);
    setMessage(null);
    const saved = form;
    const r = await postJson<{ taxStatus: string; releasedMinor?: number }>("/api/invoice-fields", payload(saved, initial));
    setBusy(false);
    if (!r.ok) {
      setFailed(true);
      setMessage(r.error);
      return;
    }
    const valid = r.data.taxStatus === "VALID";
    const released = (r.data.releasedMinor ?? 0) > 0;
    /* ما تغيّر يُقال من كم إلى كم — الأرقامُ على الصفحة ستتبدّل بعد لحظة */
    const changed = changesLine(fixChanges(initial, saved, (id) => suppliers.find((s) => s.id === id)?.name ?? null));
    toast({
      tone: valid ? "ok" : "warn",
      title: "حُفظ التصحيح",
      body: [
        changed,
        released
          ? "أُلغي ربط سداد المورّد السابق بها، وعاد رصيداً لك عنده يُخصم من فواتيره"
          : valid ? "أعاد النظام فحص الفاتورة، فصارت مستوفية للشروط الضريبية" : "ما زال فيها ما يحتاج إلى مراجعة، وأسبابه أعلاه",
      ].filter(Boolean).join(" — "),
      duration: 12_000,
      /*
        التراجعُ يعيد القيمَ السابقة بالمسار نفسه (فيُعاد الحكمُ ويُحرَس الشهرُ المقفل).
        ولا يُعرَض حين تغيّر المورّد: فكُّ السداد لا يعود بإعادة الاسم، و«تمّ التراجع» كذب.
      */
      undo: released || saved.supplierId !== initial.supplierId ? undefined : {
        run: async () => {
          const u = await postJson<{ taxStatus: string }>("/api/invoice-fields", payload(initial, saved));
          if (u.ok) {
            setForm(initial);
            router.refresh();
          }
          return u.ok;
        },
      },
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
            <T s="{0}مستوفية للشروط الضريبية، ولا ينقصها شيء." a={[<CircleCheck key="0" className="h-4 w-4" strokeWidth={2} aria-hidden />]} /></span>
          {canEdit && (
            <button type="button" onClick={() => setOpen(true)} className={buttonClass("quiet", "sm")}>
              <T s="{0}صحّح معلومة على أي حال" a={[<PenLine key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></button>
          )}
        </p>
        {reasons.map((r) => (
          <p key={r.code} className="text-[11px] leading-relaxed text-muted">
            <T s="للعلم: {0}. {1}" a={[r.what, r.fix]} /></p>
        ))}
      </div>
    );
  }

  return (
    /* `data-dirty`: لوحُ الفحص يسأل قبل أن يستبدل الملفَّ أو يُغلق وفيه تصحيحٌ لم يُحفَظ */
    <div className="space-y-3" data-dirty={open && dirty ? "تصحيح الفاتورة" : undefined}>
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
                  {r.severity === "BLOCKER" ? "يمنع التسجيل: " : r.severity === "WARN" ? "يحتاج إلى معالجة: " : "للعلم: "}
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
          <T s="{0}صحّح البيانات بنفسك" a={[<PenLine key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></button>
      )}

      {canEdit && (
        <Reveal open={open}>
        <div className="rounded-xl border border-line bg-raised p-3.5 shadow-raised">
          <p className="mb-2.5 text-[11px] leading-relaxed text-muted">
            اكتب ما في الورقة. سيعيد النظام فحص الفاتورة بعد الحفظ، فلا داعي لتحديد حالتها من هنا.
          </p>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 sm:grid-cols-2">
            <Field label="رقم الفاتورة" value={form.invoiceNumber} onChange={(v) => set({ invoiceNumber: v })} ltr />
            <Field label="الرقم الضريبي للبائع" value={form.sellerVat} onChange={(v) => set({ sellerVat: v })} ltr hint={vatHint(form.sellerVat)} />
            <Field label="الرقم الضريبي للمشتري" value={form.buyerVat} onChange={(v) => set({ buyerVat: v })} ltr hint={vatHint(form.buyerVat)} />
            <Field label="الصافي قبل الضريبة" value={form.subtotal} onChange={(v) => set({ subtotal: v })} ltr hint={amountHint(form.subtotal)} />
            <Field label="الضريبة" value={form.vat} onChange={(v) => set({ vat: v })} ltr hint={amountHint(form.vat)} />
            <Field label="الإجمالي (المستحق)" value={form.total} onChange={(v) => set({ total: v })} ltr hint={amountHint(form.total, true)} />
            <Field label="خصم بعد الضريبة (إن وُجد)" value={form.discount} onChange={(v) => set({ discount: v })} ltr hint={optionalHint(form.discount)} />
            <Field label="رسوم توصيل بعد الضريبة (إن وُجدت)" value={form.charges} onChange={(v) => set({ charges: v })} ltr hint={optionalHint(form.charges)} />
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted">تاريخ الفاتورة</span>
              <input
                type="date" max={todayInRiyadh()} value={form.invoiceDate} onChange={(e) => set({ invoiceDate: e.target.value })}
                className="nums min-h-11 w-full rounded-lg border border-line-input bg-raised px-2.5 text-sm sm:min-h-9"
              />
              {form.invoiceDate.slice(0, 7) !== initial.invoiceDate.slice(0, 7) && (
                <span className="mt-1 block text-[11px] text-warn"><T s="ستنتقل إلى شهر {0}، لأن شهر الفاتورة يُحدَّد من تاريخها" a={[form.invoiceDate.slice(0, 7)]} /></span>
              )}
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted">المورّد</span>
              <select
                value={form.supplierId} onChange={(e) => set({ supplierId: e.target.value })}
                className="min-h-11 w-full rounded-lg border border-line-input bg-raised px-2 text-sm sm:min-h-9"
              >
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {form.supplierId !== initial.supplierId && (
                <span className="mt-1 block text-[11px] text-warn">
                  {paidMinor > 0
                    ? <><T s="سيُلغى ما خُصّص لها من سداد المورّد السابق ({0}) ويعود رصيداً لك عنده، ثم يُخصم رصيدك عند المورّد الجديد." a={[<Money key="0" minor={paidMinor} />]} /></>
                    : "وتنتقل بنودها وأصنافها إلى المورّد الجديد."}
                </span>
              )}
            </label>
          </div>
          <SumCheck subtotal={form.subtotal} vat={form.vat} total={form.total} discount={form.discount} charges={form.charges} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              aria-busy={busy}
              type="button"
              onClick={save}
              disabled={busy || !dirty || unreadable}
              title={unreadable ? "صحّح المبلغ غير المفهوم أولاً" : !dirty ? "لم يتغيّر أي حقل" : undefined}
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
            {/* المعطَّلُ يقول لماذا في سطرٍ يُرى — `title` لا يظهر على الجوّال */}
            {!message && !busy && (unreadable || !dirty) && (
              <span className={`text-[11px] ${unreadable ? "font-bold text-warn" : "text-muted"}`}>
                {unreadable ? "صحّح المبلغ غير المفهوم أولاً" : "غيّر حقلاً ليُحفظ التصحيح"}
              </span>
            )}
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
    ? { tone: "ok", text: "رقم ضريبي صيغته سليمة" }
    : { tone: "warn", text: "يجب أن يكون 15 رقماً، يبدأ بـ3 وينتهي بـ3" };
}

function amountHint(v: string, required = false): Hint {
  if (!v.trim()) return required ? { tone: "danger", text: "الإجمالي مطلوب" } : { tone: "warn", text: "فارغ، فسيُحفظ «غير معروف»" };
  const minor = parseRiyals(v);
  if (minor === null) return { tone: "danger", text: "المبلغ غير مفهوم، اكتبه مثل 1250.50" };
  /* ما كُتب بأرقامٍ هنديّة أو بفواصل يُعرض كما سيُحفظ */
  return /[٠-٩۰-۹٬٫,]/.test(v) ? { tone: "ok", text: <><T s="سيُحفظ {0}" a={[<Money key="0" minor={minor} />]} /></> } : null;
}

/* الخصمُ والرسومُ فراغُهما «لا شيء» لا «غير معروف» — فلا يُنذَر عنهما */
function optionalHint(v: string): Hint {
  return v.trim() ? amountHint(v) : null;
}

function SumCheck({ subtotal, vat, total, discount, charges }: { subtotal: string; vat: string; total: string; discount: string; charges: string }) {
  const s = subtotal.trim() ? parseRiyals(subtotal) : null;
  const v = vat.trim() ? parseRiyals(vat) : null;
  const t = total.trim() ? parseRiyals(total) : null;
  if (s === null || v === null || t === null) return null;
  /* الحكمُ نفسُه الذي يحكم به الخادمُ والقاعدة — هنا عونٌ وهناك القرار */
  const check = checkInvoiceTotals(s, v, t, {
    discountMinor: discount.trim() ? parseRiyals(discount) : null,
    chargesMinor: charges.trim() ? parseRiyals(charges) : null,
  });
  const ok = check.verdict !== "MISMATCH";
  const sum = s + v - (check.discountMinor ?? 0) + (check.chargesMinor ?? 0);
  return (
    <p
      aria-live="polite"
      className={`mt-2.5 flex flex-wrap items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-bold ${ok ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn"}`}
    >
      <T s="{0}الصافي + الضريبة{1}{2} = {3}{4}" a={[ok ? <CircleCheck key="0" className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden /> : <TriangleAlert key="0" className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden />, check.discountMinor !== null && <Fragment key="1"> − الخصم</Fragment>, check.chargesMinor !== null && <Fragment key="2"> + الرسوم</Fragment>, <Money key="3" minor={sum} />, ok ? " (يطابق الإجمالي)" : <Fragment key="4"> <T s=" (يخالف الإجمالي بـ{0})" a={[<Money key="0" minor={Math.abs(sum - t)} />]} /></Fragment>]} /></p>
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
