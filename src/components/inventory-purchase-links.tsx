"use client";

import { useMemo, useState, Fragment } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Link2, Sparkles } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { sameUnitFamily } from "@/lib/inventory/units";
import { STORED_UNITS, isStoredUnit, storedUnitLabel, type StoredUnit } from "@/lib/unit-conversion";
import { ITEM, PRODUCT, countNoun } from "@/lib/arabic";
import { ReadySubmit } from "./ui-client";
import { buttonClass } from "./ui";
import type { PurchaseLinkRow, StockItemOption } from "@/services/inventory-purchase-link.service";
import { T } from "@/components/i18n/t";

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
              ? <><T s="{0} من فواتير الأسبوع لا يدخل في الجرد" a={[countNoun(open.length, PRODUCT)]} /></>
              : <>كل ما في فواتير الأسبوع يدخل في الجرد</>}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            اسم الصنف في الفاتورة غير اسمه في الوصفة. اربط كل بند بصنف الجرد، وحدّد الكمية في الوحدة الواحدة منه. يكفي ذلك مرة واحدة، ويُحسب في كل جرد بعده.
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
            <T s="{0}ما رُبط ودخل في الجرد ({1})" a={[<ChevronDown key="0" className={`h-3.5 w-3.5 transition-transform duration-200 ${showLinked ? "rotate-180" : ""}`} aria-hidden />, linked.length]} /></button>
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

export function LinkRow({ row, options, canEdit, onSaved }: {
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
    /* Enter مرّتين أو والحقولُ ناقصة: لا طلبَ ثانياً ولا ناقصاً */
    if (busy || !product || !unitOk || contentQuantity.trim() === "" || packSize.trim() === "") return;
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
          <T s="الكمية {0} · {1}{2}" a={[<span key="0" className="nums">{row.qtyText}</span>, countNoun(row.lines, ITEM), row.invoiceNumbers.length > 0 && <Fragment key="2"> · <span dir="ltr" className="nums">{row.invoiceNumbers.join("، ")}</span></Fragment>]} /></p>
      </div>

      {isLinked ? (
        <p className="mt-1 text-xs text-ink-soft">
          ← <span className="font-medium text-ink">{row.productName}</span>
          {row.pack && <> <T s=" · في الوحدة الواحدة {0} {1}" a={[<span key="0" className="nums">{row.pack.packSize} × {row.pack.contentQuantity}</span>, storedUnitLabel(row.pack.contentUnit)]} /></>}
          {row.countedText && <> <T s=" · دخل في الجرد {0}" a={[<span key="0" className="nums font-medium text-ink">{row.countedText}</span>]} /></>}
          {canEdit && !editing && (
            <button type="button" onClick={() => setEditing(true)} className="ms-2 text-xs font-medium text-accent hover:underline">
              غيّر
            </button>
          )}
        </p>
      ) : (
        <p className="mt-1 text-xs text-warn">
          {row.productName && <><T s="مربوط بـ«{0}»، " a={[row.productName]} /></>}
          {row.statusLabel}
        </p>
      )}

      {showForm && (
        /* نموذجٌ حقيقيّ: Enter في حقل العبوة يربط */
        <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="mt-2 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 basis-56 text-[11px] text-muted">
            <T s="صنف الجرد{0}" a={[<select key="0"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              disabled={busy}
              className="mt-1 block min-h-11 w-full rounded-lg border border-line-input bg-raised px-2 text-xs"
            >
              <option value="">— اختر —</option>
              {ordered.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nameAr}{o.id === suggested?.id && o.id !== row.productId ? " · مقترح" : ""}
                </option>
              ))}
            </select>]} /></label>
          <label className="text-[11px] text-muted">
            <T s="عدد العبوات في الوحدة{0}" a={[<input key="0"
              type="text" inputMode="decimal" dir="ltr"
              value={packSize} onChange={(e) => setPackSize(e.target.value)} disabled={busy}
              className="nums mt-1 block min-h-11 w-16 rounded-lg border border-line-input bg-raised px-2 text-center text-sm"
            />]} /></label>
          <span className="pb-3 text-xs text-muted" aria-hidden>×</span>
          <label className="text-[11px] text-muted">
            <T s="في العبوة{0}" a={[<input key="0"
              type="text" inputMode="decimal" dir="ltr"
              value={contentQuantity} onChange={(e) => setContentQuantity(e.target.value)} disabled={busy}
              placeholder="1"
              className="nums mt-1 block min-h-11 w-20 rounded-lg border border-line-input bg-raised px-2 text-center text-sm"
            />]} /></label>
          <label className="text-[11px] text-muted">
            <T s="الوحدة{0}" a={[<select key="0"
              value={contentUnit}
              onChange={(e) => setContentUnit(isStoredUnit(e.target.value) ? e.target.value : "")}
              disabled={busy}
              className="mt-1 block min-h-11 rounded-lg border border-line-input bg-raised px-2 text-xs"
            >
              <option value="">—</option>
              {unitChoices.map((u) => <option key={u} value={u}>{storedUnitLabel(u)}</option>)}
            </select>]} /></label>
          <ReadySubmit
            ready={Boolean(product) && unitOk && contentQuantity.trim() !== "" && packSize.trim() !== ""}
            busy={busy}
            size="sm"
            missing={!product ? "اختر صنف المخزون الذي يقابله هذا البند." : packSize.trim() === "" ? "اكتب عدد العبوات في البند." : contentQuantity.trim() === "" ? "اكتب ما في العبوة الواحدة." : "اختر وحدة تناسب الصنف."}
          >
            <span>اربط</span>
          </ReadySubmit>
          {isLinked && (
            <button type="button" onClick={() => setEditing(false)} disabled={busy} className={buttonClass("quiet", "sm")}>
              إلغاء
            </button>
          )}
        </form>
      )}

      {showForm && (row.guessedPack || (suggested && !row.productId)) && (
        <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted">
          <T s="{0}هذا اقتراح من اسم البند، فتأكد منه قبل الربط." a={[<Sparkles key="0" className="h-3 w-3" aria-hidden />]} /></p>
      )}
      {product && contentUnit !== "" && !unitOk && (
        <p className="mt-1 text-[11px] text-warn">
          <T s="«{0}» يُقاس بوحدة {1}، فاختر وحدة من النوع نفسه." a={[product.nameAr, storedUnitLabel(product.baseUnit)]} /></p>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
