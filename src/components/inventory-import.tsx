"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { request } from "@/lib/http-client";
import { ArrowLeft, CircleAlert, CircleCheck, Copy, FileSpreadsheet, Loader2, TriangleAlert, Upload, type LucideIcon } from "lucide-react";
import { buttonClass } from "./ui";
import { formatWeek } from "./inventory-ui";
import { PRODUCT, countNoun } from "@/lib/arabic";
import { MAX_SALES_FILE_BYTES, SALES_FILE_TOO_LARGE } from "@/lib/sales/file-import";
import { T } from "@/components/i18n/t";

/**
 * رفعُ ملفّ مبيعات فودكس.
 *
 * ── ولماذا تُعرَض الأعمدةُ التي فُهمت ──
 *
 * القارئُ يربط الترويسات بحقولها بالاسم. فإن أخطأ — قرأ «سعر الوحدة»
 * كمّيّةً مثلاً — لم يظهر ذلك في رقمٍ خاطئ بل في **جردٍ خاطئ بعد
 * أسبوع**. فيُعرَض ما فُهم وما لم يُفهَم قبل أن يُبنى شيء، ويُقابَل
 * بالعين في ثانية.
 */
interface ImportResponse {
  status: "IMPORTED" | "PARTIAL" | "FAILED" | "DUPLICATE";
  shape: string;
  periodStart: string | null;
  periodEnd: string | null;
  totals: {
    rows: number; parsed: number; skipped: number; errors: number; duplicates: number;
    salesWritten: number; salesRestated: number; lineCount: number; unitsMilli: number;
  };
  messages: string[];
  recognisedColumns: string[];
  unrecognisedColumns: string[];
  unmappedProducts: number;
}

const SHAPE_LABEL: Record<string, string> = {
  FOODICS_ORDER_ITEMS: "تصدير بنود الطلبات (في كل صف رقم طلبه)",
  FOODICS_ORDERS: "تصدير الطلبات (في كل صف رقم طلبه)",
  FOODICS_PRODUCT_MIX: "تصدير مزيج الأصناف (كمية ما بيع من كل صنف في اليوم)",
};

const STATUS_LABEL: Record<ImportResponse["status"], { text: string; tone: string; border: string; icon: LucideIcon }> = {
  IMPORTED: { text: "اكتمل الاستيراد", tone: "text-ok", border: "border-ok/30", icon: CircleCheck },
  PARTIAL: { text: "استُورد جزء من الملف، وما لم يُقرأ محفوظ مع سببه", tone: "text-warn", border: "border-warn/30", icon: TriangleAlert },
  FAILED: { text: "لم يُستورد شيء. راجع الأعمدة أدناه", tone: "text-danger", border: "border-danger/30", icon: CircleAlert },
  DUPLICATE: { text: "هذا الملف مستورد من قبل، فلم يُسجَّل منه شيء مرة أخرى", tone: "text-ink-soft", border: "border-line", icon: Copy },
};

