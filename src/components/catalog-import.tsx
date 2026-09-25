"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { request } from "@/lib/http-client";
import Link from "next/link";
import { ArrowLeft, CircleAlert, CircleCheck, Eye, FileSpreadsheet, Files, Loader2 } from "lucide-react";
import { buttonClass } from "./ui";

/**
 * رفعُ كتالوج فودكس — ثلاثةُ ملفّاتٍ معاً، ومعاينةٌ قبل الكتابة.
 *
 * ── ولماذا معاً ──
 *
 * الوصفةُ تربط صنفاً مباعاً بصنفِ مخزون. فلو رُفع ملفُّ الوصفات وحدَه
 * لسقط كلُّ سطرٍ فيه بحجّة «مكوّنُه ليس عندنا» — ‏١٤٢ سطراً تُردّ
 * لسببٍ ليس فيها.
 *
 * ── والمعاينةُ ليست زينة ──
 *
 * الاستيرادُ يكتب وصفاتٍ تُحسَب بها كلفةُ الفرق، ويربط أصنافاً بأسمائها.
 * فيُعرَض ما سيقع **قبل أن يقع**: كم صنفاً يُنشأ، وكم يُحدَّث، وأيُّها
 * رُبط باسمه — وذاك بالتحديد ما يحتاج عينَ إنسان.
 */
interface Change {
  sku: string;
  name: string;
  action: "CREATED" | "UPDATED" | "LINKED_BY_NAME" | "SKIPPED";
  detail?: string;
}

interface CatalogResult {
  dryRun: boolean;
  files: {
    fileName: string;
    kind: string | null;
    label: string;
    rows: number;
    issues: { row: number; reason: string; detail: string }[];
    warnings: string[];
  }[];
  stockItems: { created: number; updated: number; linkedByName: number };
  menuProducts: { created: number; updated: number; linkedByName: number };
  recipes: { written: number; skippedHuman: number; unchanged: number; blocked: number };
  changes: Change[];
  blocked: { productSku: string; name: string; reason: string }[];
  effectiveFrom: string;
}

export function CatalogImport({ canEdit, defaultFrom }: { canEdit: boolean; defaultFrom: string }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [effectiveFrom, setEffectiveFrom] = useState(defaultFrom);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CatalogResult | null>(null);

  async function send(dryRun: boolean) {
    setBusy(dryRun ? "preview" : "commit");
    setError(null);

    const form = new FormData();
    for (const f of files) form.append("files", f);
    form.append("effectiveFrom", effectiveFrom);
    if (dryRun) form.append("dryRun", "true");

    const r = await request<CatalogResult>("/api/inventory/catalog", { method: "POST", body: form });
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    setResult(r.data);
    if (!dryRun) { setFiles([]); router.refresh(); }
  }

  if (!canEdit) {
    return (
      <p className="rounded-xl border border-dashed border-line px-5 py-6 text-center text-xs text-muted">
        رفعُ الكتالوج يكتب وصفاتٍ تُحسَب بها الكلفة — وهو خارج صلاحيتك.
      </p>
    );
  }

  const committed = result !== null && !result.dryRun;
  const stage = committed ? 3 : result?.dryRun ? 2 : 1;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-raised shadow-raised">
        {/* ── ثلاثُ مراحل ظاهرة: اختر ← عاين ← نفِّذ ── */}
        <ol className="flex border-b border-line text-[11px] font-bold" aria-label="مراحل رفع الكتالوج">
          {["اختر الملفّات", "عاين ما سيقع", "نفِّذ"].map((label, i) => (
            <li
              key={label}
              aria-current={stage === i + 1 ? "step" : undefined}
              className={`flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 ${stage === i + 1 ? "text-accent" : stage > i + 1 ? "text-ok" : "text-muted"}`}
            >
              <span className={`nums grid h-5 w-5 place-items-center rounded-full text-[10px] ${stage === i + 1 ? "bg-accent text-accent-ink" : stage > i + 1 ? "bg-ok text-raised" : "bg-sunken"}`}>
                {stage > i + 1 ? "✓" : i + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>

        <div className="p-4 sm:p-5">
          <label className="group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-input bg-sunken/40 px-5 py-7 text-center transition-colors hover:border-accent hover:bg-accent-soft/40 focus-within:border-accent">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent">
              <Files className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            </span>
            <span className="text-sm font-bold">{files.length > 0 ? "غيّر الملفّات" : "اختر ملفّات الكتالوج الثلاثة معاً"}</span>
            <span className="max-w-md text-xs leading-relaxed text-muted">
              أصنافُ المخزون، والأصنافُ المباعة، والوصفات — تُرفع معاً لأنّ الوصفة تربط الاثنين. ويُعرَف كلُّ ملفٍّ بأعمدته لا باسمه.
            </span>
            <input
              type="file" multiple accept=".csv,.xlsx,.xls,text/csv"
              className="sr-only"
              onChange={(e) => {
                setFiles(Array.from(e.target.files ?? []).slice(0, 3));
                e.target.value = "";
                setResult(null);
                setError(null);
              }}
            />
          </label>

          {files.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {files.map((f) => {
                const read = result?.files.find((x) => x.fileName === f.name);
                return (
                  <li key={f.name} className="flex min-h-9 items-center gap-2 rounded-lg border border-line bg-raised px-2.5 py-1 text-xs">
                    <FileSpreadsheet className={`h-3.5 w-3.5 shrink-0 ${read ? (read.kind ? "text-ok" : "text-danger") : "text-muted"}`} strokeWidth={2} aria-hidden />
                    <span className="max-w-56 truncate font-medium" dir="auto">{f.name}</span>
                    {read && <span className={read.kind ? "text-ok" : "text-danger"}>{read.kind ? read.label : "لم تُفهَم أعمدتُه"}</span>}
                  </li>
                );
              })}
              {files.length < 3 && (
                <li className="flex items-center text-[11px] text-warn">
                  {files.length === 1 ? "ملفٌّ واحد" : "ملفّان"} من ثلاثة — الوصفاتُ تحتاج الثلاثة.
                </li>
              )}
            </ul>
          )}

          <label className="mt-4 block">
            <span className="block text-[11px] font-medium text-muted">
              تسري الوصفاتُ الجديدة من — أوّلُ أسبوعٍ قادم، فما مضى حُسب بوصفاته
            </span>
            <input
              type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)}
              className="nums mt-1 min-h-11 rounded-lg border border-line-input bg-raised px-3 text-sm"
            />
          </label>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void send(true)}
              disabled={busy !== null || files.length === 0}
              /* بعد المعاينة الفعلُ التالي هو التنفيذ — فلا زرّان رئيسيّان متجاوران */
              className={buttonClass(result?.dryRun ? "secondary" : "primary")}
            >
              {busy === "preview" ? <><Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden />يُحسَب…</> : result?.dryRun ? "أعد المعاينة" : "اعرض ما سيقع"}
            </button>
            {result?.dryRun && (
              <button
                type="button"
                onClick={() => void send(false)}
                disabled={busy !== null}
                className={buttonClass("primary")}
              >
                {busy === "commit" ? <><Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden />يُكتَب…</> : "نفِّذ الاستيراد"}
              </button>
            )}
            {files.length === 0 && !committed && <span className="text-[11px] text-muted">لا يُكتب شيءٌ قبل أن ترى ما سيقع.</span>}
          </div>

          {error && (
            <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-bg px-3 py-2.5 text-xs leading-relaxed text-danger">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              <span>{error} — لم يُكتب شيء.</span>
            </p>
          )}
        </div>
      </div>

      {result && <CatalogOutcome result={result} />}
    </div>
  );
}

