"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatRiyalsDisplay } from "@/lib/money";
import { NETWORK_ERROR, postJson, readResponse, request } from "@/lib/http-client";
import { FIELD, countNoun } from "@/lib/arabic";
import { buttonClass } from "./ui";
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

type Item =
  | { id: string; fileName: string; state: "reading" }
  /** `file` لما يُعاد: فشلٌ عابر لا يُطلب له البحثُ عن الملفّ ثانيةً */
  | { id: string; fileName: string; state: "failed"; error: string; file?: File }
  | {
      id: string;
      fileName: string;
      state: "done";
      data: AnalysisResponse;
      edited: Record<string, string>;
      fileBase64: string;
      mimeType: string;
      archiving?: boolean;
      startedAt?: number;
      finishedInMs?: number;
      archiveError?: string;
    };

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

const SEVERITY_STYLE: Record<Finding["severity"], string> = {
  INFO: "bg-sunken text-ink-soft",
  WARN: "bg-warn-bg text-warn",
  BLOCKER: "bg-danger-bg text-danger",
};

/**
 * شريط تقدّم الرفع مع عدّاد يعمل حيّاً.
 *
 * الرفع لا يعطينا نسبة حقيقية (طلب واحد لا يبلّغ عن تقدّمه)، فالشريط
 * متحرّك يدلّ على أنّ العمل جارٍ، والعدّاد هو المعلومة الصادقة عن الزمن.
 */
function UploadProgress({ startedAt }: { startedAt?: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt) return;
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [startedAt]);

  const slow = elapsed >= 30;

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className={slow ? "text-warn" : "text-ink-soft"}>
          {slow ? "يرفع… الخادم بطيء، امنحه لحظة" : "يرفع إلى الدرايف…"}
        </span>
        <span className="nums shrink-0 text-muted" dir="ltr">
          {elapsed}s
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken">
        <div className="upload-bar h-full w-1/3 rounded-full bg-ink" />
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  needsReview,
  onChange,
  type = "text",
  inputMode,
}: {
  label: string;
  value: string;
  needsReview?: boolean;
  onChange: (v: string) => void;
  /** التاريخ `date` يفتح منتقي التاريخ على الجوّال بدل لوحة الأحرف. */
  type?: "text" | "date";
  /** المبالغ `decimal` تفتح لوحة الأرقام. */
  inputMode?: "decimal" | "numeric" | "text";
}) {
  return (
    <label className="block min-w-0">
      <span className={`text-xs ${needsReview ? "font-bold text-warn" : "text-muted"}`}>
        {label}
        {needsReview && " ⚠"}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        inputMode={inputMode}
        dir="auto"
        className={`nums mt-1 w-full rounded-lg border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-ink ${
          needsReview ? "border-warn" : "border-line-input"
        }`}
      />
    </label>
  );
}

/**
 * لا يُعرَض إلّا ما يحتاج قراراً.
 *
 * حين تُقرأ الحقول الستّة كلّها بثقة، فمطالبة المستخدم بتأكيدها واحداً
 * واحداً عملٌ بلا فائدة — يُبطئه ويعلّمه أن يضغط «موافق» بلا نظر. فإن
 * كان كلّ شيء سليماً قيل ذلك في سطر، وبقيت التفاصيل خلف نقرة. وإن كان
 * فيه ما يحتاج مراجعة، ذُكر عدده وفُتح مباشرةً.
 */
