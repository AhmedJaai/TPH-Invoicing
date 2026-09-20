"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { request } from "@/lib/http-client";
import { buttonClass } from "./ui";

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
  newPosProducts: number;
}

const SHAPE_LABEL: Record<string, string> = {
  FOODICS_ORDERS: "تصديرُ طلبات — لكلّ صفٍّ رقمُ طلبه",
  FOODICS_PRODUCT_MIX: "تصديرُ مزيج أصناف — «كم بِيع من كلٍّ في اليوم»",
};

const STATUS_LABEL: Record<ImportResponse["status"], { text: string; tone: string }> = {
  IMPORTED: { text: "استُورد كاملاً", tone: "text-ok" },
  PARTIAL: { text: "استُورد جزئياً — وما لم يُقرأ محفوظٌ بسببه", tone: "text-warn" },
  FAILED: { text: "لم يُستورَد", tone: "text-danger" },
  DUPLICATE: { text: "هذا الملفّ عندنا من قبل — لم يُكتب شيءٌ ثانيةً", tone: "text-muted" },
};

export function InventoryImport({ canImport }: { canImport: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [businessDate, setBusinessDate] = useState("");

  async function upload(file: File) {
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
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
        <h3 className="font-display text-base font-bold">ارفع ملفّ مبيعات فودكس</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          صدِّر من فودكس تقريرَ الأصناف أو تقريرَ الطلبات (Excel)، وارفعه هنا. والملفُّ
          نفسُه مرّتين لا يُضاعف شيئاً.
        </p>

        <label className="mt-3 block">
          <span className="block text-[11px] text-muted">
            يومُ العمل — يُملأ فقط إن لم يكن في الملفّ عمودُ تاريخ
          </span>
          <input
            type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)}
            className="nums mt-1 min-h-11 rounded-xl border border-line bg-canvas px-3 text-sm"
          />
        </label>

        {canImport && (
          <label className={`${buttonClass("primary")} mt-4 cursor-pointer`}>
            {busy ? "يُقرأ الملفّ…" : "اختر ملفّ فودكس"}
            <input
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy}
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void upload(file);
              }}
            />
          </label>
        )}

        {error && (
          <p className="mt-3 rounded-lg border border-danger/40 bg-danger-bg px-3 py-2 text-xs leading-relaxed text-danger">
            {error}
          </p>
        )}
      </div>

      {result && (
        <div className="rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
          <p className={`text-sm font-bold ${STATUS_LABEL[result.status].tone}`}>
            {STATUS_LABEL[result.status].text}
          </p>
          {result.shape && SHAPE_LABEL[result.shape] && (
            <p className="mt-1 text-[11px] text-muted">{SHAPE_LABEL[result.shape]}</p>
          )}

          {result.periodStart && (
            <p className="nums mt-2 text-xs">
              الفترة المقروءة: {result.periodStart} → {result.periodEnd}
            </p>
          )}

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
            <Fact label="صفوفٌ في الملفّ" value={result.totals.rows} />
            <Fact label="قُرئت" value={result.totals.parsed} />
            <Fact label="لم تُقرأ" value={result.totals.errors} tone={result.totals.errors > 0 ? "text-danger" : undefined} />
            <Fact label="تُخطّيت" value={result.totals.skipped} />
            <Fact label="بيعاتٌ كُتبت" value={result.totals.salesWritten} />
            <Fact label="أُعيد بيانُها" value={result.totals.salesRestated} />
            <Fact label="أسطرُ بيع" value={result.totals.lineCount} />
            <Fact
              label="أصنافٌ جديدة تحتاج ربطاً"
              value={result.newPosProducts}
              tone={result.newPosProducts > 0 ? "text-warn" : undefined}
            />
          </dl>

          {result.messages.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {result.messages.map((m, i) => (
                <li key={i} className="rounded-lg border border-warn/40 bg-warn-bg px-3 py-2 text-[11px] leading-relaxed text-warn">
                  {m}
                </li>
              ))}
            </ul>
          )}

          {result.recognisedColumns.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-bold">
                الأعمدةُ التي فُهمت ({result.recognisedColumns.length})
              </summary>
              <ul className="mt-2 space-y-0.5 text-[11px] text-muted">
                {result.recognisedColumns.map((c) => <li key={c}>{c}</li>)}
              </ul>
              {result.unrecognisedColumns.length > 0 && (
                <>
                  <p className="mt-2 text-[11px] font-bold">ولم تُقرأ هذه الأعمدة:</p>
                  <p className="text-[11px] text-muted">{result.unrecognisedColumns.join(" · ")}</p>
                </>
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
    <div>
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className={`nums text-sm font-bold ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}
