"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Camera, Check, CircleAlert, CircleCheck, ExternalLink, FileText, FolderOpen, Info, Plus,
  RotateCw, TriangleAlert, Upload, X,
} from "lucide-react";
import { formatRiyalsDisplay } from "@/lib/money";
import { NETWORK_ERROR, postJson, readResponse, request } from "@/lib/http-client";
import { FIELD, FILE, countNoun } from "@/lib/arabic";
import { ISSUE } from "@/lib/issue-codes";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";
import { Money } from "./money";
import { onCaptured, takeCaptured } from "@/lib/capture-queue";

interface Finding {
  code: string;
  severity: "INFO" | "WARN" | "BLOCKER";
  message: string;
}

interface AnalysisResponse {
  originalFileName: string;
  sizeBytes: number;
  model?: string;
  provider?: string;
  extraction?: Record<string, unknown>;
  result: {
    documentKind: string;
    supplier?: { id: string; slug: string; nameAr: string };
    supplierCandidates: { id: string; slug: string; nameAr: string }[];
    invoiceNumber?: string;
    invoiceDate?: string;
    periodMonth?: string;
    subtotalMinor?: number;
    vatMinor?: number;
    totalMinor?: number;
    sellerVat?: string;
    buyerVat?: string;
    beneficiary?: string;
    proposedFileName?: string;
    proposedFolderPath?: string;
    proposedFolderName?: string;
    isTaxValid: boolean;
    inputVatEligible: boolean;
    isFixedAsset: boolean;
    findings: Finding[];
    lowConfidenceFields: string[];
    canArchive: boolean;
  };
}

interface Archived {
  fileName: string;
  folder: string;
  link?: string;
  renamed: boolean;
  /** رفعه من لا يرى المبالغ — ينتظر من يؤكّدها. */
  needsReview: boolean;
}

/**
 * مسارُ الملفّ الواحد: يُقرأ ← يُراجَع ← يُؤرشَف. ولكلّ مرحلةٍ شكلُها في
 * القائمة، فيُرى في لمحةٍ أين كلُّ ملفٍّ وما ينتظره.
 *
 * `previewUrl` رابطٌ محلّيّ للملفّ نفسه (`blob:`) — تُقارَن القراءةُ بالورقة
 * بجانبها لا في نافذةٍ أخرى. ولا يغادر الجهاز.
 */
type Item =
  | { id: string; fileName: string; state: "reading"; startedAt: number; previewUrl: string; mime: string }
  /** `file` لما يُعاد: فشلٌ عابر لا يُطلب له البحثُ عن الملفّ ثانيةً */
  | { id: string; fileName: string; state: "failed"; error: string; file?: File; previewUrl?: string; mime: string }
  | {
      id: string;
      fileName: string;
      state: "done";
      data: AnalysisResponse;
      edited: Record<string, string>;
      fileBase64: string;
      mimeType: string;
      previewUrl: string;
      archiving?: boolean;
      startedAt?: number;
      finishedInMs?: number;
      archiveError?: string;
    }
  | { id: string; fileName: string; state: "archived"; archived: Archived; previewUrl: string; mime: string };

const KIND_LABEL: Record<string, string> = {
  TAX_INVOICE: "فاتورة ضريبية",
  SIMPLIFIED_INVOICE: "فاتورة مبسطة",
  STATEMENT: "كشف حساب",
  QUOTATION: "عرض سعر",
  PROFORMA: "فاتورة مبدئية",
  RECEIPT: "إيصال سداد",
  CASH_RECEIPT: "إيصال نقدي",
  CONTRACT: "عقد",
  UTILITY: "مرافق وحكومي",
  UNKNOWN: "غير محدَّد",
};

/** أسماءُ الثقة كما يكتبها مسارُ القراءة (`pipeline.ts`) — عربيّةٌ لا مفاتيح. */
const LOW = {
  supplier: "المورد",
  number: "رقم الفاتورة",
  date: "التاريخ",
  amounts: "المبالغ",
} as const;
/** حقولٌ لا تُحرَّر هنا — يُقال إنّها ضعيفة ولا يُعرَض لها حقل. */
const LOW_OTHER: Record<string, string> = { النوع: "نوع المستند", "الأرقام الضريبية": "الأرقام الضريبيّة" };

const MAX_BYTES = 3 * 1024 * 1024;

/* ─────────────────────────── الأجزاء الصغيرة ─────────────────────────── */

/**
 * عدّادٌ حيّ — الطلبُ الواحد لا يبلّغ عن تقدّمه، فلا نسبةَ تُخترَع.
 * الشريطُ يدلّ على أنّ العمل جارٍ، والثواني هي المعلومة الصادقة.
 */
function Elapsed({ startedAt, slowAfter, slowText, text }: { startedAt?: number; slowAfter: number; slowText: string; text: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [startedAt]);
  const slow = elapsed >= slowAfter;
  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className={slow ? "font-bold text-warn" : "text-ink-soft"} aria-live="polite">{slow ? slowText : text}</span>
        <span className="nums shrink-0 text-muted" dir="ltr">{elapsed}s</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken">
        <div className="upload-bar h-full w-1/3 rounded-full bg-accent" />
      </div>
    </div>
  );
}

type StepState = "done" | "current" | "todo" | "failed";