function CatalogOutcome({ result }: { result: CatalogResult }) {
  const linked = result.changes.filter((c) => c.action === "LINKED_BY_NAME");
  const skipped = result.changes.filter((c) => c.action === "SKIPPED");

  return (
    <div className={`animate-rise rounded-2xl border bg-raised p-4 shadow-raised sm:p-5 ${result.dryRun ? "border-accent-line" : "border-ok/30"}`}>
      <div className="flex flex-wrap items-start gap-3">
        {result.dryRun
          ? <Eye className="mt-0.5 h-5 w-5 shrink-0 text-accent" strokeWidth={2} aria-hidden />
          : <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-ok" strokeWidth={2} aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className={`text-[15px] font-bold ${result.dryRun ? "text-accent" : "text-ok"}`}>
            {result.dryRun ? "معاينة — لم يُكتب شيءٌ بعد" : "استُورد الكتالوج"}
          </p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-muted">
            {result.files.map((f) => (
              <li key={f.fileName} dir="auto">
                {f.fileName} — {f.kind === null ? "لم تُفهَم أعمدتُه" : `${f.label}، ${f.rows} صفّاً`}
              </li>
            ))}
          </ul>
        </div>
        {!result.dryRun && (
          <Link href="/inventory/import#sales" className={buttonClass("primary", "sm")}>
            التالي: ارفع المبيعات <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          </Link>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label="أصنافُ مخزونٍ جديدة" value={result.stockItems.created} />
        <Fact label="حُدِّثت" value={result.stockItems.updated} />
        <Fact label="أصنافٌ مباعةٌ جديدة" value={result.menuProducts.created} />
        <Fact label="حُدِّثت" value={result.menuProducts.updated} />
        <Fact label="وصفاتٌ كُتبت" value={result.recipes.written} />
        <Fact label="لم تتغيّر" value={result.recipes.unchanged} />
        <Fact label="بيدِ إنسان — لم تُمَسّ" value={result.recipes.skippedHuman} />
        <Fact
          label="تعذّرت"
          value={result.recipes.blocked}
          tone={result.recipes.blocked > 0 ? "text-danger" : undefined}
        />
      </dl>

      {linked.length > 0 && (
        <div className="mt-3 rounded-lg border border-warn/25 bg-warn-bg px-3 py-2">
          <p className="text-[11px] font-bold text-warn">
            رُبطت بأصنافٍ قائمةٍ بالاسم نفسِه ({linked.length}) — راجِعها
          </p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-warn">
            {linked.map((c) => <li key={c.sku}>{c.name}</li>)}
          </ul>
        </div>
      )}

      {skipped.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-bold">
            وصفاتٌ مكتوبةٌ بيدِ إنسان، لم يُكتَب فوقها ({skipped.length})
          </summary>
          <ul className="mt-2 space-y-0.5 text-[11px] text-muted">
            {skipped.map((c) => <li key={c.sku}>{c.name}</li>)}
          </ul>
        </details>
      )}

      {result.blocked.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {result.blocked.map((b) => (
            <li key={b.productSku} className="rounded-lg border border-danger/25 bg-danger-bg px-3 py-2 text-[11px] leading-relaxed text-danger">
              <span className="font-bold">{b.name || b.productSku}</span> — {b.reason}
            </li>
          ))}
        </ul>
      )}

      {result.files.some((f) => f.issues.length > 0) && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-bold">
            صفوفٌ لم تُقرأ ({result.files.reduce((s, f) => s + f.issues.length, 0)})
          </summary>
          <ul className="mt-2 space-y-1 text-[11px] text-muted">
            {result.files.flatMap((f) => f.issues.map((i) => (
              <li key={`${f.fileName}-${i.row}`}>
                <span className="nums">{f.fileName}:{i.row}</span> — {i.reason}: {i.detail}
              </li>
            )))}
          </ul>
        </details>
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