function DecisionBanner({ count }: { count: number }) {
  if (count === 0) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-ok/40 bg-ok-bg px-3 py-2.5">
        <span className="text-ok" aria-hidden>✓</span>
        <p className="text-xs font-bold text-ok">قُرئ كل شيء بثقة — راجع التفاصيل إن شئت، ثمّ أرشِف.</p>
      </div>
    );
  }
  return (
    <div className="mt-3 flex items-center gap-2 rounded-xl border border-warn/40 bg-warn-bg px-3 py-2.5">
      <span className="text-warn" aria-hidden>⚠</span>
      <p className="text-xs font-bold text-warn">
        {count === 1 ? "حقلٌ واحد يحتاج انتباهك" : count === 2 ? "حقلان يحتاجان انتباهك" : `${countNoun(count, FIELD)} تحتاج انتباهك`}
        {" "}قبل الأرشفة.
      </p>
    </div>
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
  detected,
  candidates,
  suppliers,
  chosen,
  onChoose,
  onCreated,
  canCreate = true,
}: {
  /** إنشاء المورّد يحتاج `supplier:edit` — مدير المشتريات يختار ولا يُنشئ */
  canCreate?: boolean;
  detected?: SupplierOption;
  candidates: { id: string; nameAr: string }[];
  suppliers: SupplierOption[];
  chosen?: SupplierOption;
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
      setCreating(false);
      setName("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg bg-sunken px-3 py-2">
      <p className="text-xs text-muted">
        المورد
        {!active && <span className="ms-1 font-bold text-danger">— لم يُعرف، اختره أو أنشئه</span>}
        {chosen && <span className="ms-1 text-ok">— اخترتَه</span>}
      </p>

      <select
        aria-label="المورّد"
        value={active?.id ?? ""}
        onChange={(e) => {
          const sup = suppliers.find((x) => x.id === e.target.value)
            ?? candidates.find((x) => x.id === e.target.value);
          if (sup) onChoose({ id: sup.id, nameAr: sup.nameAr });
        }}
        className={`mt-1 w-full rounded border bg-surface px-2 py-1.5 text-sm outline-none focus:border-ink ${
          active ? "border-line-input" : "border-danger"
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
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <input
            aria-label="اسم المورّد الجديد"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
            placeholder="اسم المورّد الجديد"
            dir="auto"
            autoFocus
            className="min-w-0 flex-1 rounded border border-line-input bg-surface px-2 py-1 text-xs outline-none focus:border-ink"
          />
          <button
            onClick={() => void create()}
            disabled={busy || name.trim().length < 2}
            className={buttonClass("primary", "sm")}
          >
            {busy ? "…" : "أنشئه"}
          </button>
          <button
            onClick={() => { setCreating(false); setError(null); }}
            className="shrink-0 text-[11px] text-muted hover:text-ink"
          >
            إلغاء
          </button>
        </div>
      ) : canCreate ? (
        <button
          onClick={() => setCreating(true)}
          className="mt-1.5 text-[11px] text-ink-soft underline underline-offset-4 hover:text-ink"
        >
          مورّد جديد…
        </button>
      ) : null}

      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
    </div>
  );
}

interface Archived {
  id: string;
  fileName: string;
  folder: string;
  link?: string;
  renamed: boolean;
  at: number;
}

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
  const [archived, setArchived] = useState<Archived[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * مرجع حيّ للعناصر.
   *
   * قراءة الحالة من داخل دالة تحديث setState خطأ: React ينفّذها متأخّراً
   * وقد يكرّرها، فتبقى القيمة المقروءة فارغة ويخرج الكود صامتاً — وهو ما
   * كان يُبقي زرّ الرفع على «يرفع…» بلا أن يُرسَل طلب أصلاً.
   */
  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;

  const analyze = useCallback(async (file: File) => {
    const id = `${file.name}-${Date.now()}-${Math.random()}`;

    /* الحدّ يُقال قبل الإرسال — لا ٤١٣ نصّيّ من المنصّة بعده */
    if (file.size > 3 * 1024 * 1024) {
      setItems((prev) => [{
        id, fileName: file.name, state: "failed",
        error: "الملف أكبر من ٣ ميجابايت — حدّ الأرشفة. صغّره (صوّره بدقّة أقلّ أو اضغط الـPDF) ثمّ أعد المحاولة.",
      }, ...prev]);
      return;
    }

    setItems((prev) => [{ id, fileName: file.name, state: "reading" }, ...prev]);

    // نحتفظ بالبايتات لأنّ الأرشفة ترفع الملف الأصلي نفسه لا نسخة معاد بناؤها
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const fileBase64 = btoa(binary);

    try {
      const body = new FormData();
      body.append("file", file);
      const r = await request<AnalysisResponse>("/api/analyze", { method: "POST", body });

      if (!r.ok) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === id ? { id, fileName: file.name, state: "failed", error: r.error, file } : it,
          ),
        );
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
      setItems((prev) =>
        prev.map((it) =>
          it.id === id ? { id, fileName: file.name, state: "failed", error: (e as Error).message, file } : it,
        ),
      );
    }
  }, []);

  const editField = useCallback((id: string, key: string, value: string) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === id && it.state === "done" ? { ...it, edited: { ...it.edited, [key]: value } } : it,
      ),
    );
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
      const read = await readResponse<{ fileName: string; webViewLink?: string; renamed?: boolean }>(res);

      if (read.ok) {
        const json = read.data;
        // البطاقة أدّت غرضها. ننقلها إلى سجل مختصر ونُخلي الشاشة للملف التالي.
        setArchived((prev) => [
          {
            id,
            fileName: json.fileName,
            folder: r.proposedFolderPath ?? "",
            link: json.webViewLink,
            renamed: Boolean(json.renamed),
            at: Date.now(),
          },
          ...prev,
        ]);
        setItems((prev) => prev.filter((x) => x.id !== id));
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

  const justArchived = archived.length > 0 && Date.now() - archived[0].at < 8000;

  return (
    <section>
      {justArchived && (
        <div className="mb-4 rounded-xl border border-ok/40 bg-ok-bg px-4 py-3">
          <p className="text-sm font-bold text-ok">✓ تم الرفع بنجاح</p>
          <p className="mt-1 truncate font-mono text-[11px] text-ok" dir="ltr">
            {archived[0].fileName}
          </p>
          <p className="mt-1 text-xs text-ink-soft">الشاشة جاهزة للملف التالي.</p>
        </div>
      )}

      {/*
        منطقة الرفع `label` يلفّ الحقل — فتُبلَغ بلوحة المفاتيح وتُقرأ بقارئ
        الشاشة. كانت `div` بنقرة والحقل `hidden` (أي `display:none`) فلا
        يُركَّز عليه أصلاً: من لا يستعمل الفأرة لا يرفع فاتورة.
      */}
      <label
        data-dropzone=""
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`block cursor-pointer rounded-2xl border-2 border-dashed border-line px-6 py-12 text-center transition-colors focus-within:border-ink hover:border-ink-soft sm:py-16 ${
          dragging ? "dropping" : ""
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,image/*"
          className="sr-only"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <p className="text-lg font-bold sm:text-xl">اسحب الفواتير هنا</p>
        <p className="mt-2 text-sm text-ink-soft">
          أو اضغط للاختيار — ومن الجوال صوّر الإيصال مباشرة
        </p>
        <p className="mt-4 text-xs text-muted">
          يقرأ النظام الملف نفسه ويستخرج حقوله. اسم الملف الأصلي لا يهم.
        </p>
      </label>

      {archived.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-bold">رُفع في هذه الجلسة ({archived.length})</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
            {archived.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[11px]" dir="ltr">{a.fileName}</span>
                  <span className="block truncate text-[11px] text-muted" dir="ltr">{a.folder}</span>
                  {a.renamed && (
                    <span className="text-[11px] text-warn">أُضيف رقم نسخة — لم يُستبدل ملف قائم</span>
                  )}
                </span>
                {a.link && (
                  <a
                    href={a.link}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-[11px] text-ink-soft underline underline-offset-4 hover:text-ink"
                  >
                    افتحه
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {items.length > 0 && (
        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">المستندات المقروءة</h2>
            {/*
              «مسح» كان يرمي كلّ القراءات — ومنها ما دُفع ثمنُ قراءته ولم يُرفع
              بعد. فصار يمسح ما فشل وحده.
            */}
            {items.some((it) => it.state === "failed") && (
              <button
                onClick={() => setItems((prev) => prev.filter((it) => it.state !== "failed"))}
                className="inline-flex min-h-11 items-center text-xs text-muted underline underline-offset-4 hover:text-ink sm:min-h-0"
              >
                امسح ما فشل
              </button>
            )}
          </div>

          {items.map((item) => {
            if (item.state === "reading") {
              return (
                <article key={item.id} className="rounded-2xl border border-line bg-raised shadow-raised p-4">
                  <p className="truncate font-mono text-xs text-ink-soft" dir="ltr">
                    {item.fileName}
                  </p>
                  <p className="mt-2 animate-pulse text-sm text-muted">
                    يقرأ المستند ويستخرج حقوله…
                  </p>
                </article>
              );
            }

            if (item.state === "failed") {
              return (
                <article key={item.id} className="rounded-2xl border border-line bg-raised shadow-raised p-4">
                  <p className="truncate font-mono text-xs text-ink-soft" dir="ltr">
                    {item.fileName}
                  </p>
                  <p className="mt-2 text-sm text-danger">{item.error}</p>
                  {item.file && (
                    <button
                      type="button"
                      onClick={() => {
                        const file = item.file!;
                        setItems((prev) => prev.filter((it) => it.id !== item.id));
                        void analyze(file);
                      }}
                      className={`mt-3 ${buttonClass("secondary", "sm")}`}
                    >
                      أعد القراءة
                    </button>
                  )}
                </article>
              );
            }

            const r = item.data.result;
            const low = new Set(r.lowConfidenceFields);
            const blocking = r.findings.filter((f) => f.severity === "BLOCKER").length;
            const needsSupplier = !chosen[item.id] && !r.supplier;
            const decisions = low.size + blocking + (needsSupplier ? 1 : 0);

            return (
              <article key={item.id} className="rounded-2xl border border-line bg-raised shadow-raised p-4">
                <header className="flex items-start justify-between gap-3">
                  <p className="min-w-0 flex-1 truncate font-mono text-xs text-ink-soft" dir="ltr">
                    {item.fileName}
                  </p>
                  <span className="shrink-0 rounded-full bg-sunken px-2.5 py-0.5 text-xs font-bold">
                    {KIND_LABEL[r.documentKind] ?? r.documentKind}
                  </span>
                </header>

                <DecisionBanner count={decisions} />

                <details open={decisions > 0} className="group mt-3">
                  <summary className="cursor-pointer list-none text-xs font-bold text-ink-soft underline underline-offset-4 hover:text-ink">
                    <span className="group-open:hidden">اعرض التفاصيل</span>
                    <span className="hidden group-open:inline">أخفِ التفاصيل</span>
                  </summary>

                <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field
                    label="التاريخ"
                    type="date"
                    value={item.edited.invoiceDate}
                    needsReview={low.has("التاريخ")}
                    onChange={(v) => editField(item.id, "invoiceDate", v)}
                  />
                  <Field
                    label="رقم الفاتورة"
                    value={item.edited.invoiceNumber}
                    needsReview={low.has("رقم الفاتورة")}
                    onChange={(v) => editField(item.id, "invoiceNumber", v)}
                  />
                  {canSeeAmounts && (
                    <>
                      <Field
                        label="الضريبة"
                        inputMode="decimal"
                        value={item.edited.vat}
                        needsReview={low.has("المبالغ")}
                        onChange={(v) => editField(item.id, "vat", v)}
                      />
                      <Field
                        label="الإجمالي"
                        inputMode="decimal"
                        value={item.edited.total}
                        needsReview={low.has("المبالغ")}
                        onChange={(v) => editField(item.id, "total", v)}
                      />
                    </>
                  )}
                </dl>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <SupplierPicker
                canCreate={canCreateSupplier}
                    detected={r.supplier}
                    candidates={r.supplierCandidates}
                    suppliers={suppliers}
                    chosen={chosen[item.id]}
                    onChoose={(sup) => setChosen((prev) => ({ ...prev, [item.id]: sup }))}
                    onCreated={(sup) => {
                      setSuppliers((prev) =>
                        prev.some((x) => x.id === sup.id) ? prev : [...prev, sup].sort((a, b) => a.nameAr.localeCompare(b.nameAr, "ar")),
                      );
                      setChosen((prev) => ({ ...prev, [item.id]: sup }));
                    }}
                  />
                  <div className="rounded-lg bg-sunken px-3 py-2">
                    <p className="text-xs text-muted">الشهر المحاسبي</p>
                    <p className="nums mt-0.5 text-sm font-medium">{r.periodMonth ?? "—"}</p>
                  </div>
                </div>

                {r.proposedFileName && (
                  <div className="mt-3 rounded-lg border border-line px-3 py-2">
                    <label htmlFor={`file-name-${item.id}`} className="block text-xs text-muted">الاسم الجديد</label>
                    <input
                      id={`file-name-${item.id}`}
                      value={item.edited.fileName}
                      onChange={(e) => editField(item.id, "fileName", e.target.value)}
                      dir="ltr"
                      className="mt-1 w-full rounded border border-line-input bg-surface px-2 py-1 font-mono text-xs outline-none focus:border-ink"
                    />
                    <p className="mt-2 text-xs text-muted">وجهته في الدرايف</p>
                    <p className="mt-0.5 truncate text-xs font-medium" dir="ltr">
                      {r.proposedFolderPath}
                    </p>
                  </div>
                )}

                </details>

                {r.findings.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {r.findings.map((f, i) => (
                      <li
                        key={i}
                        className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${SEVERITY_STYLE[f.severity]}`}
                      >
                        {f.message}
                      </li>
                    ))}
                  </ul>
                )}

                {item.archiving && <UploadProgress startedAt={item.startedAt} />}

                {(
                  <>
                    {item.archiveError && (
                      <div className="mt-4 rounded-lg bg-danger-bg px-3 py-2.5 text-xs leading-relaxed text-danger">
                        <p className="font-bold">
                          ✕ فشل الرفع
                          {item.finishedInMs !== undefined &&
                            ` — بعد ${(item.finishedInMs / 1000).toFixed(1)} ثانية`}
                        </p>
                        <p className="mt-1">{item.archiveError}</p>
                      </div>
                    )}

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <p className="text-xs text-muted">
                        {r.canArchive ? "جاهز للرفع بعد تأكيدك" : "لا يُرفَع قبل معالجة ما فوقه"}
                      </p>
                      <button
                        onClick={() => archive(item.id)}
                        disabled={!r.canArchive || item.archiving}
                        className={`shrink-0 ${buttonClass("primary")}`}
                      >
                        {item.archiving ? "يرفع…" : item.archiveError ? "أعد المحاولة" : "أكّد وارفع"}
                      </button>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
