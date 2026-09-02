"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { parseFileName, type ParsedFileName } from "@/lib/naming";
import { drivePathFor, monthOf, resolveReceiptFiling } from "@/lib/filing";
import { formatRiyalsDisplay } from "@/lib/money";

export interface SupplierRef {
  slug: string;
  nameAr: string;
  driveFolderName: string;
  issuesInvoices: boolean;
}

interface Analysis {
  fileName: string;
  sizeLabel: string;
  parsed?: ParsedFileName;
  problem?: string;
  supplier?: SupplierRef;
  targetPath?: string;
  notes: { tone: "ok" | "warn" | "danger"; text: string }[];
}

const KIND_LABEL: Record<string, string> = {
  INVOICE: "فاتورة",
  STATEMENT: "كشف حساب",
  RECEIPT: "إيصال سداد",
  CASH: "إيصال نقدي",
};

const SERVICE_FOLDER: Record<string, string> = {
  RECEIPT: "_إيصالات السداد",
  CASH: "_نقدي - Cash receipts",
};

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} كيلوبايت`;
  return `${(bytes / 1024 / 1024).toFixed(1)} ميجابايت`;
}

function analyze(file: File, suppliers: SupplierRef[], slugs: string[]): Analysis {
  const base: Analysis = { fileName: file.name, sizeLabel: humanSize(file.size), notes: [] };
  const result = parseFileName(file.name, slugs);

  if (!result.ok) {
    return { ...base, problem: result.reason };
  }

  const parsed = result.value;
  const supplier = suppliers.find((s) => s.slug === parsed.slug);
  const notes: Analysis["notes"] = [];

  // الشهر: الفاتورة والكشف بتاريخهما، والإيصال يتبع فواتيره لا تاريخ تحويله.
  const date = new Date(`${parsed.date}T00:00:00Z`);
  const month =
    parsed.kind === "RECEIPT" ? resolveReceiptFiling({ paidAt: date }) : monthOf(date);

  const folder =
    SERVICE_FOLDER[parsed.kind] ?? supplier?.driveFolderName ?? "_أخرى - Other suppliers";
  const targetPath = drivePathFor(month, folder);

  if (parsed.kind === "RECEIPT") {
    notes.push({
      tone: "warn",
      text: `الإيصال يُحفظ في شهر فواتيره لا شهر تحويله. التحويل في ${parsed.date} فالشهر المرجَّح ${month} — يُصحَّح بعد ربطه بفواتيره.`,
    });
  }

  if (!supplier && parsed.slug) {
    notes.push({ tone: "danger", text: `المورد «${parsed.slug}» غير مسجّل — يحتاج إنشاءه أولاً.` });
  }

  if (supplier && !supplier.issuesInvoices) {
    notes.push({ tone: "warn", text: "مورد لا يصدر فواتير ضريبية — يحتاج عقد توريد مكتوب." });
  }

  if (parsed.beneficiary) {
    notes.push({ tone: "ok", text: `اسم المستفيد البنكي: ${parsed.beneficiary}` });
  }

  if (parsed.duplicateIndex) {
    notes.push({ tone: "warn", text: `اسم الملف يحمل رقم نسخة (${parsed.duplicateIndex}).` });
  }

  return { ...base, parsed, supplier, targetPath, notes };
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="nums mt-0.5 truncate text-sm font-medium">{value}</dd>
    </div>
  );
}

export function Analyzer({ suppliers }: { suppliers: SupplierRef[] }) {
  const [results, setResults] = useState<Analysis[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const slugs = useMemo(() => suppliers.map((s) => s.slug), [suppliers]);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return;
      const next = Array.from(files).map((f) => analyze(f, suppliers, slugs));
      setResults((prev) => [...next, ...prev].slice(0, 20));
    },
    [suppliers, slugs],
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
          أو اضغط للاختيار — ومن الجوال تقدر تصوّر الإيصال مباشرة
        </p>
        <p className="mt-4 text-xs text-muted">
          معاينة محلية: يقرأ اسم الملف ويحدّد وجهته. لا يُرفع شيء إلى الدرايف.
        </p>
      </div>

      {results.length > 0 && (
        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">نتيجة التحليل</h2>
            <button
              onClick={() => setResults([])}
              className="text-xs text-muted underline underline-offset-4 hover:text-ink"
            >
              مسح
            </button>
          </div>

          {results.map((r, i) => (
            <article key={`${r.fileName}-${i}`} className="rounded-xl border border-line bg-raised p-4">
              <header className="flex items-start justify-between gap-3">
                <p className="min-w-0 flex-1 truncate font-mono text-xs text-ink-soft" dir="ltr">
                  {r.fileName}
                </p>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                    r.problem ? "bg-danger-bg text-danger" : "bg-ok-bg text-ok"
                  }`}
                >
                  {r.problem ? "اسم غير مطابق" : KIND_LABEL[r.parsed!.kind]}
                </span>
              </header>

              {r.problem ? (
                <p className="mt-3 text-sm text-danger">
                  {r.problem}
                  <span className="mt-1 block text-xs text-muted">
                    الصيغة المطلوبة: YYYY-MM-DD_المورد_Invoice_الرقم_SAR المبلغ.pdf
                  </span>
                </p>
              ) : (
                <>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                    <Field label="التاريخ" value={r.parsed!.date} />
                    <Field label="المبلغ" value={`${formatRiyalsDisplay(r.parsed!.amountMinor)} ريال`} />
                    <Field
                      label="المورد"
                      value={r.supplier?.nameAr ?? r.parsed!.slug ?? r.parsed!.description ?? "—"}
                    />
                    <Field label="رقم الفاتورة" value={r.parsed!.invoiceNumber ?? "—"} />
                  </dl>

                  <div className="mt-3 rounded-lg bg-sunken px-3 py-2">
                    <p className="text-xs text-muted">وجهته في الدرايف</p>
                    <p className="mt-0.5 truncate text-xs font-medium" dir="ltr">
                      {r.targetPath}
                    </p>
                  </div>
                </>
              )}

              {r.notes.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {r.notes.map((n, j) => (
                    <li
                      key={j}
                      className={`text-xs leading-relaxed ${
                        n.tone === "ok" ? "text-ok" : n.tone === "warn" ? "text-warn" : "text-danger"
                      }`}
                    >
                      {n.text}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
