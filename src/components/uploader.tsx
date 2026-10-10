"use client";

import { ExtractionEvidencePanel } from "@/components/extraction-evidence";
import { parseEvidence } from "@/lib/extraction/evidence";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Camera, Check, CircleAlert, CircleCheck, ExternalLink, FileText, FolderOpen, Info, Layers, Plus,
  RotateCw, TriangleAlert, Upload, X, ZoomIn, ZoomOut,
} from "lucide-react";
import { formatRiyalsDisplay } from "@/lib/money";
import { NETWORK_ERROR, postJson, readResponse, request } from "@/lib/http-client";
import { SimilarSuppliers, readSimilar, type SimilarSupplier } from "./similar-suppliers";
import { FIELD, FILE, countNoun } from "@/lib/arabic";
import { ISSUE } from "@/lib/issue-codes";
import { buttonClass, fieldClass } from "./ui-tokens";
import { createLimiter } from "@/lib/async-pool";
import { deleteDraft, loadDrafts, saveDraft } from "@/lib/review-drafts";
import { Sheet, toast } from "./ui-client";
import { imagesToPdf, type JpegPage } from "@/lib/images-to-pdf";
import { Money } from "./money";
import { onCaptured, takeCaptured } from "@/lib/capture-queue";
import { takeShared } from "@/lib/shared-inbox";

interface Finding {
  code: string;
  severity: "INFO" | "WARN" | "BLOCKER";
  message: string;
}

