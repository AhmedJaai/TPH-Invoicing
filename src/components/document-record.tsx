"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, FilePlus2, Plus, TriangleAlert } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { SimilarSuppliers, readSimilar, type SimilarSupplier } from "./similar-suppliers";
import { parseRiyals, TOTAL_ROUNDING_TOLERANCE_MINOR } from "@/lib/money";
import { normalizeDocumentDate } from "@/lib/document-date";
import { isValidSaudiVat } from "@/lib/validation";
import { formatMonth } from "@/lib/riyadh-time";
import { buttonClass } from "./ui-tokens";
import { Money } from "./money";
import { ActionButton, toast } from "./ui-client";
import { SupplierPicker } from "./supplier-picker";
import type { SuggestibleSupplier } from "@/lib/supplier-suggest";
import { T } from "@/components/i18n/t";

/**
 * «أكمِل الناقص وقيّدها» — في ملفّ المستند نفسه.
 *
 * الحقولُ ممتلئةٌ بما قرأه النموذج (ثمّ بما في اسم الملفّ)، والناقصُ فارغٌ
 * مُعلَّم. ثمّ خطوتان: **عاين** — يحكم الخادمُ ولا يكتب (حالُ الضريبة،
 * والشهر، وما يمنع) — ثمّ **قيّدها** بعد أن يُرى الحكم. والمتصفّحُ لا
 * يحسب شيئاً يُكتب: المبالغُ تُرسَل نصّاً كما كُتبت.
 */
type Kind = "TAX_INVOICE" | "SIMPLIFIED_INVOICE";

interface Verdict {
  recorded: boolean;
  invoiceId: string | null;
  month: string;
  totalMinor: number;
  taxStatus: string;
  inputVatStatus: string;
  blockers: string[];
  /** المانعُ كلُّه ممّا يُتجاوز بسببٍ مكتوب */
  overridable?: boolean;
  notes: string[];
}

const TAX_TEXT: Record<string, string> = {
  VALID: "فاتورة ضريبية مستوفية الشروط، وتُخصم ضريبتها",
  INVALID: "ينقصها بيان ضريبي مطلوب، فلا تُخصم ضريبتها",
  UNKNOWN: "بياناتها الضريبية غير معروفة",
  NOT_APPLICABLE: "لا تُقيَّد ضريبياً",
};

