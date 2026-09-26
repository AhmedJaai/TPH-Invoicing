"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, CalendarRange, Check, CircleAlert, CircleCheck, FileSpreadsheet, Info, Loader2, RotateCcw,
  TriangleAlert, Upload, X,
} from "lucide-react";
import { CATEGORY_LABEL, type TxCategory } from "@/lib/bank/rules";
import { postJson, request } from "@/lib/http-client";
import { DAY, INVOICE, TRANSACTION, countNoun, GROUP } from "@/lib/arabic";
import { formatDay } from "@/lib/riyadh-time";
import { Money } from "./money";
import { Badge, buttonClass } from "./ui";
import { toast } from "./ui-client";

interface Coverage {
  from: string | null;
  to: string | null;
  gaps: { start: string; end: string; days: number }[];
  overlaps: number;
  summary: string;
}

interface Summary {
  coverage?: Coverage;
  /** هل بلغ المحسِّن الحلّ الأمثل يقيناً، أم رجع إلى الجشع؟ */
  exact?: boolean;
  /** حدود القراءة المعلومة سلفاً — تُعرَض دائماً لا عند الخطأ. */
  notices?: string[];
  bank: string; accountNumber?: string;
  periodStart?: string; periodEnd?: string;
  totalRows: number; operational: number; payments: number;
  matchedTransactions: number; matchedInvoices: number;
  supplierOnly: number; unknown: number; duplicateGroups: number;
  openInvoicesBefore: number; warnings: number;
  classified: number;
  classifiedAmountMinor: number;
  byCategory: { category: string; label: string; count: number; amountMinor: number }[];
}

interface UnknownTx {
  id: string;
  date: string;
  amountMinor: number;
  description: string;
  suggestedAlias: string;
  suggestedCategory: TxCategory;
}

/** التصنيفات المعروضة — بلا UNKNOWN فهي الحالة لا خياراً. */
const CATEGORY_OPTIONS: TxCategory[] = [
  "SUPPLIER", "SALARY", "RENT", "ZAKAT", "UTILITY",
  "GOVERNMENT", "PERSONAL", "INTERNAL", "OTHER",
];

/** حصيلة المزامنة — ما الجديد قبل ما المعنى. */
interface SyncSummary {
  /** جديدٌ في شهرٍ مقفل — لا يُقيَّد */
  closedMonthRows?: number;
  closedMonths?: string[];
  inFile: number;
  alreadyKnown: number;
  added: number;
  ambiguous: number;
  byReference: number;
  ambiguousRows?: { date: string; amountMinor: number; description: string; reason: string }[];
}

interface Preview {
  summary: Summary;
  sync?: SyncSummary;
  preview: { date: string; amountMinor: number; supplierName?: string; invoiceNumbers: string[]; kind: string }[];
  unknown: UnknownTx[];
  supplierOnlyList: { date: string; amountMinor: number; supplierName: string }[];
}

export interface SupplierOption {
  id: string;
  nameAr: string;
}

const field = "min-h-11 rounded-lg border border-line-input bg-raised px-2.5 text-xs sm:min-h-9";

/**
 * صفّ لحركة بنكية لم تُعرف — يصنّفها المالك مرّة، فتصير قاعدةً تسري على
 * ما يشبهها في كل كشف بعده. وكشفُ الحساب ليس كلّه مورّدين: فيه رواتب
 * وإيجار وزكاة وكهرباء وتحويلات شخصية.
 */