/** قراءة ← مراجعة ← أرشفة: أين الملفّ الآن. */
function Steps({ at }: { at: [StepState, StepState, StepState] }) {
  const names = ["قراءة", "مراجعة", "أرشفة"];
  return (
    <ol className="flex items-center gap-1.5 text-[11px]" aria-label="مراحل الملفّ">
      {names.map((n, i) => {
        const s = at[i];
        return (
          <li key={n} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden className={`h-px w-3 sm:w-5 ${at[i - 1] === "done" ? "bg-ok" : "bg-line"}`} />}
            <span
              className={`inline-flex items-center gap-1 font-bold ${
                s === "done" ? "text-ok" : s === "current" ? "text-accent" : s === "failed" ? "text-danger" : "text-muted"
              }`}
            >
              <span
                aria-hidden
                className={`grid h-4 w-4 place-items-center rounded-full border ${
                  s === "done" ? "border-ok bg-ok text-raised"
                  : s === "current" ? "border-accent bg-accent-soft"
                  : s === "failed" ? "border-danger bg-danger-bg"
                  : "border-line"
                }`}
              >
                {s === "done" ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : s === "failed" ? <X className="h-2.5 w-2.5" strokeWidth={3} /> : s === "current" ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> : null}
              </span>
              {n}
              <span className="sr-only">
                {s === "done" ? " — تمّت" : s === "current" ? " — الآن" : s === "failed" ? " — تعثّرت" : ""}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * حقلٌ يُصحَّح بيد — والضعيفُ منه يُقال بكلمةٍ ورمز، لا بلونٍ وحده.
 */
function Field({
  id,
  label,
  value,
  weak,
  onChange,
  type = "text",
  inputMode,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  weak?: boolean;
  onChange: (v: string) => void;
  /** التاريخ `date` يفتح منتقي التاريخ على الجوّال بدل لوحة الأحرف. */
  type?: "text" | "date";
  /** المبالغ `decimal` تفتح لوحة الأرقام. */
  inputMode?: "decimal" | "numeric" | "text";
  placeholder?: string;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="flex items-center justify-between gap-2 text-xs">
        <span className="font-bold text-ink-soft">{label}</span>
        {weak && (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-warn">
            <TriangleAlert className="h-3 w-3" strokeWidth={2.25} aria-hidden />
            راجِعه
          </span>
        )}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        inputMode={inputMode}
        placeholder={placeholder ?? "لم يُقرأ — اكتبه من الورقة"}
        aria-describedby={weak ? `${id}-weak` : undefined}
        dir="auto"
        className={`nums mt-1.5 min-h-11 w-full rounded-lg border bg-raised px-3 text-sm placeholder:text-muted placeholder:font-sans sm:min-h-10 ${
          weak ? "border-warn bg-warn-bg/40" : "border-line-input"
        }`}
      />
      {weak && <p id={`${id}-weak`} className="mt-1 text-[11px] text-warn">قُرئ بثقةٍ ضعيفة — قارنه بالورقة.</p>}
    </div>
  );
}

function Group({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <legend className="text-[11px] font-bold tracking-wide text-muted">{title}</legend>
        {aside}
      </div>
      {children}
    </fieldset>
  );
}

export interface SupplierOption {
  id: string;
  nameAr: string;
}

/**
 * اختيار المورّد أو إنشاؤه.
 *
 * المورّد غير المعروف كان طريقاً مسدوداً: الخادم يرفض الأرشفة بلا مورّد،
 * والشاشة تقول «غير معروف» ولا تتيح شيئاً. فيقف صاحب العمل أمام فاتورة
 * صحيحة لا يستطيع حفظها.
 */
function SupplierPicker({
  id,
  detected,
  candidates,
  suppliers,
  chosen,
  weak,
  onChoose,
  onCreated,
  canCreate = true,
}: {
  id: string;
  /** إنشاء المورّد يحتاج `supplier:edit` — مدير المشتريات يختار ولا يُنشئ */
  canCreate?: boolean;
  detected?: SupplierOption;
  candidates: { id: string; nameAr: string }[];
  suppliers: SupplierOption[];
  chosen?: SupplierOption;
  weak?: boolean;
  onChoose: (s: SupplierOption) => void;
  onCreated: (s: SupplierOption) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = chosen ?? detected;

  const create = async () => {
    const nameAr = name.trim();
    if (nameAr.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<{ supplier: { id: string; nameAr: string } }>("/api/supplier", { nameAr });
      if (!r.ok) { setError(r.error); return; }
      onCreated({ id: r.data.supplier.id, nameAr: r.data.supplier.nameAr });
      toast({ tone: "ok", title: "أُنشئ المورّد", body: r.data.supplier.nameAr });
      setCreating(false);
      setName("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label htmlFor={id} className="flex items-center justify-between gap-2 text-xs">
        <span className="font-bold text-ink-soft">المورّد</span>
        {!active ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-danger">
            <CircleAlert className="h-3 w-3" strokeWidth={2.25} aria-hidden />
            لم يُعرف — اختره أو أنشئه
          </span>
        ) : chosen ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-ok">
            <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden />
            اخترتَه
          </span>
        ) : weak ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-warn">
            <TriangleAlert className="h-3 w-3" strokeWidth={2.25} aria-hidden />
            راجِعه
          </span>
        ) : (
          <span className="text-[11px] text-muted">عرفه النظام</span>
        )}
      </label>

      <select
        id={id}
        value={active?.id ?? ""}
        onChange={(e) => {
          const sup = suppliers.find((x) => x.id === e.target.value)
            ?? candidates.find((x) => x.id === e.target.value);
          if (sup) onChoose({ id: sup.id, nameAr: sup.nameAr });
        }}
        className={`mt-1.5 min-h-11 w-full rounded-lg border bg-raised px-3 text-sm font-bold sm:min-h-10 ${
          !active ? "border-danger" : weak && !chosen ? "border-warn bg-warn-bg/40" : "border-line-input"
        }`}
      >
        <option value="">اختر المورّد…</option>
        {candidates.length > 0 && (
          <optgroup label="مرشّحون من قراءة الملف">
            {candidates.map((c) => (
              <option key={`c-${c.id}`} value={c.id}>{c.nameAr}</option>
            ))}
          </optgroup>
        )}
        <optgroup label="كل المورّدين">
          {suppliers.map((x) => (
            <option key={x.id} value={x.id}>{x.nameAr}</option>
          ))}
        </optgroup>
      </select>

      {creating ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <input
            aria-label="اسم المورّد الجديد"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
            placeholder="اسم المورّد كما على الفاتورة"
            dir="auto"
            autoFocus
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-input bg-raised px-3 text-sm sm:min-h-9"
          />
          <button
            aria-busy={busy}
            type="button"
            onClick={() => void create()}
            disabled={busy || name.trim().length < 2}
            className={buttonClass("primary", "sm")}
          >
            أنشئه
          </button>
          <button type="button" onClick={() => { setCreating(false); setError(null); }} className={buttonClass("quiet", "sm")}>
            إلغاء
          </button>
        </div>
      ) : canCreate ? (
        <button type="button" onClick={() => setCreating(true)} className={`mt-1.5 ${buttonClass("quiet", "sm")} -ms-2`}>
          <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          مورّد جديد
        </button>
      ) : null}

      {error && <p role="alert" className="mt-1 text-[11px] font-bold text-danger">{error}</p>}
    </div>
  );
}

/** الورقةُ بجانب القراءة — صورةٌ تُعرَض، وPDF يُضمَّن على الحاسوب. */
function Paper({ url, mime, name }: { url: string; mime: string; name: string }) {
  if (mime.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element -- رابطٌ محلّيّ (blob:) لا يمرّ بمحسِّن الصور
    return <img src={url} alt={`الورقة: ${name}`} className="mx-auto max-h-[70vh] w-full rounded-lg object-contain" />;
  }
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) {
    /* `iframe` لا `object`: سياسةُ المحتوى تمنع `object-src` كلَّه (`next.config.ts`) */
    return <iframe src={url} title={`الورقة: ${name}`} className="h-[70vh] w-full rounded-lg border-0 bg-raised" />;
  }
  return <p className="p-4 text-xs text-muted">لا معاينة لهذا النوع.</p>;
}

/* ─────────────────────────── القارئ ─────────────────────────── */

export function Uploader({
  canSeeAmounts = true,
  canCreateSupplier = true,
  suppliers: initialSuppliers = [],
}: {
  canSeeAmounts?: boolean;
  canCreateSupplier?: boolean;
  suppliers?: SupplierOption[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  /** قائمة المورّدين، تنمو حين يُنشئ المستخدم مورّداً جديداً من هنا */
  const [suppliers, setSuppliers] = useState<SupplierOption[]>(initialSuppliers);
  /** المورّد الذي اختاره المستخدم لكل ملف، يغلب ما استنتجه النظام */
  const [chosen, setChosen] = useState<Record<string, SupplierOption>>({});
  const [dragging, setDragging] = useState(false);

  /**
   * مرجع حيّ للعناصر.
   *
   * قراءة الحالة من داخل دالة تحديث setState خطأ: React ينفّذها متأخّراً
   * وقد يكرّرها، فتبقى القيمة المقروءة فارغة ويخرج الكود صامتاً — وهو ما
   * كان يُبقي زرّ الرفع على «يرفع…» بلا أن يُرسَل طلب أصلاً.
   */
  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;

  /* روابطُ المعاينة تُحرَّر حين تُغادَر الصفحة — لا تبقى ملفّاتٌ في الذاكرة */
  const urls = useRef(new Set<string>());
  useEffect(() => {
    const all = urls.current;
    return () => { all.forEach((u) => URL.revokeObjectURL(u)); all.clear(); };
  }, []);

  const analyze = useCallback(async (file: File) => {
    const id = `${file.name}-${Date.now()}-${Math.random()}`;

    /* الحدّ يُقال قبل الإرسال — لا ٤١٣ نصّيّ من المنصّة بعده */
    if (file.size > MAX_BYTES) {
      setItems((prev) => [{
        id, fileName: file.name, state: "failed", mime: file.type,
        error: "الملف أكبر من ٣ ميجابايت — حدّ الأرشفة. صغّره (صوّره بدقّة أقلّ أو اضغط الـPDF) ثمّ أعد المحاولة.",
      }, ...prev]);
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    urls.current.add(previewUrl);
    setItems((prev) => [{ id, fileName: file.name, state: "reading", startedAt: Date.now(), previewUrl, mime: file.type }, ...prev]);

    // نحتفظ بالبايتات لأنّ الأرشفة ترفع الملف الأصلي نفسه لا نسخة معاد بناؤها
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const fileBase64 = btoa(binary);

    const failed = (error: string): Item => ({ id, fileName: file.name, state: "failed", error, file, previewUrl, mime: file.type });

    try {
      const body = new FormData();
      body.append("file", file);
      const r = await request<AnalysisResponse>("/api/analyze", { method: "POST", body });

      if (!r.ok) {
        setItems((prev) => prev.map((it) => (it.id === id ? failed(r.error) : it)));
        return;
      }

      const data = r.data;
      setItems((prev) =>
        prev.map((it) =>
          it.id === id
            ? {
                id,
                fileName: file.name,
                state: "done",
                data,
                fileBase64,
                mimeType: file.type,
                previewUrl,
                edited: {
                  invoiceNumber: data.result.invoiceNumber ?? "",
                  invoiceDate: data.result.invoiceDate ?? "",
                  total: data.result.totalMinor !== undefined ? formatRiyalsDisplay(data.result.totalMinor) : "",
                  vat: data.result.vatMinor !== undefined ? formatRiyalsDisplay(data.result.vatMinor) : "",
                  fileName: data.result.proposedFileName ?? "",
                },
              }
            : it,
        ),
      );
    } catch (e) {
      setItems((prev) => prev.map((it) => (it.id === id ? failed((e as Error).message) : it)));
    }
  }, []);

  const editField = useCallback((id: string, key: string, value: string) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === id && it.state === "done" ? { ...it, edited: { ...it.edited, [key]: value } } : it,
      ),
    );
  }, []);

  const remove = useCallback((id: string) => {
    const it = itemsRef.current.find((x) => x.id === id);
    if (it?.previewUrl) { URL.revokeObjectURL(it.previewUrl); urls.current.delete(it.previewUrl); }
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const archive = useCallback(async (id: string) => {
    const it = itemsRef.current.find((x) => x.id === id);
    if (!it || it.state !== "done" || it.archiving) return;
    const r = it.data.result;

    setItems((prev) =>
      prev.map((x) =>
        x.id === id && x.state === "done"
          ? { ...x, archiving: true, archiveError: undefined, startedAt: Date.now() }
          : x,
      ),
    );

    // مهلة صريحة: الطلب الذي لا يردّ خلال دقيقتين يُلغى برسالة مفهومة
    // بدل أن يبقى الزرّ «يرفع…» إلى الأبد.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 120_000);

    try {
      /* الحمولةُ كما هي — الخادمُ يعيد الحكم ويحسب؛ الشاشةُ لا تقرّر شيئاً */
      const res = await fetch("/api/archive", {
        method: "POST",
        signal: abort.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: it.edited.fileName || r.proposedFileName,
          folderName: r.proposedFolderName,
          periodMonth: r.periodMonth,
          mimeType: it.mimeType,
          fileBase64: it.fileBase64,
          documentKind: r.documentKind,
          supplierId: chosen[id]?.id ?? r.supplier?.id,
          invoiceNumber: it.edited.invoiceNumber,
          invoiceDate: it.edited.invoiceDate,
          subtotal: r.subtotalMinor !== undefined ? String(r.subtotalMinor / 100) : "",
          vat: it.edited.vat.replace(/,/g, ""),
          total: it.edited.total.replace(/,/g, ""),
          sellerVat: r.sellerVat,
          buyerVat: r.buyerVat,
          beneficiary: r.beneficiary,
          isTaxValid: r.isTaxValid,
          inputVatEligible: r.inputVatEligible,
          isFixedAsset: r.isFixedAsset,
          findings: r.findings,
          lines: (it.data.extraction as { lines?: unknown[] } | undefined)?.lines ?? [],
        }),
      });
      const read = await readResponse<{ fileName: string; webViewLink?: string; renamed?: boolean; needsReview?: boolean }>(res);

      if (read.ok) {
        const json = read.data;
        const done: Archived = {
          fileName: json.fileName,
          folder: r.proposedFolderPath ?? "",
          link: json.webViewLink,
          renamed: Boolean(json.renamed),
          needsReview: Boolean(json.needsReview),
        };
        /* البطاقةُ أدّت غرضها: تصير سطراً مختصراً وتُخلي الشاشة للملفّ التالي */
        setItems((prev) =>
          prev.map((x) =>
            x.id === id && x.state === "done"
              ? { id, fileName: x.fileName, state: "archived", archived: done, previewUrl: x.previewUrl, mime: x.mimeType }
              : x,
          ),
        );
        toast({
          tone: "ok",
          title: "أُرشف المستند",
          body: done.needsReview ? "وينتظر من يرى المبالغ ليؤكّدها." : json.fileName,
        });
        // تحديث أرقام الصفحة: عدد المستندات المؤرشفة وغيرها
        router.refresh();
      } else {
        setItems((prev) =>
          prev.map((x) =>
            x.id === id && x.state === "done"
              ? {
                  ...x,
                  archiving: false,
                  finishedInMs: Date.now() - (x.startedAt ?? Date.now()),
                  archiveError: read.error,
                }
              : x,
          ),
        );
      }
    } catch (e) {
      const aborted = (e as Error).name === "AbortError";
      setItems((prev) =>
        prev.map((x) =>
          x.id === id && x.state === "done"
            ? {
                ...x,
                archiving: false,
                finishedInMs: Date.now() - (x.startedAt ?? Date.now()),
                archiveError: aborted
                  ? "تأخّر الخادم أكثر من دقيقتين ولم يردّ. تحقّق من الدرايف قبل إعادة المحاولة."
                  : NETWORK_ERROR,
              }
            : x,
        ),
      );
    } finally {
      clearTimeout(timer);
    }
  }, [router, chosen]);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return;
      for (const f of Array.from(files)) void analyze(f);
    },
    [analyze],
  );

  /*
    ما التقطه زرُّ الكاميرا أو أُفلِت في صفحةٍ أخرى يصل هنا — يُقرأ حين
    تُركَّب الصفحة، وما يصل بعدها يُقرأ حين يصل.
  */
  useEffect(() => {
    const take = () => {
      for (const f of takeCaptured()) void analyze(f);
    };
    take();
    return onCaptured(take);
  }, [analyze]);

  const count = (s: Item["state"]) => items.filter((i) => i.state === s).length;
  const reading = count("reading");
  const review = count("done");
  const archivedN = count("archived");
  const failedN = count("failed");
  const compact = items.length > 0;

  return (
    <section aria-label="ارفع مستنداً">
      {/*
        ── منطقة الالتقاط ──

        على الجوّال زرّان بعرض الشاشة: الكاميرا أوّلاً (`capture="environment"`
        تفتح الخلفيّة مباشرةً) ثمّ الملفّات. وعلى الحاسوب منطقةُ إفلاتٍ
        كبيرة. وكلُّ زرٍّ `label` يلفّ حقلاً `sr-only` لا `hidden` — فيُبلَغ
        بلوحة المفاتيح ويُقرأ بقارئ الشاشة. و`data-dropzone` يقول لإفلات
        القشرة إنّ هذه المنطقة تتولّى ما يُفلَت عليها.
      */}
      <div
        data-dropzone=""
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`rounded-2xl border-2 border-dashed border-line-input bg-raised/70 transition-colors ${dragging ? "dropping" : ""} ${
          compact ? "p-3 sm:p-4" : "p-4 sm:px-8 sm:py-12"
        }`}
      >
        <div className={compact ? "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" : "text-center"}>
          {!compact && (
            <span className="mx-auto hidden h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent sm:grid">
              <Upload className="h-6 w-6" strokeWidth={1.75} aria-hidden />
            </span>
          )}
          <div className={compact ? "min-w-0" : "sm:mt-4"}>
            <p className={`font-bold ${compact ? "text-sm" : "text-lg sm:text-xl"}`}>
              {dragging ? "أفلِت الملفّات هنا" : compact ? "ملفٌّ آخر؟" : (
                <>
                  <span className="sm:hidden">صوّر الفاتورة أو اختر ملفّها</span>
                  <span className="hidden sm:inline">اسحب الفواتير هنا</span>
                </>
              )}
            </p>
            {!compact && (
              <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-ink-soft">
                <span className="hidden sm:inline">أو اخترها من جهازك — صوراً أو PDF، ملفّاً أو عدّة ملفّات. </span>
                اسمُ الملفّ الأصليّ لا يهمّ: يقرأ النظامُ الورقةَ نفسها.
              </p>
            )}
          </div>

          <div className={`flex flex-col gap-2 sm:flex-row ${compact ? "" : "mt-5 sm:justify-center"}`}>
            <label className={`${buttonClass(compact ? "secondary" : "primary", compact ? "md" : "lg")} cursor-pointer focus-within:outline-2 focus-within:outline-[var(--ring)] sm:hidden`}>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
              />
              <Camera className="h-5 w-5" strokeWidth={2} aria-hidden />
              صوّر بالكاميرا
            </label>
            <label
              className={`${buttonClass(compact ? "secondary" : "secondary", compact ? "md" : "lg")} cursor-pointer focus-within:outline-2 focus-within:outline-[var(--ring)] ${
                compact ? "" : "sm:bg-accent sm:text-accent-ink sm:border-transparent sm:hover:bg-accent-strong"
              }`}
            >
              <input
                type="file"
                multiple
                accept=".pdf,image/*"
                className="sr-only"
                onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
              />
              <FolderOpen className="h-5 w-5" strokeWidth={2} aria-hidden />
              اختر ملفّات
            </label>
          </div>
        </div>
        {!compact && (
          <p className="mt-5 text-center text-[11px] text-muted">
            حتى ٣ ميجابايت للملفّ · لا يُحفَظ شيءٌ قبل أن تؤكّد ما قُرئ
          </p>
        )}
      </div>

      {/* ── ما في هذه الجلسة ── */}
      {items.length > 0 && (
        <div className="mt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-bold">
              في هذه الجلسة <span className="nums ms-1 rounded-full bg-sunken px-2 py-0.5 text-[11px] text-ink-soft">{items.length}</span>
            </h2>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted" aria-live="polite">
              {reading > 0 && <span>يُقرأ {countNoun(reading, FILE)}</span>}
              {review > 0 && <span className="font-bold text-accent">ينتظر تأكيدك {countNoun(review, FILE)}</span>}
              {archivedN > 0 && <span className="text-ok">أُرشف {countNoun(archivedN, FILE)}</span>}
              {failedN > 0 && (
                /*
                  «مسح» كان يرمي كلّ القراءات — ومنها ما دُفع ثمنُ قراءته ولم
                  يُرفع بعد. فصار يمسح ما فشل وحده.
                */
                <button
                  type="button"
                  onClick={() => items.filter((i) => i.state === "failed").forEach((i) => remove(i.id))}
                  className={buttonClass("quiet", "sm")}
                >
                  امسح ما تعثّر ({failedN})
                </button>
              )}
            </p>
          </div>

          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id}>
                {item.state === "reading" ? (
                  <Row name={item.fileName} steps={["current", "todo", "todo"]}>
                    <Elapsed startedAt={item.startedAt} slowAfter={25} text="يقرأ الورقة ويستخرج حقولها…" slowText="القراءة أبطأ من المعتاد — ما زالت جارية" />
                  </Row>
                ) : item.state === "failed" ? (
                  <Row
                    name={item.fileName}
                    steps={["failed", "todo", "todo"]}
                    tone="danger"
                    onRemove={() => remove(item.id)}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <p role="alert" className="flex min-w-0 flex-1 items-start gap-2 text-xs leading-relaxed text-danger">
                        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                        <span>{item.error}</span>
                      </p>
                      {item.file && (
                        <button
                          type="button"
                          onClick={() => {
                            const file = item.file!;
                            remove(item.id);
                            void analyze(file);
                          }}
                          className={buttonClass("secondary", "sm")}
                        >
                          <RotateCw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                          أعد القراءة
                        </button>
                      )}
                    </div>
                  </Row>
                ) : item.state === "archived" ? (
                  <Row name={item.archived.fileName} steps={["done", "done", "done"]} tone="ok" mono>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <p className="min-w-0 text-ink-soft">
                        <span className="font-bold text-ok">أُرشف</span>
                        {item.archived.folder && <> في <bdi dir="ltr" className="text-muted">{item.archived.folder}</bdi></>}
                        {item.archived.renamed && <span className="block text-[11px] text-warn">أُضيف إلى الاسم رقمُ نسخة — لم يُستبدل ملفٌّ قائم.</span>}
                        {item.archived.needsReview && <span className="block text-[11px] text-warn">ينتظر من يرى المبالغ ليؤكّدها.</span>}
                      </p>
                      <span className="flex gap-1.5">
                        {item.archived.link && (
                          <a href={item.archived.link} target="_blank" rel="noreferrer" className={buttonClass("quiet", "sm")}>
                            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                            الدرايف
                          </a>
                        )}
                      </span>
                    </div>
                  </Row>
                ) : (
                  <ReviewCard
                    item={item}
                    canSeeAmounts={canSeeAmounts}
                    canCreateSupplier={canCreateSupplier}
                    suppliers={suppliers}
                    chosen={chosen[item.id]}
                    onChoose={(sup) => setChosen((prev) => ({ ...prev, [item.id]: sup }))}
                    onCreated={(sup) => {
                      setSuppliers((prev) =>
                        prev.some((x) => x.id === sup.id) ? prev : [...prev, sup].sort((a, b) => a.nameAr.localeCompare(b.nameAr, "ar")),
                      );
                      setChosen((prev) => ({ ...prev, [item.id]: sup }));
                    }}
                    onEdit={(k, v) => editField(item.id, k, v)}
                    onArchive={() => archive(item.id)}
                    onRemove={() => remove(item.id)}
                  />
                )}
              </li>
            ))}
          </ul>

          {archivedN > 0 && (
            <p className="mt-4 text-xs text-muted">
              ما أُرشف تجده في{" "}
              <Link href="/documents?status=ARCHIVED" className="font-bold text-accent hover:underline">المستندات</Link>
              {" "}— وما ينتظر تأكيدَ غيرك تحت «ينتظر المراجعة».
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** سطرُ ملفٍّ في القائمة: اسمُه ومرحلتُه، وتحته ما يخصّ حالَه. */
function Row({
  name,
  steps,
  tone,
  mono,
  onRemove,
  children,
}: {
  name: string;
  steps: [StepState, StepState, StepState];
  tone?: "danger" | "ok";
  mono?: boolean;
  onRemove?: () => void;
  children: React.ReactNode;
}) {
  return (
    <article
      className={`rounded-xl border bg-raised p-4 shadow-raised animate-rise ${
        tone === "danger" ? "border-danger/30" : tone === "ok" ? "border-ok/25" : "border-line"
      }`}
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className={`flex min-w-0 items-center gap-2 text-xs font-bold ${mono ? "font-mono" : ""}`}>
          {tone === "ok"
            ? <CircleCheck className="h-4 w-4 shrink-0 text-ok" strokeWidth={2} aria-hidden />
            : <FileText className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} aria-hidden />}
          <bdi dir="ltr" className="truncate" title={name}>{name}</bdi>
        </p>
        <span className="flex items-center gap-2">
          <Steps at={steps} />
          {onRemove && (
            <button type="button" onClick={onRemove} aria-label="أزِله من القائمة" className="-me-1 grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink">
              <X className="h-4 w-4" strokeWidth={2} aria-hidden />
            </button>
          )}
        </span>
      </header>
      {children}
    </article>
  );
}

/**
 * بطاقةُ المراجعة — النموذج يقترح، والخادم يحسب، والإنسان يُقرّ.
 *
 * ── لا يُعرَض إلّا ما يحتاج قراراً أوّلاً ──
 *
 * حين تُقرأ الحقول كلّها بثقة، فمطالبة المستخدم بتأكيدها واحداً واحداً
 * عملٌ بلا فائدة — يعلّمه أن يضغط «موافق» بلا نظر. فيُقال ذلك في سطر،
 * والحقولُ ظاهرةٌ لمن أراد. وإن كان فيه ما يحتاج مراجعة، ذُكر عدده
 * ووُسم كلُّ حقلٍ ضعيف بكلمةٍ ورمز.
 */
function ReviewCard({
  item,
  canSeeAmounts,
  canCreateSupplier,
  suppliers,
  chosen,
  onChoose,
  onCreated,
  onEdit,
  onArchive,
  onRemove,
}: {
  item: Extract<Item, { state: "done" }>;
  canSeeAmounts: boolean;
  canCreateSupplier: boolean;
  suppliers: SupplierOption[];
  chosen?: SupplierOption;
  onChoose: (s: SupplierOption) => void;
  onCreated: (s: SupplierOption) => void;
  onEdit: (key: string, value: string) => void;
  onArchive: () => void;
  onRemove: () => void;
}) {
  const r = item.data.result;
  const low = new Set(r.lowConfidenceFields);
  const blocking = r.findings.filter((f) => f.severity === "BLOCKER");
  const needsSupplier = !chosen && !r.supplier;
  const decisions = low.size + blocking.length + (needsSupplier ? 1 : 0);
  const otherWeak = [...low].filter((k) => LOW_OTHER[k]).map((k) => LOW_OTHER[k]);
  /* ضعفُ الحقول يُرى في الحقول نفسها — فلا يُكرَّر بنصّه في القائمة */
  const findings = r.findings.filter((f) => f.code !== ISSUE.LOW_CONFIDENCE_FIELD);
  const [showPaper, setShowPaper] = useState(false);
  const fid = (k: string) => `${item.id}-${k}`;

  return (
    <article className="overflow-hidden rounded-2xl border border-accent-line bg-raised shadow-lifted animate-rise">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line-soft px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex shrink-0 items-center rounded-full border border-line bg-sunken px-2 py-0.5 text-[11px] font-bold text-ink-soft">
            {KIND_LABEL[r.documentKind] ?? r.documentKind}
          </span>
          <bdi dir="ltr" className="truncate font-mono text-xs text-ink-soft" title={item.fileName}>{item.fileName}</bdi>
        </div>
        <span className="flex items-center gap-2">
          <Steps at={["done", item.archiving ? "done" : "current", item.archiving ? "current" : "todo"]} />
          {!item.archiving && (
            <button type="button" onClick={onRemove} aria-label="أزِله دون أرشفة" className="-me-1 grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink">
              <X className="h-4 w-4" strokeWidth={2} aria-hidden />
            </button>
          )}
        </span>
      </header>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="space-y-5 p-4 sm:p-5">
          {/* ── الحكمُ في سطر ── */}
          {decisions === 0 ? (
            <p className="flex items-start gap-2 rounded-xl border border-ok/25 bg-ok-bg px-3.5 py-2.5 text-xs font-bold text-ok">
              <CircleCheck className="mt-px h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              قُرئ كلُّ شيءٍ بثقة — قارِن بالورقة إن شئت، ثمّ أكّد.
            </p>
          ) : (
            <p className="flex items-start gap-2 rounded-xl border border-warn/25 bg-warn-bg px-3.5 py-2.5 text-xs font-bold text-warn">
              <TriangleAlert className="mt-px h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              <span>
                {countNoun(decisions, FIELD)} {decisions <= 2 ? (decisions === 1 ? "يحتاج" : "يحتاجان") : "تحتاج"} نظرك قبل الأرشفة — موسومةٌ بـ«راجِعه».
                {otherWeak.length > 0 && <span className="block font-normal text-ink-soft">وقُرئ بثقةٍ ضعيفة: {otherWeak.join(" · ")}.</span>}
              </span>
            </p>
          )}

          <div>
            <SupplierPicker
              id={fid("supplier")}
              canCreate={canCreateSupplier}
              detected={r.supplier}
              candidates={r.supplierCandidates}
              suppliers={suppliers}
              chosen={chosen}
              weak={low.has(LOW.supplier)}
              onChoose={onChoose}
              onCreated={onCreated}
            />
          </div>

          <Group title="المستند">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field id={fid("number")} label="رقم الفاتورة" value={item.edited.invoiceNumber} weak={low.has(LOW.number)} onChange={(v) => onEdit("invoiceNumber", v)} />
              <Field id={fid("date")} label="التاريخ" type="date" value={item.edited.invoiceDate} weak={low.has(LOW.date)} onChange={(v) => onEdit("invoiceDate", v)} />
              <div className="col-span-2 min-w-0 sm:col-span-1">
                <p className="text-xs font-bold text-ink-soft">الشهر المحاسبيّ</p>
                <p className="nums mt-1.5 flex min-h-11 items-center rounded-lg bg-sunken px-3 text-sm sm:min-h-10">
                  {r.periodMonth ?? <span className="font-sans text-muted">يُحدَّد من التاريخ</span>}
                </p>
              </div>
            </div>
          </Group>

          {canSeeAmounts && (
            <Group
              title="المبالغ"
              aside={low.has(LOW.amounts) ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-warn">
                  <TriangleAlert className="h-3 w-3" strokeWidth={2.25} aria-hidden />
                  قُرئت بثقةٍ ضعيفة
                </span>
              ) : undefined}
            >
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div className="col-span-2 min-w-0 sm:col-span-1">
                  <p className="text-xs font-bold text-ink-soft">قبل الضريبة</p>
                  <p className="mt-1.5 flex min-h-11 items-center rounded-lg bg-sunken px-3 text-sm sm:min-h-10">
                    {r.subtotalMinor !== undefined ? <Money minor={r.subtotalMinor} /> : <span className="text-muted">غير معروف</span>}
                  </p>
                </div>
                <Field id={fid("vat")} label="الضريبة" inputMode="decimal" value={item.edited.vat} weak={low.has(LOW.amounts)} onChange={(v) => onEdit("vat", v)} />
                <Field id={fid("total")} label="الإجمالي" inputMode="decimal" value={item.edited.total} weak={low.has(LOW.amounts)} onChange={(v) => onEdit("total", v)} />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted">
                الخادمُ يعيد الحسابَ والحكمَ الضريبيّ حين تؤكّد — ما تكتبه هنا يُقرأ ولا يُصدَّق بلا فحص.
              </p>
            </Group>
          )}

          {findings.length > 0 && (
            <Group title="ملاحظاتُ الفحص">
              <ul className="space-y-1.5">
                {findings.map((f, i) => {
                  const Icon = f.severity === "BLOCKER" ? CircleAlert : f.severity === "WARN" ? TriangleAlert : Info;
                  const cls = f.severity === "BLOCKER" ? "border-danger/25 bg-danger-bg text-danger" : f.severity === "WARN" ? "border-warn/25 bg-warn-bg text-warn" : "border-line bg-sunken text-ink-soft";
                  return (
                    <li key={i} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${cls}`}>
                      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                      <span className="min-w-0">
                        <b>{f.severity === "BLOCKER" ? "يمنع الأرشفة: " : f.severity === "WARN" ? "انتبه: " : "للعلم: "}</b>
                        <span className="text-ink-soft">{f.message}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Group>
          )}

          {r.proposedFileName && (
            <details className="group rounded-xl border border-line bg-sunken/40 px-3.5 py-2.5">
              <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 text-xs font-bold text-ink-soft">
                اسمُ الملفّ ووجهتُه في الدرايف
                <span className="text-[11px] font-normal text-muted group-open:hidden">اعرضه</span>
              </summary>
              <label htmlFor={fid("file")} className="mt-2 block text-[11px] text-muted">الاسم الجديد</label>
              <input
                id={fid("file")}
                value={item.edited.fileName}
                onChange={(e) => onEdit("fileName", e.target.value)}
                dir="ltr"
                className="mt-1 min-h-11 w-full rounded-lg border border-line-input bg-raised px-3 font-mono text-xs sm:min-h-9"
              />
              <p className="mt-2 text-[11px] text-muted">المجلّد</p>
              <p className="mt-0.5 truncate font-mono text-[11px]" dir="ltr">{r.proposedFolderPath}</p>
            </details>
          )}

          {/* الورقةُ على الجوّال خلف زرّ — الشاشةُ الضيّقة لا تحمل الاثنين */}
          <div className="lg:hidden">
            <button type="button" onClick={() => setShowPaper((v) => !v)} className={buttonClass("quiet", "sm")} aria-expanded={showPaper}>
              <FileText className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              {showPaper ? "أخفِ الورقة" : "قارِن بالورقة"}
            </button>
            {showPaper && (
              <div className="mt-2 rounded-xl border border-line bg-sunken p-2">
                {item.mimeType.startsWith("image/") ? (
                  <Paper url={item.previewUrl} mime={item.mimeType} name={item.fileName} />
                ) : (
                  <a href={item.previewUrl} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}>
                    <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                    افتح الملفّ
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        <aside className="hidden border-s border-line-soft bg-sunken/60 p-3 lg:block" aria-label="الورقة">
          <p className="mb-2 px-1 text-[11px] font-bold text-muted">الورقة — قارِن بها</p>
          <div className="sticky top-24">
            <Paper url={item.previewUrl} mime={item.mimeType} name={item.fileName} />
          </div>
        </aside>
      </div>

      <footer className="border-t border-line-soft bg-sunken/40 px-4 py-3.5 sm:px-5">
        {item.archiving && (
          <div className="mb-3">
            <Elapsed startedAt={item.startedAt} slowAfter={30} text="يرفع إلى الدرايف ويقيّد…" slowText="يرفع… الخادم بطيء، امنحه لحظة" />
          </div>
        )}
        {item.archiveError && (
          <div role="alert" className="mb-3 flex items-start gap-2 rounded-xl border border-danger/25 bg-danger-bg px-3.5 py-2.5 text-xs leading-relaxed text-danger">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            <div>
              <p className="font-bold">
                تعثّرت الأرشفة
                {item.finishedInMs !== undefined && <> — بعد <span className="nums">{(item.finishedInMs / 1000).toFixed(1)}</span> ثانية</>}
              </p>
              <p className="mt-0.5 text-ink-soft">{item.archiveError}</p>
            </div>
          </div>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted">
            {r.canArchive
              ? "لا يُحفَظ شيءٌ قبل تأكيدك — ثمّ يُرفع الملفُّ الأصليّ إلى مجلّده ويُقيَّد."
              : "لا يُؤرشَف قبل معالجة ما يمنعه — مذكورٌ أعلاه."}
          </p>
          <button
            type="button"
            onClick={onArchive}
            disabled={!r.canArchive || item.archiving}
            className={`${buttonClass("primary", "md")} w-full sm:w-auto`}
          >
            {item.archiving ? "يؤرشف…" : item.archiveError ? (
              <><RotateCw className="h-4 w-4" strokeWidth={2} aria-hidden />أعد المحاولة</>
            ) : (
              <><Check className="h-4 w-4" strokeWidth={2.25} aria-hidden />أكّد وأرشِف</>
            )}
          </button>
        </div>
      </footer>
    </article>
  );
}