export function DocumentRecord({
  documentId,
  initial,
  suppliers,
  missing,
  fromName,
  canCreateSupplier,
  supplierText,
}: {
  documentId: string;
  initial: {
    kind: string;
    supplierId: string | null;
    invoiceNumber: string;
    invoiceDate: string;
    subtotal: string;
    vat: string;
    total: string;
    sellerVat: string;
    buyerVat: string;
  };
  suppliers: SuggestibleSupplier[];
  /** ما يمنع القيد بعينه — يُعلَّم حقلُه. */
  missing: string[];
  /** ما أُخذ من اسم الملفّ لا من القراءة — يُقال. */
  fromName: string[];
  canCreateSupplier: boolean;
  /** نصٌّ يُقترح منه المورّد — اسمُه كما قُرئ واسمُ الملفّ. */
  supplierText: string;
}) {
  const router = useRouter();
  const ids = useId();
  const [kind, setKind] = useState<Kind>(initial.kind === "SIMPLIFIED_INVOICE" ? "SIMPLIFIED_INVOICE" : "TAX_INVOICE");
  const [supplierId, setSupplierId] = useState(initial.supplierId ?? "");
  const [list, setList] = useState(suppliers);
  const [f, setF] = useState({
    invoiceNumber: initial.invoiceNumber,
    invoiceDate: initial.invoiceDate,
    subtotal: initial.subtotal,
    vat: initial.vat,
    total: initial.total,
    sellerVat: initial.sellerVat,
    buyerVat: initial.buyerVat,
  });
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [similar, setSimilar] = useState<SimilarSupplier[]>([]);

  const set = (patch: Partial<typeof f>) => { setF((x) => ({ ...x, ...patch })); setVerdict(null); };

  /* ── التحقّقُ أثناء الكتابة — عونٌ، والحكمُ للخادم ── */
  const date = normalizeDocumentDate(f.invoiceDate);
  const total = parseRiyals(f.total);
  const sub = f.subtotal.trim() ? parseRiyals(f.subtotal) : null;
  const vat = f.vat.trim() ? parseRiyals(f.vat) : null;
  const sumOk = sub !== null && vat !== null && total !== null ? Math.abs(sub + vat - total) <= TOTAL_ROUNDING_TOLERANCE_MINOR : null;
  const ready = Boolean(supplierId) && f.invoiceNumber.trim() !== "" && date !== null && total !== null
    && (f.subtotal.trim() === "" || sub !== null) && (f.vat.trim() === "" || vat !== null);
  const why = !supplierId ? "اختر المورّد" : !f.invoiceNumber.trim() ? "اكتب رقم الفاتورة" : !date ? "اكتب التاريخ" : total === null ? "اكتب الإجمالي" : "مبلغ غير مقروء";

  async function send(preview: boolean, override?: string): Promise<boolean> {
    setError(null);
    const r = await postJson<Verdict>("/api/document-record", {
      documentId, kind, supplierId, ...f, preview, ...(override ? { override } : {}),
    });
    if (!r.ok) { setError(r.error); return false; }
    setVerdict(r.data);
    if (!preview && r.data.recorded) {
      toast({
        tone: "ok",
        title: "سُجّلت الفاتورة",
        body: `دخلت في مستحقات ${formatMonth(r.data.month)}، وسُجّلت باسمك. يمكنك تصحيحها من صفحة الفاتورة.`,
        link: r.data.invoiceId ? { label: "افتح الفاتورة", href: `/purchases/invoices/${r.data.invoiceId}` } : undefined,
      });
      router.refresh();
    }
    return true;
  }

  async function createSupplier(confirmNew = false) {
    const nameAr = newName.trim();
    if (nameAr.length < 2) return false;
    const r = await postJson<{ supplier: { id: string; nameAr: string } }>("/api/supplier", {
      nameAr,
      vatNumber: isValidSaudiVat(f.sellerVat) ? f.sellerVat : undefined,
      ...(confirmNew ? { confirmNew: true } : {}),
    });
    if (!r.ok) {
      /* يشبه مسجَّلاً — يُسأل «أهو هو؟» ولا يُنشأ ثانٍ بصمت */
      const alike = r.status === 409 ? readSimilar(r.data) : [];
      setSimilar(alike);
      if (alike.length === 0) setError(r.error);
      return false;
    }
    setSimilar([]);
    setList((xs) => [...xs, { id: r.data.supplier.id, nameAr: r.data.supplier.nameAr }]);
    setSupplierId(r.data.supplier.id);
    setCreating(false);
    setNewName("");
    toast({ tone: "ok", title: "أُنشئ المورّد", body: r.data.supplier.nameAr });
    return true;
  }

  const miss = (word: string) => missing.some((m) => m.startsWith(word));

  /* ما غُيّر عن المقروء ولم يُقيَّد بعد — لوحُ الفحص يسأل قبل أن يرميه (`data-dirty`) */
  const touched = (Object.keys(f) as (keyof typeof f)[]).some((k) => f[k] !== initial[k]) || supplierId !== (initial.supplierId ?? "");

  return (
    <div className="space-y-4" data-dirty={touched ? "تسجيل المستند" : undefined}>
      {fromName.length > 0 && (
        <p className="rounded-lg bg-info-bg px-3 py-2 text-[11px] leading-relaxed text-info">
          <T s="{0} مأخوذ من اسم الملف لا من قراءة المستند، فقارنه بالورقة." a={[fromName.join(" و")]} /></p>
      )}

      <fieldset>
        <legend className="mb-1.5 text-[11px] font-bold text-muted">نوعها</legend>
        <div className="flex flex-wrap gap-1.5" role="radiogroup">
          {(["TAX_INVOICE", "SIMPLIFIED_INVOICE"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => { setKind(k); setVerdict(null); }}
              className={`min-h-11 rounded-full border px-3.5 text-xs font-bold transition-colors sm:min-h-8 ${
                kind === k ? "border-accent bg-accent-soft text-accent" : "border-line bg-raised text-ink-soft hover:bg-hover"
              }`}
            >
              {k === "TAX_INVOICE" ? "فاتورة ضريبية" : "فاتورة مبسطة"}
            </button>
          ))}
        </div>
      </fieldset>

      <div className={miss("المورّد") && !supplierId ? "rounded-xl border border-danger/30 bg-danger-bg/40 p-3" : ""}>
        {miss("المورّد") && !supplierId && (
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-danger">
            <T s="{0}لم يُعرف المورّد. اختره من القائمة، أو أنشئه إن لم يكن مسجّلاً" a={[<CircleAlert key="0" className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />]} /></p>
        )}
        <SupplierPicker text={supplierText} suppliers={list} value={supplierId} onChange={(id) => { setSupplierId(id); setVerdict(null); }} />
        {canCreateSupplier && !creating && (
          <button type="button" onClick={() => setCreating(true)} className={`mt-2 ${buttonClass("quiet", "sm")}`}>
            <T s="{0}مورّد جديد" a={[<Plus key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></button>
        )}
        {creating && (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="text-[11px] font-bold text-muted">اسمه بالعربية</span>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                className="mt-1 min-h-11 w-full rounded-lg border border-line-input bg-raised px-3 text-sm sm:min-h-9"
              />
            </label>
            <ActionButton variant="primary" size="sm" disabled={newName.trim().length < 2} reason="اكتب الاسم، حرفين على الأقل" onAction={() => createSupplier()}>
              أنشئه
            </ActionButton>
            <button type="button" onClick={() => { setCreating(false); setSimilar([]); }} className={buttonClass("quiet", "sm")}>إلغاء</button>
            <div className="w-full">
              <SimilarSuppliers
                similar={similar}
                onPick={(s) => {
                  setList((xs) => (xs.some((x) => x.id === s.id) ? xs : [...xs, { id: s.id, nameAr: s.nameAr }]));
                  setSupplierId(s.id);
                  setVerdict(null);
                  setSimilar([]);
                  setCreating(false);
                  setNewName("");
                }}
                onCreateAnyway={() => void createSupplier(true)}
              />
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 @lg:grid-cols-2">
        <Field id={`${ids}-n`} label="رقم الفاتورة" value={f.invoiceNumber} onChange={(v) => set({ invoiceNumber: v })} ltr
          missing={miss("رقم")} hint={!f.invoiceNumber.trim() ? { tone: "danger", text: "مطلوب، كما هو في الورقة" } : null} />
        <Field id={`${ids}-d`} label="التاريخ" value={f.invoiceDate} onChange={(v) => set({ invoiceDate: v })} ltr placeholder="2026-09-15"
          missing={miss("التاريخ")}
          hint={!f.invoiceDate.trim() ? { tone: "danger", text: "مطلوب، فبه يُعرف شهر الفاتورة" }
            : date ? { tone: "ok", text: <><T s="تُحسب في {0}" a={[formatMonth(date.slice(0, 7))]} /></> }
            : { tone: "danger", text: "التاريخ غير مفهوم، اكتبه هكذا: 2026-09-15 أو 15/09/2026" }} />
        <Field id={`${ids}-s`} label="الصافي قبل الضريبة" value={f.subtotal} onChange={(v) => set({ subtotal: v })} ltr decimal
          hint={f.subtotal.trim() && sub === null ? { tone: "danger", text: "المبلغ غير مفهوم" } : !f.subtotal.trim() ? { tone: "warn", text: "فارغ، فسيُحفظ «غير معروف»" } : null} />
        <Field id={`${ids}-v`} label="الضريبة" value={f.vat} onChange={(v) => set({ vat: v })} ltr decimal
          hint={f.vat.trim() && vat === null ? { tone: "danger", text: "المبلغ غير مفهوم" } : !f.vat.trim() ? { tone: "warn", text: "فارغ، فسيُحفظ «غير معروف»" } : null} />
        <Field id={`${ids}-t`} label="الإجمالي" value={f.total} onChange={(v) => set({ total: v })} ltr decimal missing={miss("الإجمالي")}
          hint={total === null ? { tone: "danger", text: f.total.trim() ? "المبلغ غير مفهوم" : "مطلوب" } : { tone: "ok", text: <><T s="سيُحفظ {0}" a={[<Money key="0" minor={total} />]} /></> }} />
        <Field id={`${ids}-sv`} label="الرقم الضريبي للبائع" value={f.sellerVat} onChange={(v) => set({ sellerVat: v })} ltr
          hint={f.sellerVat.trim() ? (isValidSaudiVat(f.sellerVat) ? { tone: "ok", text: "صيغته سليمة" } : { tone: "warn", text: "يجب أن يكون ١٥ رقماً، يبدأ بـ3 وينتهي بـ3" }) : null} />
        {/* رقمُ المنشأة كما على الورقة — كان يُرسَل ولا يُرى، فمن رأى «لا يطابق» لم يجد أين يصحّحه */}
        <Field id={`${ids}-bv`} label="الرقم الضريبي للمشتري (المنشأة)" value={f.buyerVat} onChange={(v) => set({ buyerVat: v })} ltr
          hint={f.buyerVat.trim() ? (isValidSaudiVat(f.buyerVat) ? { tone: "ok", text: "صيغته سليمة" } : { tone: "warn", text: "يجب أن يكون ١٥ رقماً، فقارنه بالورقة" }) : { tone: "warn", text: "فارغ، ولا تُخصم ضريبة الفاتورة بدون رقم المنشأة" }} />
      </div>

      {sumOk !== null && (
        <p className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-bold ${sumOk ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn"}`}>
          <T s="{0}الصافي + الضريبة = {1}{2}" a={[sumOk ? <CircleCheck className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden /> : <TriangleAlert className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />, <Money key="1" minor={(sub ?? 0) + (vat ?? 0)} />, sumOk ? " (يطابق الإجمالي)" : " (يخالف الإجمالي)"]} /></p>
      )}

      {/* ── حكمُ الخادم قبل القيد ── */}
      {verdict && !verdict.recorded && (
        <div aria-live="polite" className="animate-rise rounded-xl border border-line bg-sunken/60 p-3.5 text-xs leading-relaxed">
          <p className="font-bold">
            {verdict.blockers.length === 0 ? "الفاتورة جاهزة للتسجيل" : "الفاتورة غير جاهزة للتسجيل"}
          </p>
          <ul className="mt-1.5 space-y-1 text-ink-soft">
            <li><T s="تدخل في مستحقات {0} بمبلغ {1}" a={[<b key="0">{formatMonth(verdict.month)}</b>, <Money key="1" minor={verdict.totalMinor} />]} /></li>
            <li>{TAX_TEXT[verdict.taxStatus] ?? verdict.taxStatus}</li>
            {verdict.blockers.map((b) => <li key={b} className="font-bold text-danger">{b}</li>)}
            {verdict.notes.map((n) => <li key={n} className="text-warn">{n}</li>)}
          </ul>
        </div>
      )}

      {/*
        ── «قيّدها رغم ذلك» ──
        لما يُتجاوز وحده (رقمُ المشتري لا يطابق): الفاتورةُ لنا والقراءةُ أو الطباعةُ أخطأت.
        تُقيَّد بحكمها كما هو — لا تُخصم مدخلاتُها — والسببُ يُكتب في السجلّ باسمك.
      */}
      {verdict && !verdict.recorded && verdict.blockers.length > 0 && verdict.overridable && (
        <div className="rounded-xl border border-warn/30 bg-warn-bg/50 p-3.5">
          <label htmlFor={`${ids}-ov`} className="block text-xs font-bold text-warn">
            هل الفاتورة لمنشأتنا مع ذلك؟ اكتب السبب، وسيُسجَّل باسمك
          </label>
          <textarea
            id={`${ids}-ov`}
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            rows={2}
            placeholder="مثلاً: المورّد طبع رقمنا ناقصاً رقماً، والفاتورة باسم المنشأة"
            className="mt-1.5 w-full rounded-lg border border-line-input bg-raised px-2.5 py-2 text-sm"
          />
          <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
            تدخل في المستحقات ويمكن سدادها، لكن ضريبتها لا تُخصم حتى يصحّح المورّد الرقم.
          </p>
          <div className="mt-2">
            <ActionButton
              variant="secondary"
              size="sm"
              disabled={overrideReason.trim().length < 8}
              reason="اكتب سبباً واضحاً يفهمه غيرك بعد شهر"
              onAction={() => send(false, overrideReason.trim())}
            >
              <T s="{0}سجّلها مع ذلك" a={[<FilePlus2 key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></ActionButton>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-danger-bg px-3 py-2 text-[11px] font-bold text-danger">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {verdict && verdict.blockers.length === 0 && !verdict.recorded ? (
          <ActionButton variant="primary" onAction={() => send(false)}>
            <FilePlus2 className="h-4 w-4" strokeWidth={2} aria-hidden />
            <span>سجّل الفاتورة</span>
          </ActionButton>
        ) : (
          <ActionButton variant="primary" disabled={!ready} reason={why} showDone={false} onAction={() => send(true)}>
            <span>معاينة قبل التسجيل</span>
          </ActionButton>
        )}
        <p className="text-[11px] text-muted">
          {verdict && verdict.blockers.length === 0 ? "التسجيل يضيفها إلى المستحقات باسمك، ويمكنك إلغاؤها من صفحة الفاتورة إن أخطأت." : "المعاينة لا تسجّل شيئاً."}
        </p>
      </div>
    </div>
  );
}

type Hint = { tone: "ok" | "warn" | "danger"; text: React.ReactNode } | null;

function Field({
  id, label, value, onChange, ltr, decimal, hint, missing, placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  ltr?: boolean;
  decimal?: boolean;
  hint?: Hint;
  missing?: boolean;
  placeholder?: string;
}) {
  const hintId = `${id}-h`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-muted">
        {label}
        {missing && <span className="rounded-full bg-danger-bg px-1.5 text-[10px] text-danger">ناقص</span>}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        dir={ltr ? "ltr" : undefined}
        inputMode={decimal ? "decimal" : undefined}
        placeholder={placeholder}
        aria-invalid={hint?.tone === "danger" || undefined}
        aria-describedby={hint ? hintId : undefined}
        className={`min-h-11 w-full rounded-lg border bg-raised px-3 text-sm transition-colors sm:min-h-10 ${ltr ? "nums" : ""} ${
          hint?.tone === "danger" ? "border-danger" : "border-line-input"
        }`}
      />
      {hint && (
        <span id={hintId} className={`mt-1 block text-[11px] ${hint.tone === "ok" ? "text-ok" : hint.tone === "warn" ? "text-warn" : "text-danger"}`}>
          {hint.text}
        </span>
      )}
    </div>
  );
}