function UnknownRow({
  tx,
  suppliers,
  onLearned,
}: {
  tx: UnknownTx;
  suppliers: SupplierOption[];
  onLearned: () => void;
}) {
  const [category, setCategory] = useState<TxCategory>(
    tx.suggestedCategory === "UNKNOWN" ? "SUPPLIER" : tx.suggestedCategory,
  );
  const [supplierId, setSupplierId] = useState("");
  const [pattern, setPattern] = useState(tx.suggestedAlias);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const needsSupplier = category === "SUPPLIER";
  const ready = pattern.trim().length >= 3 && (!needsSupplier || Boolean(supplierId));

  const save = async () => {
    if (!ready) return;
    setState("saving");
    const r = await postJson<{ message?: string }>("/api/bank-rule", {
      pattern: pattern.trim(),
      category,
      supplierId: needsSupplier ? supplierId : undefined,
    });
    setMessage(r.ok ? (r.data.message ?? "حُفظت") : r.error);
    setState(r.ok ? "saved" : "error");
    if (r.ok) onLearned();
  };

  return (
    <li className={`px-4 py-3 ${state === "saved" ? "bg-ok-bg" : ""}`}>
      <div className="flex items-baseline gap-3">
        <bdi className="w-20 shrink-0 text-[11px] text-muted">{formatDay(tx.date)}</bdi>
        <p className="min-w-0 flex-1 truncate text-xs text-ink-soft" dir="auto" title={tx.description}>
          {tx.description}
        </p>
        <span className="shrink-0 text-xs font-bold"><Money minor={tx.amountMinor} /></span>
      </div>

      {state === "saved" ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-bold text-ok">
          <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden /> {message}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            aria-label="باب الحركة"
            value={category}
            onChange={(e) => setCategory(e.target.value as TxCategory)}
            className={`min-w-[8rem] ${field}`}
          >
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>

          {needsSupplier && (
            <select
              aria-label="المورّد"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className={`min-w-[9rem] flex-1 ${field}`}
            >
              <option value="">اختر المورّد…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.nameAr}</option>
              ))}
            </select>
          )}

          <input
            aria-label="النصّ المميِّز في وصف الحركة"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="النصّ المميِّز في وصف الحركة"
            dir="auto"
            className={`min-w-[9rem] flex-1 ${field}`}
          />

          <button aria-busy={state === "saving"} onClick={save} disabled={!ready || state === "saving"} className={buttonClass("primary", "sm")}>
            صنّفها
          </button>

          {state === "error" && message && (
            <p role="alert" className="w-full text-[11px] font-bold text-danger">{message}</p>
          )}
        </div>
      )}
    </li>
  );
}

/* ─────────────────────────── الخطوات ─────────────────────────── */

/**
 * خطوات الاستيراد، ظاهرةً — والخطوةُ تُشتقّ من الحال لا تُخزَّن: حالٌ
 * ثانية تُخزَّن هي حالٌ ثانية قد تخالف الأولى.
 */
const STEPS = ["اختر الملفّ", "راجع المعاينة", "قيِّد الجديد", "النتيجة"] as const;

