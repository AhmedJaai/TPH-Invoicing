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
  | { id: string; fileName: string; state: "done"; data: AnalysisResponse; edited: Record<string, string> };

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

export function Uploader() {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const analyze = useCallback(async (file: File) => {
    const id = `${file.name}-${Date.now()}-${Math.random()}`;
    setItems((prev) => [{ id, fileName: file.name, state: "reading" }, ...prev]);

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

                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-xs text-muted">
                    {r.canArchive
                      ? "جاهز للأرشفة بعد اعتمادك"
                      : "لا يمكن أرشفته قبل معالجة ما سبق"}
                  </p>
                  <button
                    disabled
                    title="يبدأ العمل بعد إعداد بيانات جوجل"
                    className="shrink-0 rounded-lg bg-inverse-surface px-4 py-2 text-sm font-bold text-inverse-ink disabled:opacity-40"
                  >
                    اعتمد وارفع
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