interface AnalysisResponse {
  originalFileName: string;
  /** بصمةُ الملفّ — بها يُعاد الحكمُ بعد التعديل على ما قرأه الخادم */
  sha256?: string;
  sizeBytes: number;
  model?: string;
  provider?: string;
  extraction?: Record<string, unknown>;
  /** أدلّةُ القراءة للعرض (رمزُ الفاتورة ومصادرُ الحقول) — والخادمُ يقرؤها من حفظه لا من هنا */
  evidence?: unknown;
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
  /** ينتظر دوره — يُقرأ ثلاثةٌ معاً لا عشرون (`READ_CONCURRENCY`) */
  | { id: string; fileName: string; state: "queued"; previewUrl?: string; mime: string }
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
      /** يُعاد الحكمُ بعد تعديل — الزرُّ ينتظره */
      reviewing?: boolean;
      reviewError?: string;
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

/**
 * كم ملفّاً يُقرأ معاً. كلُّ قراءةٍ طلبٌ يستدعي الذكاء تحت مهلة ٦٠ ثانية — وعشرون
 * معاً يتعثّر بعضُها بحدّ المعدّل أو المهلة فيُعرَض «فشل» لملفٍّ سليم.
 */
const READ_CONCURRENCY = 3;

/** ما يُحفَظ من بطاقة المراجعة في هذا المتصفّح حتّى تُؤرشَف (`review-drafts.ts`). */
interface DraftPayload {
  fileName: string;
  mimeType: string;
  fileBase64: string;
  data: AnalysisResponse;
  edited: Record<string, string>;
  chosen?: SupplierOption;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** المحفوظُ يُفحَص شكلُه قبل أن يُرسَم — نسخةٌ قديمة أو تالفة تُمحى ولا تُسقط الصفحة. */
function isDraftPayload(x: unknown): x is DraftPayload {
  if (!isRecord(x)) return false;
  if (typeof x.fileName !== "string" || typeof x.mimeType !== "string" || typeof x.fileBase64 !== "string") return false;
  if (!isRecord(x.edited) || !Object.values(x.edited).every((v) => typeof v === "string")) return false;
  if (x.chosen !== undefined && !(isRecord(x.chosen) && typeof x.chosen.id === "string" && typeof x.chosen.nameAr === "string")) return false;
  const data = x.data;
  if (!isRecord(data) || typeof data.originalFileName !== "string" || !isRecord(data.result)) return false;
  const r = data.result;
  return typeof r.documentKind === "string" && typeof r.canArchive === "boolean"
    && Array.isArray(r.findings) && Array.isArray(r.lowConfidenceFields) && Array.isArray(r.supplierCandidates);
}

const MAX_BYTES = 3 * 1024 * 1024;
/** صورةٌ أكبر من هذا تُصغَّر في المتصفّح قبل الإرسال */
const IMAGE_SHRINK_BYTES = 1.5 * 1024 * 1024;
const IMAGE_MAX_SIDE = 2400;

/**
 * صورةُ الجوّال تُصغَّر هنا قبل أن تُرسَل — لا تُردّ.
 *
 * كانت كلُّ صورةٍ فوق ٣ ميجابايت تُردّ «صغّره»، وصورةُ كاميرا الهاتف ٣–٦ ميجابايت:
 * فلا تُقرأ صورةٌ تقريباً. وHEIC (الآيفون) يرسلها كروم بنوعٍ فارغ فتُردّ «غير مدعوم».
 * فتُرسم على لوحٍ بأطولِ ضلعٍ ٢٤٠٠ وتُحفظ JPEG — وهي ما يُؤرشَف (يُقرأ ويُطبع كالأصل).
 * وما لا يفكّه المتصفّح (HEIC في كروم) يُرسَل كما هو ويحوّله الخادم.
 */
async function prepareForUpload(file: File): Promise<File> {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const heif = ext === "heic" || ext === "heif" || /image\/hei[cf]/.test(file.type);
  const isImage = file.type.startsWith("image/") || heif;
  if (!isImage) return file;
  if (!heif && file.size <= IMAGE_SHRINK_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    /* لا يفكّه المتصفّح — يُرسَل كما هو بنوعٍ من امتداده، والخادمُ يحوّله */
    return heif && !file.type ? new File([file], file.name, { type: ext === "heif" ? "image/heif" : "image/heic" }) : file;
  }
}

/**
 * صورةٌ من رابطها المحلّيّ إلى صفحة JPEG بأطول ضلعٍ `maxSide` — لضمّ الصفحات.
 * تُرسَم على لوحٍ فتخرج JPEG مهما كان أصلُها (PNG · WebP)، وبحجمٍ يُبقي الملفَّ
 * المضموم تحت حدّ الرفع.
 */
async function pageFromImage(url: string, maxSide: number, quality: number): Promise<JpegPage> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("تعذّر رسمُ الصورة في هذا المتصفّح.");
  /* أرضيّةٌ بيضاء: JPEG بلا شفافيّة، وPNG شفّافٌ كان يخرج أسود */
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("تعذّر تحويلُ الصورة.");
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
}

/** درجاتُ الضمّ: الأدقُّ أوّلاً، ثمّ أصغرُ حتّى يقع الملفُّ تحت حدّ الرفع. */
const MERGE_STEPS: readonly (readonly [number, number])[] = [[2000, 0.85], [1600, 0.78], [1300, 0.7]];

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
        className={`nums mt-1.5 placeholder:font-sans ${fieldClass("md")} ${weak ? "border-warn! bg-warn-bg/40!" : ""}`}
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
  const [similar, setSimilar] = useState<SimilarSupplier[]>([]);

  const active = chosen ?? detected;

