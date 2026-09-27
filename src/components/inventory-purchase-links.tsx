"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Link2, Sparkles } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { sameUnitFamily } from "@/lib/inventory/units";
import { STORED_UNITS, isStoredUnit, storedUnitLabel, type StoredUnit } from "@/lib/unit-conversion";
import { PRODUCT, countNoun } from "@/lib/arabic";
import { buttonClass } from "./ui";
import type { PurchaseLinkRow, StockItemOption } from "@/services/inventory-purchase-link.service";

/**
 * بنودُ فواتير الأسبوع التي لا يدخل منها شيءٌ الجردَ — ومعها فعلُها.
 *
 * كانت «مشترياتٌ غير معروفة» تُحيل إلى «الأصناف والعبوات» في قسمٍ آخر، ثمّ
 * لا تجد هناك موضعاً يكتب «ما في الوحدة». فصار الربطُ هنا: صنفُ المورّد كما
 * في الفاتورة ← صنفُ الجرد، وكم في الوحدة الواحدة. يُقترح الصنفُ من الاسم
 * والعبوةُ من نصّ البند، **ولا يُحفَظ شيءٌ إلّا بضغطة** — والربطُ يبقى
 * لصنف المورّد فلا يُسأل عنه في الأسبوع القادم.
 */
export function PurchaseLinkPanel({
  rows,
  options,
  canEdit,
}: {
  rows: PurchaseLinkRow[];
  options: StockItemOption[];
  canEdit: boolean;
}) {
  const open = rows.filter((r) => r.status !== "LINKED");
  const linked = rows.filter((r) => r.status === "LINKED");
  const [showLinked, setShowLinked] = useState(false);
  /* السطرُ ينتقل بعد الحفظ إلى «ما رُبط» فيُعاد بناؤه — فالتأكيدُ هنا لا فيه */
  const [saved, setSaved] = useState<string | null>(null);
  if (rows.length === 0) return null;

  return (
    <section className="mb-6 rounded-2xl border border-line bg-raised p-4 sm:p-5" aria-labelledby="purchase-links-title">
      <div className="flex flex-wrap items-start gap-3">
        <Link2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-accent" strokeWidth={2} aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 id="purchase-links-title" className="text-sm font-bold">
            {open.length > 0
              ? <>{countNoun(open.length, PRODUCT)} من فواتير الأسبوع لا يدخل الجرد</>
              : <>كلُّ ما في فواتير الأسبوع يدخل الجرد</>}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            اسمُ الصنف في الفاتورة غيرُ اسمه في الوصفة. اربط كلَّ بندٍ بصنف الجرد وقل كم في الوحدة الواحدة منه —
            مرّةً واحدة، ويُحسَب في كلّ جردٍ بعدها.
          </p>
          {saved && <p role="status" className="mt-2 text-xs font-medium text-ok">{saved}</p>}
        </div>
      </div>

      {open.length > 0 && (
        <ul className="mt-4 divide-y divide-line">
          {open.map((r) => (
            <li key={r.supplierProductId} className="py-3">
              <LinkRow row={r} options={options} canEdit={canEdit} onSaved={setSaved} />
            </li>
          ))}
        </ul>
      )}

      {linked.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowLinked((v) => !v)}
            aria-expanded={showLinked}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${showLinked ? "rotate-180" : ""}`} aria-hidden />
            ما رُبط ودخل الجرد ({linked.length})
          </button>
          {showLinked && (
            <ul className="mt-2 divide-y divide-line">
              {linked.map((r) => (
                <li key={r.supplierProductId} className="py-3">
                  <LinkRow row={r} options={options} canEdit={canEdit} onSaved={setSaved} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function LinkRow({ row, options, canEdit, onSaved }: {
  row: PurchaseLinkRow;
  options: StockItemOption[];
  canEdit: boolean;
  onSaved: (message: string) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const start = row.pack ?? row.guessedPack;
  const [productId, setProductId] = useState(row.productId ?? row.suggestedProductId ?? "");
  const [packSize, setPackSize] = useState(start?.packSize ?? "1");
  const [contentQuantity, setContentQuantity] = useState(start?.contentQuantity ?? "");
  const [contentUnit, setContentUnit] = useState<StoredUnit | "">(start?.contentUnit ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const product = options.find((o) => o.id === productId) ?? null;
  const unitChoices = useMemo(
    () => (product ? STORED_UNITS.filter((u) => sameUnitFamily(u, product.baseUnit)) : STORED_UNITS),
    [product],
  );
  const unitOk = contentUnit !== "" && (!product || sameUnitFamily(contentUnit, product.baseUnit));
  const suggested = row.suggestedProductId ? options.find((o) => o.id === row.suggestedProductId) : undefined;
  const ordered = suggested ? [suggested, ...options.filter((o) => o.id !== suggested.id)] : options;

  async function save() {
    if (!product || !unitOk) return;
    setBusy(true);
    setError(null);
    const r = await postJson<{ message?: string }>("/api/inventory/purchase-link", {
      supplierProductId: row.supplierProductId,
      productId: product.id,
      packSize: packSize.trim(),
      contentQuantity: contentQuantity.trim(),
      contentUnit,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onSaved(`${row.displayName}: ${r.data.message ?? "حُفظ الربط"}`);
    setEditing(false);
    router.refresh();
  }

  const isLinked = row.status === "LINKED";
  const showForm = canEdit && (editing || !isLinked);

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-medium">{row.displayName}</span>
          <span className="text-muted"> · {row.supplierName}</span>
        </p>
        <p className="text-[11px] text-muted">
          الكمّيّة <span className="nums">{row.qtyText}</span> · {row.lines === 1 ? "بندٌ واحد" : <><span className="nums">{row.lines}</span> بنود</>}
          {row.invoiceNumbers.length > 0 && <> · <span dir="ltr" className="nums">{row.invoiceNumbers.join("، ")}</span></>}
        </p>
      </div>

      {isLinked ? (
        <p className="mt-1 text-xs text-ink-soft">
          ← <span className="font-medium text-ink">{row.productName}</span>
          {row.pack && <> · في الوحدة <span className="nums">{row.pack.packSize} × {row.pack.contentQuantity}</span> {storedUnitLabel(row.pack.contentUnit)}</>}
          {row.countedText && <> · دخل الجرد <span className="nums font-medium text-ink">{row.countedText}</span></>}
          {canEdit && !editing && (
            <button type="button" onClick={() => setEditing(true)} className="ms-2 text-xs font-medium text-accent hover:underline">
              غيّر
            </button>
          )}
        </p>
      ) : (
        <p className="mt-1 text-xs text-warn">
          {row.productName && <>مربوطٌ بـ«{row.productName}» — </>}
          {row.statusLabel}
        </p>
      )}

      {showForm && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 basis-56 text-[11px] text-muted">
            صنفُ الجرد
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              disabled={busy}
              className="mt-1 block min-h-11 w-full rounded-lg border border-line-input bg-raised px-2 text-xs"
            >
              <option value="">— اختر —</option>
              {ordered.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nameAr}{o.id === suggested?.id && o.id !== row.productId ? " · مقترَح" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-muted">
            عبوات في الوحدة
            <input
              type="text" inputMode="decimal" dir="ltr"
              value={packSize} onChange={(e) => setPackSize(e.target.value)} disabled={busy}
              className="nums mt-1 block min-h-11 w-16 rounded-lg border border-line-input bg-raised px-2 text-center text-sm"
            />
          </label>
          <span className="pb-3 text-xs text-muted" aria-hidden>×</span>
          <label className="text-[11px] text-muted">
            في العبوة
            <input
              type="text" inputMode="decimal" dir="ltr"
              value={contentQuantity} onChange={(e) => setContentQuantity(e.target.value)} disabled={busy}
              placeholder="1"
              className="nums mt-1 block min-h-11 w-20 rounded-lg border border-line-input bg-raised px-2 text-center text-sm"
            />
          </label>
          <label className="text-[11px] text-muted">
            الوحدة
            <select
              value={contentUnit}
              onChange={(e) => setContentUnit(isStoredUnit(e.target.value) ? e.target.value : "")}
              disabled={busy}
              className="mt-1 block min-h-11 rounded-lg border border-line-input bg-raised px-2 text-xs"
            >
              <option value="">—</option>
              {unitChoices.map((u) => <option key={u} value={u}>{storedUnitLabel(u)}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={save}
            disabled={busy || !product || !unitOk || contentQuantity.trim() === "" || packSize.trim() === ""}
            className={buttonClass("primary", "sm")}
          >
            {busy ? "يُحفَظ…" : "اربط"}
          </button>
          {isLinked && (
            <button type="button" onClick={() => setEditing(false)} disabled={busy} className={buttonClass("quiet", "sm")}>
              ألغِ
            </button>
          )}
        </div>
      )}

      {showForm && (row.guessedPack || (suggested && !row.productId)) && (
        <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted">
          <Sparkles className="h-3 w-3" aria-hidden />
          قُرئ المقترَحُ من اسم البند — تأكّد منه قبل الربط.
        </p>
      )}
      {product && contentUnit !== "" && !unitOk && (
        <p className="mt-1 text-[11px] text-warn">
          «{product.nameAr}» يُقاس بـ{storedUnitLabel(product.baseUnit)} — اختر وحدةً من عائلته.
        </p>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