export function InventoryImport({ canImport, hasCatalog = true }: { canImport: boolean; hasCatalog?: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [businessDate, setBusinessDate] = useState("");
  const [dateOpen, setDateOpen] = useState(false);

  /*
    ── الملفُّ يُختار ثمّ يُستورَد — فعلان لا فعل ──

    كان الاختيارُ يرفع في اللحظة نفسها، فمن أخطأ الملفَّ (تقريرُ الشهر
    الماضي، أو كشفُ البنك) كتب قبل أن يرى اسمه. والآن يُرى الاسمُ والحجمُ
    ثمّ يُضغَط «استورِده».
  */
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);

    const form = new FormData();
    form.append("file", file);
    if (businessDate) form.append("businessDate", businessDate);

    const r = await request<ImportResponse>("/api/inventory/import", { method: "POST", body: form });
    setBusy(false);

    if (!r.ok) {
      setError(r.error);
      /* الردُّ المرفوض يحمل تفصيلَ ما فُهم — يُعرَض، فهو ما يُصلِح به المستخدم ملفّه */
      if (r.data && "recognisedColumns" in r.data) setResult(r.data as ImportResponse);
      return;
    }
    setResult(r.data);
    setFile(null);
    router.refresh();
  }

  function reset() {
    setFile(null);
    setResult(null);
    setError(null);
  }

  if (!canImport) {
    return (
      <p className="rounded-xl border border-dashed border-line px-5 py-6 text-center text-xs text-muted">
        استيراد المبيعات ليس من صلاحياتك، ويرفعه من يملك صلاحية الجرد.
      </p>
    );
  }

  const status = result ? STATUS_LABEL[result.status] : null;

  return (
    <div className="space-y-4">
      {!hasCatalog && !result && (
        <p className="flex items-start gap-2 rounded-lg border border-warn/25 bg-warn-bg px-3 py-2.5 text-xs leading-relaxed text-ink-soft">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" strokeWidth={2} aria-hidden />
          <span>
            <T s="{0} ستُحفظ المبيعات الآن، ويبقى استهلاكها «غير معروف» حتى تصل الوصفات، ولن تحتاج إلى رفعها مرة أخرى بعد ذلك." a={[<strong key="0" className="text-ink">ارفع الكتالوج قبل المبيعات.</strong>]} /></span>
        </p>
      )}

      {!result && (
        <div className="rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
          {file ? (
            /* ── المعاينة: اسمُ الملفّ وحجمُه، ثمّ الاستيراد ── */
            <div className="flex flex-wrap items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ok-bg text-ok">
                <FileSpreadsheet className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold" dir="auto">{file.name}</p>
                <p className="text-[11px] text-muted"><T s="{0} · سيُقرأ الملف بحسب أعمدته، ولن يُسجَّل إن كان مستورداً من قبل" a={[<span key="0" className="nums">{kb(file.size)}</span>]} /></p>
              </div>
              <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                <button type="button" onClick={() => void upload()} disabled={busy} className={`${buttonClass("primary")} flex-1 sm:flex-none`}>
                  {busy ? <><T s="{0}يقرأ الملف…" a={[<Loader2 key="0" className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden />]} /></> : <><T s="{0}استورد الملف" a={[<Upload key="0" className="h-4 w-4" strokeWidth={2} aria-hidden />]} /></>}
                </button>
                <button type="button" onClick={reset} disabled={busy} className={buttonClass("quiet")}>غيّر الملف</button>
              </div>
            </div>
          ) : (
            <label className="group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-input bg-sunken/40 px-5 py-8 text-center transition-colors hover:border-accent hover:bg-accent-soft/40 focus-within:border-accent">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent">
                <Upload className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="text-sm font-bold">اختر ملف مبيعات فودكس</span>
              <span className="max-w-sm text-xs leading-relaxed text-muted">Excel أو CSV لا يتجاوز ٤ ميجابايت، ويغطي أسبوعاً واحداً. رفع الملف نفسه مرتين لا يكرر المبيعات.</span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  /* يُقال قبل الرفع — المنصّةُ تردّ الكبيرَ بخطأٍ لا يُفهَم */
                  if (f.size > MAX_SALES_FILE_BYTES) { setFile(null); setError(SALES_FILE_TOO_LARGE); return; }
                  setFile(f);
                  setError(null);
                }}
              />
            </label>
          )}

          <div className="mt-3">
            {dateOpen ? (
              <label className="block">
                <span className="block text-[11px] font-medium text-muted">يوم العمل (يُملأ فقط إن لم يكن في الملف عمود تاريخ)</span>
                <input
                  type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)}
                  className="nums mt-1 min-h-11 rounded-lg border border-line-input bg-raised px-3 text-sm"
                />
              </label>
            ) : (
              <button type="button" onClick={() => setDateOpen(true)} className={`${buttonClass("quiet", "sm")} -ms-2`}>
                ليس في الملف عمود تاريخ؟ حدّد يوم العمل
              </button>
            )}
          </div>

          {error && (
            <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-bg px-3 py-2.5 text-xs leading-relaxed text-danger">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              <span>{error} {file && "(لم يُسجَّل شيء، ويمكنك المحاولة من جديد)"}</span>
            </p>
          )}
        </div>
      )}

      {result && status && (
        <div className={`rounded-2xl border bg-raised p-4 shadow-raised sm:p-5 ${status.border}`}>
          <div className="flex flex-wrap items-start gap-3">
            <status.icon className={`mt-0.5 h-5 w-5 shrink-0 ${status.tone}`} strokeWidth={2} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className={`text-[15px] font-bold ${status.tone}`}>{status.text}</p>
              <p className="mt-0.5 text-xs text-muted">
                {result.periodStart ? <><T s="الفترة المقروءة: {0}" a={[<strong key="0" className="text-ink-soft">{formatWeek(result.periodStart, result.periodEnd ?? result.periodStart)}</strong>]} /></> : "لم تُقرأ فترة من الملف."}
                {result.shape && SHAPE_LABEL[result.shape] && <> · {SHAPE_LABEL[result.shape]}</>}
              </p>
            </div>
            <button type="button" onClick={reset} className={buttonClass("secondary", "sm")}>ارفع ملفاً آخر</button>
          </div>
          {error && <p role="alert" className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-xs leading-relaxed text-danger">{error}</p>}

          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Fact label="صفوف الملف" value={result.totals.rows} />
            <Fact label="صفوف مقروءة" value={result.totals.parsed} />
            <Fact label="مبيعات مسجّلة" value={result.totals.salesWritten} />
            <Fact label="مبيعات محدّثة" value={result.totals.salesRestated} />
            <Fact label="بنود البيع" value={result.totals.lineCount} />
            <Fact label="صفوف متجاهلة" value={result.totals.skipped} />
            <Fact label="صفوف لم تُقرأ" value={result.totals.errors} tone={result.totals.errors > 0 ? "text-danger" : undefined} />
            <Fact label="أصناف تحتاج إلى ربط" value={result.unmappedProducts} tone={result.unmappedProducts > 0 ? "text-warn" : undefined} />
          </dl>

          {/* العددُ الذي يُنذر يحمل فعلَه — ثمّ الخطوةُ التالية في الطريق */}
          <div className="mt-4 flex flex-wrap gap-2">
            {result.unmappedProducts > 0 && (
              <Link href="/inventory/mapping" className={buttonClass("primary", "sm")}>
                <T s="اربط {0} {1}" a={[countNoun(result.unmappedProducts, PRODUCT), <ArrowLeft key="1" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></Link>
            )}
            {(result.status === "IMPORTED" || result.status === "PARTIAL") && (
              <Link href="/inventory#start" className={buttonClass(result.unmappedProducts > 0 ? "secondary" : "primary", "sm")}>
                <T s="إلى الجرد {0}" a={[<ArrowLeft key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></Link>
            )}
          </div>

          {result.messages.length > 0 && (
            <ul className="mt-4 space-y-1.5">
              {result.messages.map((m, i) => (
                <li key={i} className="flex items-start gap-2 rounded-lg border border-warn/25 bg-warn-bg px-3 py-2 text-xs leading-relaxed text-ink-soft">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" strokeWidth={2} aria-hidden />
                  {m}
                </li>
              ))}
            </ul>
          )}

          {result.recognisedColumns.length > 0 && (
            <details className="mt-4 rounded-lg border border-line-soft bg-sunken/50 px-3 py-2">
              <summary className="flex min-h-11 cursor-pointer items-center text-xs font-bold sm:min-h-8">
                <T s="الأعمدة التي تعرّف عليها النظام ({0}). قارنها بالملف" a={[result.recognisedColumns.length]} /></summary>
              <ul className="mt-1 flex flex-wrap gap-1.5 pb-2">
                {result.recognisedColumns.map((c) => <li key={c} className="rounded-md bg-raised px-2 py-0.5 text-[11px] text-ink-soft" dir="auto">{c}</li>)}
              </ul>
              {result.unrecognisedColumns.length > 0 && (
                <p className="pb-2 text-[11px] text-muted"><strong>أعمدة لم يتعرّف عليها النظام:</strong> {result.unrecognisedColumns.join(" · ")}</p>
              )}
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function Fact({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-sunken/60 px-3 py-2">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className={`nums mt-0.5 text-base font-bold ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}

function kb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} م.ب` : `${Math.max(1, Math.round(bytes / 1024))} ك.ب`;
}