  const create = async (confirmNew = false) => {
    const nameAr = name.trim();
    if (nameAr.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<{ supplier: { id: string; nameAr: string } }>("/api/supplier", { nameAr, ...(confirmNew ? { confirmNew: true } : {}) });
      if (!r.ok) {
        /* يشبه مسجَّلاً — يُسأل «أهو هو؟» ولا يُنشأ ثانٍ بصمت */
        const alike = r.status === 409 ? readSimilar(r.data) : [];
        setSimilar(alike);
        if (alike.length === 0) setError(r.error);
        return;
      }
      setSimilar([]);
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
            onChange={(e) => { setName(e.target.value); setSimilar([]); }}
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
          <button type="button" onClick={() => { setCreating(false); setError(null); setSimilar([]); }} className={buttonClass("quiet", "sm")}>
            إلغاء
          </button>
          <div className="w-full">
            <SimilarSuppliers
              similar={similar}
              busy={busy}
              onPick={(s) => { onChoose({ id: s.id, nameAr: s.nameAr }); setSimilar([]); setCreating(false); setName(""); }}
              onCreateAnyway={() => void create(true)}
            />
          </div>
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

/**
 * صورةُ الورقة بتكبيرٍ وتدوير — رقمٌ صغير في فاتورةٍ صُوّرت مائلةً يُقرأ هنا لا
 * في تطبيقٍ آخر. التكبيرُ عرضٌ داخل إطارٍ يُمرَّر (ويبقى القرصُ بإصبعين)، والتدويرُ
 * يرسم نسخةً مُدارةً محلّياً: **للعرض وحده** — الملفُّ الذي يُؤرشَف هو الأصل كما رُفع.
 */
function ImagePaper({ url, name }: { url: string; name: string }) {
  const [zoom, setZoom] = useState(1);
  const [turned, setTurned] = useState<{ url: string; quarter: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (turned) URL.revokeObjectURL(turned.url); }, [turned]);

  async function rotate() {
    if (busy) return;
    const quarter = ((turned?.quarter ?? 0) + 1) % 4;
    if (quarter === 0) { setTurned(null); return; }
    setBusy(true);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const swap = quarter % 2 === 1;
      const canvas = document.createElement("canvas");
      canvas.width = swap ? img.naturalHeight : img.naturalWidth;
      canvas.height = swap ? img.naturalWidth : img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((quarter * Math.PI) / 2);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (blob) setTurned({ url: URL.createObjectURL(blob), quarter });
    } catch {
      /* صورةٌ لا يفكّها المتصفّح (HEIC في كروم) — تبقى كما هي */
    } finally {
      setBusy(false);
    }
  }

  const tool = "grid h-11 w-11 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-hover hover:text-ink disabled:opacity-40 sm:h-8 sm:w-8";
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-end gap-0.5" role="group" aria-label="عرضُ الورقة">
        <button type="button" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} disabled={zoom <= 1} aria-label="صغّر الورقة" className={tool}>
          <ZoomOut className="h-4 w-4" strokeWidth={2} aria-hidden />
        </button>
        <span className="nums nums-count w-10 text-center text-[11px] text-muted" dir="ltr" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} disabled={zoom >= 4} aria-label="كبّر الورقة" className={tool}>
          <ZoomIn className="h-4 w-4" strokeWidth={2} aria-hidden />
        </button>
        <button type="button" onClick={() => void rotate()} aria-busy={busy} aria-label="أدِر الورقة ربعَ دورة" className={tool}>
          <RotateCw className="h-4 w-4" strokeWidth={2} aria-hidden />
        </button>
      </div>
      <div className="max-h-[70vh] overflow-auto overscroll-contain rounded-lg [touch-action:pan-x_pan-y_pinch-zoom]">
        {/* eslint-disable-next-line @next/next/no-img-element -- رابطٌ محلّيّ (blob:) لا يمرّ بمحسِّن الصور */}
        <img
          src={turned?.url ?? url}
          alt={`الورقة: ${name}`}
          style={zoom === 1 ? undefined : { width: `${zoom * 100}%`, maxWidth: "none" }}
          className={zoom === 1 ? "mx-auto max-h-[70vh] w-full rounded-lg object-contain" : "block rounded-lg"}
        />
      </div>
    </div>
  );
}

