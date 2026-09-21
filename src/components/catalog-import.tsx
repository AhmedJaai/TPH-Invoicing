"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { request } from "@/lib/http-client";
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

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
        <h3 className="font-display text-base font-bold">ارفع كتالوج فودكس</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          ثلاثةُ ملفّاتٍ من فودكس: أصنافُ المخزون، والأصنافُ المباعة، والوصفات — ارفعها
          معاً، فالوصفةُ تربط الاثنين. ويُعرَف كلُّ ملفٍّ بأعمدته لا باسمه.
        </p>

        <label className="mt-3 block">
          <span className="block text-[11px] text-muted">
            تبدأ الوصفاتُ المستورَدة من هذا اليوم — واختر أوّلَ أسبوعٍ قادم، فما مضى
            حُسب بوصفاته
          </span>
          <input
            type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)}
            aria-label="تاريخ بدء سريان الوصفات"
            className="nums mt-1 min-h-11 rounded-xl border border-line bg-canvas px-3 text-sm"
          />
        </label>

        {canEdit && (
          <>
            <label className={`${buttonClass("secondary")} mt-4 cursor-pointer`}>
              اختر الملفّات
              <input
                type="file" multiple accept=".csv,.xlsx,.xls,text/csv"
                className="sr-only"
                onChange={(e) => {
                  setFiles(Array.from(e.target.files ?? []).slice(0, 3));
                  e.target.value = "";
                  setResult(null);
                }}
              />
            </label>

            {files.length > 0 && (
              <ul className="mt-3 space-y-1 text-[11px] text-muted">
                {files.map((f) => <li key={f.name}>{f.name}</li>)}
              </ul>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void send(true)}
                disabled={busy !== null || files.length === 0}
                className={buttonClass("primary")}
              >
                {busy === "preview" ? "يُحسَب…" : "اعرض ما سيقع"}
              </button>
              {result?.dryRun && (
                <button
                  type="button"
                  onClick={() => void send(false)}
                  disabled={busy !== null}
                  className={buttonClass("primary")}
                >
                  {busy === "commit" ? "يُكتَب…" : "نفِّذ الاستيراد"}
                </button>
              )}
            </div>
          </>
        )}

        {error && (
          <p className="mt-3 rounded-lg border border-danger/40 bg-danger-bg px-3 py-2 text-xs leading-relaxed text-danger">
            {error}
          </p>
        )}
      </div>

      {result && <CatalogOutcome result={result} />}
    </div>
  );
}

function CatalogOutcome({ result }: { result: CatalogResult }) {
  const linked = result.changes.filter((c) => c.action === "LINKED_BY_NAME");
  const skipped = result.changes.filter((c) => c.action === "SKIPPED");

  return (
    <div className="rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
      <p className={`text-sm font-bold ${result.dryRun ? "text-warn" : "text-ok"}`}>
        {result.dryRun ? "معاينة — لم يُكتب شيءٌ بعد" : "استُورد الكتالوج"}
      </p>

      <ul className="mt-2 space-y-0.5 text-[11px] text-muted">
        {result.files.map((f) => (
          <li key={f.fileName}>
            {f.fileName} — {f.kind === null ? "لم تُفهَم أعمدتُه" : `${f.label}، ${f.rows} صفّاً`}
          </li>
        ))}
      </ul>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
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
        <div className="mt-3 rounded-lg border border-warn/40 bg-warn-bg px-3 py-2">
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
            <li key={b.productSku} className="rounded-lg border border-danger/40 bg-danger-bg px-3 py-2 text-[11px] leading-relaxed text-danger">
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
    <div>
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className={`nums text-sm font-bold ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}