function FlowSteps({ current, failed }: { current: number; failed: boolean }) {
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label="خطوات الاستيراد">
      {STEPS.map((label, i) => {
        const state = i < current ? "done" : i === current ? (failed ? "failed" : "current") : "todo";
        return (
          <li key={label} className="min-w-0" aria-current={state === "current" ? "step" : undefined}>
            <span
              aria-hidden
              className={`block h-1 rounded-full ${
                state === "done" ? "bg-ok" : state === "current" ? "bg-accent" : state === "failed" ? "bg-danger" : "bg-sunken"
              }`}
            />
            <span className={`mt-1.5 flex items-center gap-1 text-[11px] ${state === "current" || state === "failed" ? "font-bold text-ink" : "text-muted"}`}>
              {state === "done" && <Check className="h-3 w-3 shrink-0 text-ok" strokeWidth={2.5} aria-hidden />}
              <span className="truncate">{label}</span>
              <span className="sr-only">
                {state === "done" ? " — تمّت" : state === "current" ? " — الخطوة الحاليّة" : state === "failed" ? " — تعثّرت" : ""}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ─────────────────────────── الاستيراد ─────────────────────────── */

export function BankImport({
  openInvoiceCount,
  suppliers,
}: {
  openInvoiceCount: number;
  suppliers: SupplierOption[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState<"reading" | "applying" | null>(null);
  const [data, setData] = useState<Preview | null>(null);
  const [error, setError] = useState<{ message: string; during: "reading" | "applying" } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  /** كم اسماً بنكياً تعلّمه النظام في هذه الجلسة — يفتح زرّ إعادة المطابقة */
  const [learned, setLearned] = useState(0);

  const send = useCallback(async (file: File, apply: boolean) => {
    setBusy(apply ? "applying" : "reading");
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      if (apply) body.append("apply", "true");
      const r = await request<Preview & { message?: string }>("/api/bank-import", { method: "POST", body });
      if (!r.ok) { setError({ message: r.error, during: apply ? "applying" : "reading" }); return; }
      if (apply) {
        /*
          رسالةُ الخادم تُعرض كما قالها — وكانت الشاشة تكتب نصّها هي:
          «طوبقت ٠ فاتورة من ٠ تحويلاً» عن كشفٍ مقيَّدٍ كلُّه من قبل.
        */
        const message = r.data.message ?? "اكتمل الاستيراد";
        setDone(message);
        setData(null);
        setLearned(0);
        toast({ tone: "ok", title: "استُورد الكشف", body: message });
        router.refresh();
      } else {
        setData(r.data);
      }
    } finally {
      setBusy(null);
    }
  }, [router]);

  function choose(f: File | undefined) {
    if (!f) return;
    fileRef.current = f;
    setFileName(f.name);
    setDone(null);
    setData(null);
    void send(f, false);
  }

  function reset() {
    fileRef.current = null;
    setFileName(null);
    setData(null);
    setError(null);
    setDone(null);
    setLearned(0);
    if (inputRef.current) inputRef.current.value = "";
  }

  const step = done ? 3 : busy === "applying" || error?.during === "applying" ? 2 : data ? 1 : 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
      <div className="border-b border-line-soft px-4 py-4 sm:px-5">
        <FlowSteps current={step} failed={error !== null} />
      </div>

      <div className="px-4 py-5 sm:px-5">
        {/* ── ١ · اختيار الملفّ ── */}
        {!data && !done && (
          <label
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); choose(e.dataTransfer.files?.[0]); }}
            className={`flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-5 py-9 text-center transition-colors focus-within:border-accent hover:border-accent-line ${
              dragging ? "border-accent bg-accent-soft/60" : "border-line-input bg-sunken/40"
            } ${busy ? "pointer-events-none" : ""}`}
          >
            {/* `sr-only` لا `hidden` — ما لا يُركَّز عليه لا يرفعه من لا يستعمل الفأرة */}
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.pdf"
              className="sr-only"
              disabled={busy !== null}
              onChange={(e) => choose(e.target.files?.[0])}
            />
            <span className="grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent">
              {busy === "reading"
                ? <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2} aria-hidden />
                : <Upload className="h-5 w-5" strokeWidth={2} aria-hidden />}
            </span>
            {busy === "reading" ? (
              <span role="status">
                <span className="block text-sm font-bold">يقرأ «{fileName}»…</span>
                <span className="mt-1 block text-xs text-muted">يعرف الجديد من المقيَّد ثمّ يرجّح المطابقات — قد يستغرق دقيقة. لا يُحفظ شيء بعد.</span>
              </span>
            ) : (
              <span>
                <span className="block text-sm font-bold">اختر ملفّ كشف الحساب أو أفلته هنا</span>
                <span className="mt-1 block text-xs text-muted">Excel أو CSV أو PDF نصّيّ من بنكك — تُعرَض عليك معاينةٌ ولا يُحفظ شيء قبل أن تقيّده.</span>
              </span>
            )}
            {!busy && <span className={buttonClass("secondary", "sm")}>تصفّح الملفّات</span>}
          </label>
        )}

        {/* ── التعثّر: يُقال ما وقع، ومعه طريقُ الرجوع ── */}
        {error && (
          <div role="alert" className="mt-4 flex flex-wrap items-start gap-3 rounded-xl border border-danger/25 bg-danger-bg px-4 py-3">
            <CircleAlert className="mt-0.5 h-[18px] w-[18px] shrink-0 text-danger" strokeWidth={2} aria-hidden />
            <div className="min-w-0 flex-1 text-xs leading-relaxed text-ink-soft">
              <p className="text-[13px] font-bold text-danger">
                {error.during === "applying" ? "لم يُقيَّد الكشف" : "تعذّرت قراءة الملفّ"}
              </p>
              <p className="mt-0.5">{error.message}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {fileName && (
                <button
                  type="button"
                  onClick={() => fileRef.current && send(fileRef.current, error.during === "applying")}
                  disabled={busy !== null}
                  className={buttonClass("secondary", "sm")}
                >
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  أعد المحاولة
                </button>
              )}
              <button type="button" onClick={reset} disabled={busy !== null} className={buttonClass("quiet", "sm")}>
                اختر ملفّاً آخر
              </button>
            </div>
          </div>
        )}

        {/* ── ٤ · النتيجة ── */}
        {done && (
          <div role="status" className="flex flex-wrap items-start gap-3 rounded-xl border border-ok/25 bg-ok-bg px-4 py-4">
            <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-ok" strokeWidth={2} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-ok">اكتمل الاستيراد</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">{done}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href="#queue" className={buttonClass("primary", "sm")}>
                انظر ما ينتظر قرارك
                <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              </a>
              <button type="button" onClick={reset} className={buttonClass("secondary", "sm")}>استورد كشفاً آخر</button>
            </div>
          </div>
        )}

        {/* ── ٢ · المعاينة ── */}
        {data && <PreviewPanel
          data={data}
          fileName={fileName}
          suppliers={suppliers}
          learned={learned}
          busy={busy}
          onLearned={() => setLearned((n) => n + 1)}
          onRematch={() => fileRef.current && send(fileRef.current, false)}
          onApply={() => fileRef.current && send(fileRef.current, true)}
          onCancel={reset}
        />}
      </div>

      {/*
        ── طريقة سداد أخرى ──

        كان هنا زرٌّ يسِم **كلّ** المفتوح مسدَّداً بتحويلٍ بنكيّ ولا ردّ له —
        ثمّ تصل الحوالة الحقيقيّة فتُقيَّد دفعةً ثانية. فأُزيل، والسداد اليدويّ
        صار فاتورةً فاتورة حيث تُرى — ويُسأل فيه من أين دُفعت.
      */}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line-soft bg-sunken/40 px-4 py-3 text-xs text-muted sm:px-5">
        <Info className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
        دفعتَ نقداً أو من حسابك الشخصيّ؟ يُسجَّل لكلّ فاتورةٍ وحدها من قائمة الفواتير.
        <Link href="/purchases/invoices?paid=OPEN" className="inline-flex min-h-11 items-center font-bold text-accent hover:underline sm:min-h-0">
          {openInvoiceCount > 0 ? `${countNoun(openInvoiceCount, INVOICE)} مفتوحة` : "قائمة الفواتير"}
          <ArrowLeft className="ms-0.5 h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        </Link>
      </p>
    </div>
  );
}

function PreviewPanel({
  data, fileName, suppliers, learned, busy, onLearned, onRematch, onApply, onCancel,
}: {
  data: Preview;
  fileName: string | null;
  suppliers: SupplierOption[];
  learned: number;
  busy: "reading" | "applying" | null;
  onLearned: () => void;
  onRematch: () => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const s = data.summary;
  const added = data.sync?.added ?? s.totalRows;
  const nothingNew = data.sync !== undefined && data.sync.added === 0;
  const learnedCats = s.byCategory.filter((c) => c.category !== "UNKNOWN" && c.category !== "SUPPLIER");

  return (
    <div className="space-y-4">
      {/* ── هويّة الملفّ ── */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-sunken px-4 py-3">
        <FileSpreadsheet className="h-5 w-5 shrink-0 text-ink-soft" strokeWidth={1.75} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold" dir="auto">{fileName ?? "كشف الحساب"}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
            <span>{s.bank}</span>
            {s.accountNumber && <span>· حساب <bdi dir="ltr" className="font-mono">{s.accountNumber}</bdi></span>}
            {s.periodStart && s.periodEnd && (
              <span className="inline-flex items-center gap-1">
                · <CalendarRange className="h-3 w-3" strokeWidth={2} aria-hidden />
                <bdi>{formatDay(s.periodStart)}</bdi> إلى <bdi>{formatDay(s.periodEnd)}</bdi>
              </span>
            )}
          </p>
        </div>
        <button type="button" onClick={onCancel} disabled={busy !== null} className={buttonClass("quiet", "sm")}>
          <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          ألغِ
        </button>
      </div>

      {/*
        المزامنة تُقال أوّلاً: صاحب العمل يريد أن يعرف ما الجديد، لا أن
        يُدخِل ملفّاً. وكان يُقال «أُضيفت ٣٢٧ حركة» عن ملفٍّ لم يُضِف واحدة.
      */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div>
          <p className="text-[1.6rem] font-bold leading-tight tracking-tight">
            {nothingNew ? "لا جديد في هذا الكشف" : `${countNoun(added, TRANSACTION)} جديدة`}
          </p>
          {data.sync && (
            <p className="mt-1 text-xs text-muted">
              <span className="nums">{data.sync.inFile}</span> في الملفّ · <span className="nums">{data.sync.alreadyKnown}</span> مسجّلة عندك
              {data.sync.byReference > 0 && ` (${countNoun(data.sync.byReference, TRANSACTION)} عرفناها برقم العمليّة)`}
            </p>
          )}
        </div>
        {!nothingNew && (
          <dl className="grid grid-cols-3 gap-2 text-center">
            <Mini label="ستُطابَق فواتير" value={s.matchedInvoices} tone="ok" />
            <Mini label="عُرف مورّدها بلا فاتورة" value={s.supplierOnly} />
            <Mini label="تحتاجك" value={s.unknown} tone={s.unknown > 0 ? "warn" : undefined} />
          </dl>
        )}
      </div>

      {/* ── ما يجب أن يُعرف قبل التقييد — الغائبُ لا يُرى ── */}
      {s.coverage && s.coverage.gaps.length > 0 && (
        <Warn title="فجوةٌ في التغطية — أيّامٌ لم يُستورَد كشفُها">
          <ul className="mt-1 space-y-0.5">
            {s.coverage.gaps.slice(0, 4).map((g, i) => (
              <li key={i}><bdi>{formatDay(g.start)}</bdi> إلى <bdi>{formatDay(g.end)}</bdi> ({countNoun(g.days, DAY)})</li>
            ))}
          </ul>
          <p className="mt-1">حركاتُ هذه الأيّام غائبة، ولن تظهر ناقصةً في أيّ تقرير — ارفع كشفها لتكتمل.</p>
        </Warn>
      )}
      {(data.sync?.closedMonthRows ?? 0) > 0 && (
        <Warn title={`${countNoun(data.sync?.closedMonthRows ?? 0, TRANSACTION)} في شهرٍ مقفل — لا تُقيَّد`}>
          ({(data.sync?.closedMonths ?? []).join("، ")}). إن كانت مقصودة فأعد فتح الشهر من «إقفال الشهر» ثمّ استورد الكشف ثانيةً.
        </Warn>
      )}
      {s.exact === false && (
        <Warn title="التوزيعُ تقريبيّ — لا مثبت">
          الاحتمالاتُ أكثر من أن تُستقصى كلُّها، فتوقّف البحث عند أفضل ما بلغه. ولذلك لا يُطابَق شيءٌ تلقائياً هنا: كلُّه اقتراحٌ ينتظر تأكيدك.
        </Warn>
      )}
      {s.duplicateGroups > 0 && (
        <Warn tone="danger" title={`${countNoun(s.duplicateGroups, GROUP)} يُشتبه بتكرار دفعها`}>
          راجعها بعد الاستيراد في «يحتاج قرارك».
        </Warn>
      )}
      {data.sync && data.sync.ambiguous > 0 && (
        <Warn title={`${countNoun(data.sync.ambiguous, TRANSACTION)} قد تكون مكرَّرة — لن تُضاف ولن تُحذف`}>
          <ul className="mt-1 space-y-1">
            {(data.sync.ambiguousRows ?? []).map((a, i) => (
              <li key={i}>
                <bdi>{formatDay(a.date)}</bdi> · <span className="font-bold"><Money minor={a.amountMinor} /></span> · <span dir="auto">{a.description}</span> — {a.reason}
              </li>
            ))}
          </ul>
        </Warn>
      )}
      {/* حدودُ القراءة المعلومة سلفاً — تُعرَض دائماً، لا حين يقع الخطأ */}
      {(s.notices ?? []).length > 0 && (
        <div className="rounded-xl border border-line bg-sunken/60 px-4 py-3 text-xs leading-relaxed text-ink-soft">
          <p className="flex items-center gap-1.5 font-bold text-ink"><Info className="h-3.5 w-3.5" strokeWidth={2} aria-hidden /> حدود هذه القراءة</p>
          <ul className="mt-1 space-y-0.5">
            {(s.notices ?? []).map((n, i) => <li key={i}>— {n}</li>)}
          </ul>
        </div>
      )}

      {learnedCats.length > 0 && (
        <div>
          <p className="text-[11px] font-bold text-muted">صُنّف بقواعدك</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {learnedCats.map((c) => (
              <li key={c.category}>
                <Badge>{c.label}: <span className="nums">{c.count}</span> · <Money minor={c.amountMinor} /></Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.preview.length > 0 && (
        <Block title="عيّنةٌ ممّا سيُطابَق">
          {data.preview.slice(0, 8).map((p, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-2 text-xs">
              <bdi className="w-20 shrink-0 text-muted">{formatDay(p.date)}</bdi>
              <span className="min-w-0 flex-1 truncate">{p.supplierName} — {countNoun(p.invoiceNumbers.length, INVOICE)}</span>
              <span className="nums-col shrink-0 font-bold"><Money minor={p.amountMinor} /></span>
            </li>
          ))}
        </Block>
      )}

      {data.unknown.length > 0 && (
        <div>
          <p className="flex items-center gap-2 text-[13px] font-bold">
            <TriangleAlert className="h-4 w-4 text-warn" strokeWidth={2} aria-hidden />
            {countNoun(data.unknown.length, TRANSACTION)} لم يُعرف مستفيدها
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
            صنّف كلّ حركةٍ مرّة — يُحفظ التصنيف قاعدةً تسري على ما يشبهها في كلّ كشفٍ بعده، ويخرج من مستحقّات المورّدين ما ليس لهم.
            {learned > 0 && ` صُنّف منها ${countNoun(learned, TRANSACTION)} حتى الآن.`}
          </p>
          <ul className="mt-2 max-h-[26rem] divide-y divide-line-soft overflow-y-auto rounded-xl border border-line">
            {data.unknown.map((u) => (
              <UnknownRow key={u.id} tx={u} suppliers={suppliers} onLearned={onLearned} />
            ))}
          </ul>
          {learned > 0 && (
            <button type="button" onClick={onRematch} disabled={busy !== null} className={`mt-2 w-full ${buttonClass("secondary", "sm")}`}>
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              {busy === "reading" ? "يعيد المطابقة…" : "أعد المعاينة بالأسماء الجديدة"}
            </button>
          )}
        </div>
      )}

      {data.supplierOnlyList.length > 0 && (
        <Block title="عُرف المورّد ولم تُطابَق فاتورة" hint="إمّا سُدّدت سلفاً أو لم تُرفع فاتورتُها — تظهر في الطابور بعد التقييد.">
          {data.supplierOnlyList.slice(0, 8).map((u, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-2 text-xs">
              <bdi className="w-20 shrink-0 text-muted">{formatDay(u.date)}</bdi>
              <span className="min-w-0 flex-1 truncate">{u.supplierName}</span>
              <span className="nums-col shrink-0 font-bold"><Money minor={u.amountMinor} /></span>
            </li>
          ))}
        </Block>
      )}

      {/* ── ٣ · التقييد: «لا جديد» ثمّ «قيِّد» كان يكتب استيراداً عن لا شيء ── */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-4">
        {nothingNew ? (
          <>
            <p className="flex-1 text-sm text-muted">لا شيء يُقيَّد من هذا الملفّ — كلُّ حركاته عندك.</p>
            <button type="button" onClick={onCancel} className={buttonClass("secondary")}>اختر ملفّاً آخر</button>
          </>
        ) : (
          <>
            <button type="button" onClick={onApply} disabled={busy !== null} className={buttonClass("primary")}>
              {busy === "applying"
                ? <><Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden /> يقيّد…</>
                : <><Check className="h-4 w-4" strokeWidth={2.25} aria-hidden /> قيِّد {countNoun(added, TRANSACTION)} وطابِق</>}
            </button>
            <button type="button" onClick={onCancel} disabled={busy !== null} className={buttonClass("quiet")}>ألغِ — لا يُحفظ شيء</button>
          </>
        )}
      </div>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" }) {
  return (
    <div className="rounded-lg bg-sunken px-3 py-2">
      <dt className="text-[10px] font-bold leading-tight text-muted">{label}</dt>
      <dd className={`nums mt-1 text-lg font-bold leading-none ${tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : ""}`}>{value}</dd>
    </div>
  );
}

function Warn({ title, tone = "warn", children }: { title: string; tone?: "warn" | "danger"; children: React.ReactNode }) {
  const skin = tone === "danger" ? "border-danger/25 bg-danger-bg text-danger" : "border-warn/25 bg-warn-bg text-warn";
  const Icon = tone === "danger" ? CircleAlert : TriangleAlert;
  return (
    <div className={`flex gap-3 rounded-xl border px-4 py-3 ${skin}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
      <div className="min-w-0 text-xs leading-relaxed text-ink-soft">
        <p className={`text-[13px] font-bold ${tone === "danger" ? "text-danger" : "text-warn"}`}>{title}</p>
        {children}
      </div>
    </div>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[13px] font-bold">{title}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
      <ul className="mt-2 divide-y divide-line-soft overflow-hidden rounded-xl border border-line">{children}</ul>
    </div>
  );
}