/** الورقةُ بجانب القراءة — صورةٌ تُعرَض بتكبيرٍ وتدوير، وPDF يُضمَّن على الحاسوب. */
function Paper({ url, mime, name }: { url: string; mime: string; name: string }) {
  if (mime.startsWith("image/")) return <ImagePaper url={url} name={name} />;
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
  const chosenRef = useRef(chosen);
  chosenRef.current = chosen;

  /*
    ── الحكمُ بعد التعديل ──
    كان يُبنى مرّةً حين يُقرأ الملفّ: كشفٌ لم يُقرأ تاريخُه فكتبه صاحبُه بيده، وبقي الزرُّ
    مقفلاً والشهرُ فارغاً (أوراق الزيتون، ٣ أكتوبر ٢٠٢٦). فكلُّ تعديلٍ أو اختيارِ مورّدٍ
    يعيد الحكمَ في الخادم على قراءته هو — والزرُّ ينتظره.
  */
  const reviewTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const rejudge = useCallback((id: string) => {
    const prevTimer = reviewTimers.current.get(id);
    if (prevTimer) clearTimeout(prevTimer);
    setItems((prev) => prev.map((x) => (x.id === id && x.state === "done" ? { ...x, reviewing: true, reviewError: undefined } : x)));
    reviewTimers.current.set(id, setTimeout(async () => {
      reviewTimers.current.delete(id);
      const it = itemsRef.current.find((x) => x.id === id);
      if (!it || it.state !== "done" || !it.data.sha256) {
        setItems((prev) => prev.map((x) => (x.id === id && x.state === "done" ? { ...x, reviewing: false } : x)));
        return;
      }
      const sent = it.edited;
      const r = await postJson<{ result: AnalysisResponse["result"] }>("/api/analyze/review", {
        sha256: it.data.sha256,
        originalFileName: it.data.originalFileName,
        supplierId: chosenRef.current[id]?.id ?? null,
        invoiceNumber: sent.invoiceNumber,
        invoiceDate: sent.invoiceDate,
        vat: sent.vat,
        total: sent.total,
      });
      setItems((prev) => prev.map((x) => {
        if (x.id !== id || x.state !== "done") return x;
        /* تعديلٌ أحدث وصل في أثناء الطلب — حكمُه في الطريق */
        if (x.edited !== sent) return x;
        if (!r.ok) return { ...x, reviewing: false, reviewError: r.error };
        const oldName = x.data.result.proposedFileName ?? "";
        /* الاسمُ يتبع الحكمَ ما لم يكتبه صاحبُه بيده */
        const fileName = !x.edited.fileName || x.edited.fileName === oldName ? r.data.result.proposedFileName ?? "" : x.edited.fileName;
        return { ...x, reviewing: false, data: { ...x.data, result: r.data.result }, edited: { ...x.edited, fileName } };
      }));
    }, 400));
  }, []);

  /* روابطُ المعاينة تُحرَّر حين تُغادَر الصفحة — لا تبقى ملفّاتٌ في الذاكرة */
  const urls = useRef(new Set<string>());
  useEffect(() => {
    const all = urls.current;
    return () => { all.forEach((u) => URL.revokeObjectURL(u)); all.clear(); };
  }, []);

  /** يقرأ ملفّاً واحداً حان دورُه — والبندُ في القائمة منذ اختير («ينتظر دوره»). */
  const read = useCallback(async (id: string, picked: File) => {
    const file = await prepareForUpload(picked);

    /* الحدّ يُقال قبل الإرسال — لا ٤١٣ نصّيّ من المنصّة بعده */
    if (file.size > MAX_BYTES) {
      const tooBig: Item = {
        id, fileName: file.name, state: "failed", mime: file.type,
        error: file.type.startsWith("image/")
          ? "الصورة أكبر من ٣ ميجابايت ولم يستطع المتصفّح تصغيرها — صدّرها JPG من تطبيق الصور ثمّ أعد المحاولة."
          : "الملف أكبر من ٣ ميجابايت — حدّ الأرشفة. اضغط الـPDF ثمّ أعد المحاولة.",
      };
      setItems((prev) => prev.map((it) => (it.id === id ? tooBig : it)));
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    urls.current.add(previewUrl);
    const reading: Item = { id, fileName: file.name, state: "reading", startedAt: Date.now(), previewUrl, mime: file.type };
    setItems((prev) => prev.map((it) => (it.id === id ? reading : it)));

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

  /*
    ── طابورُ القراءة ──
    الملفُّ يظهر في القائمة فور اختياره «ينتظر دوره»، ويُقرأ ثلاثةٌ معاً. وما أُزيل
    وهو ينتظر لا يُقرأ — لا يُدفَع ثمنُ قراءةِ ما لم يُرَد.
  */
  const [limit] = useState(() => createLimiter(READ_CONCURRENCY));
  const cancelled = useRef(new Set<string>());
  const analyze = useCallback((picked: File) => {
    const id = `${picked.name}-${Date.now()}-${Math.random()}`;
    setItems((prev) => [{ id, fileName: picked.name, state: "queued", mime: picked.type }, ...prev]);
    void limit(async () => {
      if (cancelled.current.delete(id)) return;
      try {
        await read(id, picked);
      } catch (e) {
        /* تصغيرُ الصورة أو قراءةُ بايتاتها تعثّر قبل الإرسال — يُقال ولا يبقى «ينتظر دوره» إلى الأبد */
        setItems((prev) => prev.map((it) => (it.id === id ? { id, fileName: picked.name, state: "failed", error: (e as Error).message || "تعذّرت قراءةُ الملفّ من جهازك.", file: picked, mime: picked.type } : it)));
      }
    });
  }, [limit, read]);

  /*
    ── ما صُحّح لا يضيع بتحديث الصفحة ──
    بطاقاتُ المراجعة (القراءةُ والتصحيحاتُ والمورّدُ المختار والملفّ) تُحفَظ في هذا
    المتصفّح حتّى تُؤرشَف أو تُزال، وتُستعاد عند العودة. والخادمُ يعيد الفحصَ عند
    التأكيد كما يفعل دائماً — المحفوظُ مدخلٌ لا حكم.
  */
  const savedSig = useRef(new Map<string, string>());
  const [draftsFailed, setDraftsFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void loadDrafts().then((rows) => {
      if (!alive || rows.length === 0) return;
      const restored: Item[] = [];
      const picks: Record<string, SupplierOption> = {};
      for (const row of rows) {
        const p = row.payload;
        if (!isDraftPayload(p)) { void deleteDraft(row.id); continue; }
        let previewUrl: string;
        try {
          const bytes = Uint8Array.from(atob(p.fileBase64), (c) => c.charCodeAt(0));
          previewUrl = URL.createObjectURL(new Blob([bytes], { type: p.mimeType }));
        } catch {
          void deleteDraft(row.id);
          continue;
        }
        urls.current.add(previewUrl);
        restored.push({ id: row.id, fileName: p.fileName, state: "done", data: p.data, edited: p.edited, fileBase64: p.fileBase64, mimeType: p.mimeType, previewUrl });
        if (p.chosen) picks[row.id] = p.chosen;
      }
      if (restored.length === 0) return;
      setItems((prev) => [...prev, ...restored.filter((r) => !prev.some((x) => x.id === r.id))]);
      setChosen((prev) => ({ ...picks, ...prev }));
      toast({
        tone: "info",
        title: restored.length === 1 ? "استُعيد مستندٌ لم يُؤرشَف" : `استُعيدت ${countNoun(restored.length, FILE)} لم تُؤرشَف`,
        body: "بما صحّحتَه قبل أن تغادر الصفحة — راجِعها ثمّ أكّد.",
      });
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const live = new Set<string>();
      for (const it of items) {
        if (it.state !== "done") continue;
        live.add(it.id);
        const pick = chosen[it.id];
        const sig = JSON.stringify([it.edited, it.data.result, pick?.id ?? null]);
        if (savedSig.current.get(it.id) === sig) continue;
        savedSig.current.set(it.id, sig);
        const payload: DraftPayload = { fileName: it.fileName, mimeType: it.mimeType, fileBase64: it.fileBase64, data: it.data, edited: it.edited, chosen: pick };
        void saveDraft(it.id, payload).then((ok) => { if (!ok) setDraftsFailed(true); });
      }
      for (const id of [...savedSig.current.keys()]) {
        if (live.has(id)) continue;
        savedSig.current.delete(id);
        void deleteDraft(id);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [items, chosen]);

  /*
    تحذيرُ الخروج لما يضيع فعلاً: ملفٌّ ينتظر أو يُقرأ (لم يصل بعد)، وبطاقةُ مراجعةٍ
    تعذّر حفظُها في المتصفّح. وما حُفظ يُستعاد فلا يُسأل عنه.
  */
  const atRisk = items.some((i) => i.state === "queued" || i.state === "reading" || (draftsFailed && i.state === "done"));
  useEffect(() => {
    if (!atRisk) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [atRisk]);

  const editField = useCallback((id: string, key: string, value: string) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === id && it.state === "done" ? { ...it, edited: { ...it.edited, [key]: value } } : it,
      ),
    );
    /* اسمُ الملفّ لا يغيّر الحكم */
    if (key !== "fileName") rejudge(id);
  }, [rejudge]);

  const remove = useCallback((id: string) => {
    const it = itemsRef.current.find((x) => x.id === id);
    if (it?.state === "queued") cancelled.current.add(id);
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
      for (const f of Array.from(files)) analyze(f);
    },
    [analyze],
  );

  /*
    ما التقطه زرُّ الكاميرا أو أُفلِت في صفحةٍ أخرى يصل هنا — يُقرأ حين
    تُركَّب الصفحة، وما يصل بعدها يُقرأ حين يصل.
  */
  useEffect(() => {
    const take = () => {
      for (const f of takeCaptured()) analyze(f);
    };
    take();
    return onCaptured(take);
  }, [analyze]);

  /*
    ما شورِك إلى التطبيق المثبَّت (واتساب ← مشاركة) يضعه عاملُ الخدمة في صندوقٍ
    مؤقّت ويفتح هذه الصفحة بـ`?shared=`. فيُؤخذ ويُقرأ، ويُنظَّف العنوان كي لا
    يُعاد السؤالُ عند التحديث. و«٠» تعني أنّ المشاركة لم تحمل ملفّاً يُقرأ.
  */
  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get("shared");
    let alive = true;
    void takeShared().then((files) => {
      if (!alive) return;
      for (const f of files) analyze(f);
      if (flag !== null) {
        if (files.length === 0) {
          toast({ tone: "warn", title: "لم يصل ملفٌّ من المشاركة.", body: "شارِك صورةً أو PDF — النصُّ والروابط لا تُقرأ. أو اختر الملفّ من هنا." });
        }
        router.replace("/upload", { scroll: false });
      }
    });
    return () => { alive = false; };
  }, [analyze, router]);

  /*
    ── صفحاتُ مستندٍ واحد ──
    فاتورةٌ من ورقتين صُوّرتا تصلان بطاقتَين تُقرآن ناقصتَين (البنودُ في واحدةٍ
    والإجماليُّ في أخرى). فتُضمّ الصورُ المختارة بترتيب اختيارها في PDF واحد هنا
    في المتصفّح، وتُزال بطاقاتُها، ويُقرأ المضمومُ مستنداً واحداً.
  */
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergePick, setMergePick] = useState<string[]>([]);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const mergeable = items.filter((i): i is Extract<Item, { state: "done" }> => i.state === "done" && i.mimeType.startsWith("image/") && !i.archiving);

  async function mergePages() {
    if (mergeBusy) return;
    const chosenPages = mergePick
      .map((id) => itemsRef.current.find((x) => x.id === id))
      .filter((x): x is Extract<Item, { state: "done" }> => x?.state === "done" && !x.archiving);
    if (chosenPages.length < 2) return;
    setMergeBusy(true);
    setMergeError(null);
    try {
      let pdf: Uint8Array<ArrayBuffer> | null = null;
      for (const [side, quality] of MERGE_STEPS) {
        const pages: JpegPage[] = [];
        for (const it of chosenPages) pages.push(await pageFromImage(it.previewUrl, side, quality));
        const built = imagesToPdf(pages);
        if (built.length <= MAX_BYTES) { pdf = built; break; }
      }
      if (!pdf) {
        setMergeError("الصفحاتُ المضمومة أكبر من ٣ ميجابايت حتّى بعد التصغير — ضُمّ عدداً أقلّ، أو ارفعها مستنداتٍ منفصلة.");
        return;
      }
      const file = new File([pdf], `مستند-${chosenPages.length}-صفحات.pdf`, { type: "application/pdf" });
      chosenPages.forEach((it) => remove(it.id));
      analyze(file);
      setMergeOpen(false);
      setMergePick([]);
      toast({ tone: "info", title: `ضُمّت ${chosenPages.length} صفحات في مستندٍ واحد`, body: "يُقرأ الآن من جديد — راجِعه ثمّ أكّد." });
    } catch (e) {
      setMergeError((e as Error).message || "تعذّر ضمُّ الصفحات.");
    } finally {
      setMergeBusy(false);
    }
  }

  const count = (s: Item["state"]) => items.filter((i) => i.state === s).length;
  const reading = count("reading");
  const queued = count("queued");
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
              {queued > 0 && <span>وينتظر دورَه {countNoun(queued, FILE)}</span>}
              {review > 0 && <span className="font-bold text-accent">ينتظر تأكيدك {countNoun(review, FILE)}</span>}
              {archivedN > 0 && <span className="text-ok">أُرشف {countNoun(archivedN, FILE)}</span>}
              {mergeable.length >= 2 && (
                <button
                  type="button"
                  onClick={() => { setMergePick([]); setMergeError(null); setMergeOpen(true); }}
                  className={buttonClass("quiet", "sm")}
                >
                  <Layers className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  صفحاتُ مستندٍ واحد؟ ضُمّها
                </button>
              )}
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
                {item.state === "queued" ? (
                  <Row name={item.fileName} steps={["todo", "todo", "todo"]} onRemove={() => remove(item.id)}>
                    <p className="text-xs text-muted">ينتظر دورَه — يُقرأ {READ_CONCURRENCY === 3 ? "ثلاثةُ ملفّاتٍ" : `${READ_CONCURRENCY} ملفّات`} معاً كي لا تتعثّر القراءة.</p>
                  </Row>
                ) : item.state === "reading" ? (
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
                            analyze(file);
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
                    onChoose={(sup) => {
                      chosenRef.current = { ...chosenRef.current, [item.id]: sup };
                      setChosen((prev) => ({ ...prev, [item.id]: sup }));
                      rejudge(item.id);
                    }}
                    onCreated={(sup) => {
                      setSuppliers((prev) =>
                        prev.some((x) => x.id === sup.id) ? prev : [...prev, sup].sort((a, b) => a.nameAr.localeCompare(b.nameAr, "ar")),
                      );
                      chosenRef.current = { ...chosenRef.current, [item.id]: sup };
                      setChosen((prev) => ({ ...prev, [item.id]: sup }));
                      rejudge(item.id);
                    }}
                    onEdit={(k, v) => editField(item.id, k, v)}
                    onArchive={() => archive(item.id)}
                    onRemove={() => remove(item.id)}
                  />
                )}
              </li>
            ))}
          </ul>

          <Sheet
            open={mergeOpen}
            onClose={() => { if (!mergeBusy) setMergeOpen(false); }}
            title="ضُمَّ صفحاتِ مستندٍ واحد"
            description="اختر الصورَ بترتيب صفحاتها — تصير ملفَّ PDF واحداً يُقرأ من جديد، وتُزال بطاقاتُها المنفردة."
            footer={
              <>
                <button type="button" onClick={() => setMergeOpen(false)} disabled={mergeBusy} className={buttonClass("quiet", "sm")}>
                  ألغِ
                </button>
                <button
                  type="button"
                  onClick={() => void mergePages()}
                  aria-busy={mergeBusy}
                  disabled={mergeBusy || mergePick.length < 2}
                  title={mergePick.length < 2 ? "اختر صفحتَين على الأقلّ" : undefined}
                  className={buttonClass("primary", "sm")}
                >
                  <span>{mergePick.length >= 2 ? `ضُمّ ${mergePick.length} صفحات` : "ضُمّها"}</span>
                </button>
              </>
            }
          >
            <ul className="space-y-2">
              {mergeable.map((it) => {
                const at = mergePick.indexOf(it.id);
                return (
                  <li key={it.id}>
                    <label className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 ${at !== -1 ? "border-accent-line bg-accent-soft" : "border-line bg-raised"}`}>
                      <input
                        type="checkbox"
                        checked={at !== -1}
                        disabled={mergeBusy}
                        onChange={(e) => setMergePick((prev) => (e.target.checked ? [...prev, it.id] : prev.filter((x) => x !== it.id)))}
                        className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                      />
                      {/* eslint-disable-next-line @next/next/no-img-element -- رابطٌ محلّيّ (blob:) لا يمرّ بمحسِّن الصور */}
                      <img src={it.previewUrl} alt="" className="h-12 w-12 shrink-0 rounded-md border border-line object-cover" />
                      <bdi dir="ltr" className="min-w-0 flex-1 truncate font-mono text-xs">{it.fileName}</bdi>
                      {at !== -1 && (
                        <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-ink">
                          صفحة <span className="nums nums-count">{at + 1}</span>
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
            {mergeError && (
              <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-bg px-3 py-2 text-xs leading-relaxed text-danger">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                <span>{mergeError}</span>
              </p>
            )}
          </Sheet>

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
  /*
    ضعفُ الحقول يُرى في الحقول نفسها — فلا يُكرَّر بنصّه في القائمة. أمّا ما **يمنع**
    فيُقال ولو كان رمزُه رمزَ الضعف: «لم يُقرأ تاريخ المستند» كان يُخفى فيبقى الزرُّ
    مقفلاً بلا سببٍ مكتوب (كشف أوراق الزيتون، ٣ أكتوبر ٢٠٢٦).
  */
  const findings = r.findings.filter((f) => f.code !== ISSUE.LOW_CONFIDENCE_FIELD || f.severity === "BLOCKER");
  const isStatement = r.documentKind === "STATEMENT";
  const [showPaper, setShowPaper] = useState(false);
  const fid = (k: string) => `${item.id}-${k}`;

  return (
    /* `overflow-clip` لا `hidden`: `hidden` يجعل البطاقةَ وعاءَ تمريرٍ فلا يلتصق ذيلُها بأسفل الشاشة */
    <article className="overflow-clip rounded-2xl border border-accent-line bg-raised shadow-lifted animate-rise">
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
              {/* الكشفُ لا رقمَ فاتورةٍ له — هويّتُه مورّدُه وآخرُ أيّامه */}
              {!isStatement && <Field id={fid("number")} label="رقم الفاتورة" value={item.edited.invoiceNumber} weak={low.has(LOW.number)} onChange={(v) => onEdit("invoiceNumber", v)} />}
              <Field id={fid("date")} label={isStatement ? "آخرُ يومٍ في الكشف" : "التاريخ"} type="date" value={item.edited.invoiceDate} weak={low.has(LOW.date)} onChange={(v) => onEdit("invoiceDate", v)} />
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
              {isStatement ? (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {/* الكشفُ يُقيَّد ولو لم يُقرأ رصيدُه — أسطرُه تُقرأ منه بعد الأرشفة */}
                  <Field id={fid("total")} label="الرصيد الختاميّ (اختياريّ)" inputMode="decimal" value={item.edited.total} weak={low.has(LOW.amounts)} onChange={(v) => onEdit("total", v)} />
                </div>
              ) : (
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
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-muted">
                الخادمُ يعيد الحسابَ والحكمَ الضريبيّ حين تؤكّد — ما تكتبه هنا يُقرأ ولا يُصدَّق بلا فحص.
              </p>
            </Group>
          )}

          <ExtractionEvidencePanel evidence={parseEvidence(item.data.evidence)} showAmounts={canSeeAmounts} />

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

      {/*
        على الجوّال الذيلُ يلتصق فوق شريط التنقّل ما دامت البطاقةُ على الشاشة: من قرأ
        «قُرئ كلُّ شيءٍ بثقة» يؤكّد من حيث هو، ومعه الإجماليّ — كان يمرّر شاشتين إلى الزرّ.
      */}
      <footer className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 border-t border-line-soft bg-raised px-4 py-3 sm:px-5 lg:static lg:bg-sunken/40 lg:py-3.5">
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
        {canSeeAmounts && !isStatement && (
          <p className="mb-2 flex items-baseline justify-between gap-3 text-xs text-muted lg:hidden">
            <span>الإجماليّ كما سيُقيَّد</span>
            {item.edited.total.trim()
              ? <bdi dir="ltr" className="nums text-[15px] font-bold text-ink">{item.edited.total}</bdi>
              : <span className="font-bold text-warn">غير معروف</span>}
          </p>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* الطمأنةُ المعتادة لا تزاحم الزرَّ الملتصق على الجوّال — وما يمنع أو يتعثّر يُقال دائماً */}
          <p className={`text-xs text-muted ${!item.reviewing && !item.reviewError && r.canArchive ? "hidden sm:block" : ""}`}>
            {item.reviewing
              ? "يعيد الفحصَ بما صحّحت…"
              : item.reviewError
                ? `تعذّر إعادةُ الفحص: ${item.reviewError}`
                : r.canArchive
                  ? "لا يُحفَظ شيءٌ قبل تأكيدك — ثمّ يُرفع الملفُّ الأصليّ إلى مجلّده ويُقيَّد."
                  : "لا يُؤرشَف قبل معالجة ما يمنعه — مذكورٌ في «ملاحظاتُ الفحص»."}
          </p>
          <button
            type="button"
            onClick={onArchive}
            disabled={!r.canArchive || item.archiving || item.reviewing}
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
