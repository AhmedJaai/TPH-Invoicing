"use client";

import { useCallback, useRef, useState } from "react";
import { formatRiyalsDisplay } from "@/lib/money";

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
  | { id: string; fileName: string; state: "failed"; error: string }
  | {
      id: string;
      fileName: string;
      state: "done";
      data: AnalysisResponse;
      edited: Record<string, string>;
      fileBase64: string;
      mimeType: string;
      archiving?: boolean;
      archived?: { fileName: string; renamed: boolean; link?: string; corrected: string[] };
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

function Field({
  label,
  value,
  needsReview,
  onChange,
}: {
  label: string;
  value: string;
  needsReview?: boolean;
  onChange: (v: string) => void;
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
        dir="auto"
        className={`nums mt-1 w-full rounded-lg border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-ink ${
          needsReview ? "border-warn" : "border-line"
        }`}
      />
    </label>
  );
}

export function Uploader({ canSeeAmounts = true }: { canSeeAmounts?: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const analyze = useCallback(async (file: File) => {
    const id = `${file.name}-${Date.now()}-${Math.random()}`;
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
      const res = await fetch("/api/analyze", { method: "POST", body });
      const json = await res.json();

      if (!res.ok) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === id ? { id, fileName: file.name, state: "failed", error: json.error ?? "فشل التحليل" } : it,
          ),
        );
        return;
      }

      const data = json as AnalysisResponse;
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
          it.id === id ? { id, fileName: file.name, state: "failed", error: (e as Error).message } : it,
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
    let target: Item | undefined;
    setItems((prev) => {
      target = prev.find((it) => it.id === id);
      return prev.map((it) =>
        it.id === id && it.state === "done" ? { ...it, archiving: true, archiveError: undefined } : it,
      );
    });
    if (!target || target.state !== "done") return;
    const it = target;
    const r = it.data.result;

    try {
      const res = await fetch("/api/archive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: it.edited.fileName || r.proposedFileName,
          folderName: r.proposedFolderName,
          periodMonth: r.periodMonth,
          mimeType: it.mimeType,
          fileBase64: it.fileBase64,
          documentKind: r.documentKind,
          supplierId: r.supplier?.id,
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
          rawExtraction: it.data.extraction,
          extractionModel: it.data.model,
          findings: r.findings,
        }),
      });
      const json = await res.json();

      setItems((prev) =>
        prev.map((x) =>
          x.id === id && x.state === "done"
            ? res.ok
              ? {
                  ...x,
                  archiving: false,
                  archived: {
                    fileName: json.fileName,
                    renamed: json.renamed,
                    link: json.webViewLink,
                    corrected: json.correctedFields ?? [],
                  },
                }
              : { ...x, archiving: false, archiveError: json.error ?? "فشل الرفع" }
            : x,
        ),
      );
    } catch (e) {
      setItems((prev) =>
        prev.map((x) =>
          x.id === id && x.state === "done"
            ? { ...x, archiving: false, archiveError: (e as Error).message }
            : x,
        ),
      );
    }
  }, []);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return;
      for (const f of Array.from(files)) void analyze(f);
    },
    [analyze],
  );

  return (
    <section>
      <div
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
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-2xl border-2 border-dashed border-line px-6 py-12 text-center transition-colors hover:border-ink-soft sm:py-16 ${
          dragging ? "dropping" : ""
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,image/*"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <p className="text-lg font-bold sm:text-xl">اسحب الفواتير هنا</p>
        <p className="mt-2 text-sm text-ink-soft">
          أو اضغط للاختيار — ومن الجوال صوّر الإيصال مباشرة
        </p>
        <p className="mt-4 text-xs text-muted">
          يقرأ النظام الملف نفسه ويستخرج حقوله. اسم الملف الأصلي لا يهم.
        </p>
      </div>

      {items.length > 0 && (
        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">المستندات المقروءة</h2>
            <button
              onClick={() => setItems([])}
              className="text-xs text-muted underline underline-offset-4 hover:text-ink"
            >
              مسح
            </button>
          </div>

          {items.map((item) => {
            if (item.state === "reading") {
              return (
                <article key={item.id} className="rounded-xl border border-line bg-raised p-4">
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
                <article key={item.id} className="rounded-xl border border-line bg-raised p-4">
                  <p className="truncate font-mono text-xs text-ink-soft" dir="ltr">
                    {item.fileName}
                  </p>
                  <p className="mt-2 text-sm text-danger">{item.error}</p>
                </article>
              );
            }

            const r = item.data.result;
            const low = new Set(r.lowConfidenceFields);

            return (
              <article key={item.id} className="rounded-xl border border-line bg-raised p-4">
                <header className="flex items-start justify-between gap-3">
                  <p className="min-w-0 flex-1 truncate font-mono text-xs text-ink-soft" dir="ltr">
                    {item.fileName}
                  </p>
                  <span className="shrink-0 rounded-full bg-sunken px-2.5 py-0.5 text-xs font-bold">
                    {KIND_LABEL[r.documentKind] ?? r.documentKind}
                  </span>
                </header>

                <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field
                    label="التاريخ"
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
                        value={item.edited.vat}
                        needsReview={low.has("المبالغ")}
                        onChange={(v) => editField(item.id, "vat", v)}
                      />
                      <Field
                        label="الإجمالي"
                        value={item.edited.total}
                        needsReview={low.has("المبالغ")}
                        onChange={(v) => editField(item.id, "total", v)}
                      />
                    </>
                  )}
                </dl>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-sunken px-3 py-2">
                    <p className="text-xs text-muted">المورد</p>
                    <p className="mt-0.5 truncate text-sm font-medium">
                      {r.supplier?.nameAr ?? "غير معروف"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-sunken px-3 py-2">
                    <p className="text-xs text-muted">الشهر المحاسبي</p>
                    <p className="nums mt-0.5 text-sm font-medium">{r.periodMonth ?? "—"}</p>
                  </div>
                </div>

                {r.proposedFileName && (
                  <div className="mt-3 rounded-lg border border-line px-3 py-2">
                    <p className="text-xs text-muted">الاسم الجديد</p>
                    <input
                      value={item.edited.fileName}
                      onChange={(e) => editField(item.id, "fileName", e.target.value)}
                      dir="ltr"
                      className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 font-mono text-xs outline-none focus:border-ink"
                    />
                    <p className="mt-2 text-xs text-muted">وجهته في الدرايف</p>
                    <p className="mt-0.5 truncate text-xs font-medium" dir="ltr">
                      {r.proposedFolderPath}
                    </p>
                  </div>
                )}

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

                {item.archived ? (
                  <div className="mt-4 rounded-lg bg-ok-bg px-3 py-2.5 text-xs leading-relaxed text-ok">
                    <p className="font-bold">أُرشف في الدرايف</p>
                    <p className="mt-1 font-mono" dir="ltr">{item.archived.fileName}</p>
                    {item.archived.renamed && (
                      <p className="mt-1">تعارض الاسم فأُضيف رقم نسخة — لم يُستبدل ملف قائم.</p>
                    )}
                    {item.archived.corrected.length > 0 && (
                      <p className="mt-1">سُجّل في التدقيق تعديلك اليدوي: {item.archived.corrected.join("، ")}</p>
                    )}
                    {item.archived.link && (
                      <a href={item.archived.link} target="_blank" rel="noreferrer" className="mt-1 inline-block underline underline-offset-4">
                        افتحه في الدرايف
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <p className="text-xs text-muted">
                      {item.archiveError ? (
                        <span className="text-danger">{item.archiveError}</span>
                      ) : r.canArchive ? (
                        "جاهز للأرشفة بعد اعتمادك"
                      ) : (
                        "لا يمكن أرشفته قبل معالجة ما سبق"
                      )}
                    </p>
                    <button
                      onClick={() => archive(item.id)}
                      disabled={!r.canArchive || item.archiving}
                      className="shrink-0 rounded-lg bg-inverse-surface px-4 py-2 text-sm font-bold text-inverse-ink transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      {item.archiving ? "يرفع…" : "اعتمد وارفع"}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
