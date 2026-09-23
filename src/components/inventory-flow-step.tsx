"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";
import { ReceiptForm } from "./inventory-receipt-form";
import { OpeningGrid } from "./inventory-opening-grid";
import type { StepRow } from "./inventory-count-steps";

/**
 * ‏٢ · ما الذي دخل وما الذي خرج؟
 *
 * المعادلةُ التي ستُحاسِب، مكتوبةً لكلّ صنفٍ **قبل** أن يُعَدّ الرفّ:
 *
 *   افتتاحيّ + مشتريات ± إضافات − استهلاكٌ متوقَّع − هدر = المتوقَّع
 *
 * ── وكلُّ مجهولٍ فيها معه فعلُه ──
 *
 * «الرصيد الافتتاحيّ غير معروف» بلا زرٍّ جملةٌ صادقةٌ لا تنفع — وكانت
 * الشاشةُ تقولها ثمّ تترك صاحبَها يبحث عن صفحة إعداداتٍ ليُصلحه. فصار
 * بجانب كلّ مجهولٍ فعلُه: **أدخل الرصيد** · **أدخل الكمّيّة المستلَمة**،
 * ويُفتَح المحرِّرُ في السطر نفسه، ويعود بعد الحفظ إلى الجرد.
 *
 * ── و«لا مشتريات» غيرُ «مشترياتٌ مجهولة» ──
 *
 * الأولى صفرٌ بدليل: قرأنا الفواتيرَ والاستلاماتِ كلَّها ولم نجد شيئاً.
 * والثانيةُ بندٌ لا تُعرَف كمّيّتُه أو استلامٌ لم يُحسَم أهو فاتورة.
 * وخلطُهما يجعل كلَّ ما دخل «فرقاً».
 */
export interface ReceiptRow {
  id: string;
  productId: string;
  receivedOn: string;
  quantityText: string;
  costMinor: number | null;
  supplierName: string | null;
  documentRef: string | null;
  linkedInvoiceNumber: string | null;
  confirmedSeparate: boolean;
}

export interface DuplicateRow {
  receiptId: string;
  productId: string;
  invoiceLineId: string;
  invoiceNumber: string;
  supplierName: string;
  effectiveDate: string;
  basis: "SAME_QUANTITY" | "UNKNOWN_QUANTITY";
}

type Editor = { productId: string; kind: "opening" | "receipt" } | null;

export function FlowStep({
  countId,
  branchId,
  periodStart,
  periodEnd,
  defaultReceiptDate,
  rows,
  categories,
  receipts,
  duplicates,
  suppliers,
  canEdit,
  onDone,
}: {
  countId: string;
  branchId: string | null;
  periodStart: string;
  periodEnd: string;
  defaultReceiptDate: string;
  rows: StepRow[];
  categories: { key: string; label: string }[];
  receipts: ReceiptRow[];
  duplicates: DuplicateRow[];
  suppliers: { id: string; name: string }[];
  canEdit: boolean;
  onDone: () => void;
}) {
  const [editor, setEditor] = useState<Editor>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [grid, setGrid] = useState(false);

  const receiptsBy = useMemo(() => group(receipts, (r) => r.productId), [receipts]);
  const duplicatesBy = useMemo(() => group(duplicates, (d) => d.productId), [duplicates]);

  const needs = (r: StepRow) => r.openingText === null || r.purchasesText === null;
  const missingOpening = rows.filter((r) => r.openingText === null).length;
  const missingPurchases = rows.filter((r) => r.purchasesText === null).length;

  const visible = rows.filter((r) => {
    if (category && r.category !== category) return false;
    if (onlyMissing && !needs(r)) return false;
    const q = query.trim().toLowerCase();
    return q === "" || r.productName.toLowerCase().includes(q);
  });

  return (
    <div>
      <p className="mb-3 rounded-xl border border-line bg-sunken px-3 py-2.5 text-[11px] leading-relaxed text-ink-soft">
        هذه المعادلة التي يُحسَب بها فرقُك:{" "}
        <strong>افتتاحيّ + مشتريات ± إضافات − استهلاكٌ متوقَّع − هدر = المتوقَّع على الرفّ</strong>.
        والاستهلاكُ من مبيعات الأسبوع بوصفاتها — بنسخة الوصفة السارية <strong>في تاريخ كلّ بيعة</strong>.
        وما لا يُعرَف يبقى «غير معروف» ولا يُحسَب صفراً — <strong>ولك أن تُدخله</strong> من سطره.
      </p>

      {(missingOpening > 0 || missingPurchases > 0) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-warn/40 bg-warn-bg px-3 py-2.5 text-[11px]">
          <span className="min-w-0 flex-1 leading-relaxed">
            {missingOpening > 0 && <><span className="nums font-bold">{missingOpening}</span> صنفاً رصيدُه الافتتاحيّ غير معروف. </>}
            {missingPurchases > 0 && <><span className="nums font-bold">{missingPurchases}</span> صنفاً كمّيّةُ مشترياته غير معروفة. </>}
            وبلا هذه لا يُحسَب لها فرق.
          </span>
          <button type="button" onClick={() => setOnlyMissing((v) => !v)} className={buttonClass("secondary", "sm")}>
            {onlyMissing ? "اعرض الكلّ" : "اعرض ما ينقصه شيء"}
          </button>
          {canEdit && missingOpening > 0 && (
            <button type="button" onClick={() => setGrid((v) => !v)} className={buttonClass("secondary", "sm")}>
              {grid ? "أغلِق" : "أدخل الأرصدة دفعةً واحدة"}
            </button>
          )}
        </div>
      )}

      {grid && canEdit && (
        <OpeningGrid countId={countId} rows={rows} categories={categories} onDone={() => setGrid(false)} />
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث عن صنف…" aria-label="ابحث عن صنف"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-raised px-3 text-sm"
        />
        <select
          value={category} onChange={(e) => setCategory(e.target.value)} aria-label="رشِّح بالباب"
          className="min-h-11 rounded-xl border border-line bg-raised px-3 text-xs"
        >
          <option value="">كلّ الأبواب</option>
          {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </div>

      <ul className="divide-y divide-line rounded-2xl border border-line bg-raised">
        {visible.map((row) => (
          <li key={row.productId} className="px-3 py-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="min-w-0 flex-1 truncate text-xs font-bold">{row.productName}</p>
              <p className="text-[11px] text-muted">بـ{row.unitLabel}</p>
            </div>

            <dl className="mt-1.5 grid grid-cols-1 gap-1 text-[11px] sm:grid-cols-[auto_1fr]">
              <dt className="text-muted">الرصيد الافتتاحيّ</dt>
              <dd className="flex flex-wrap items-center gap-2">
                {row.openingText === null ? (
                  <span className="text-warn">غير معروف</span>
                ) : (
                  <>
                    <span className="nums font-bold">{row.openingText}</span>
                    <span className="text-muted">— {row.openingSourceLabel}</span>
                  </>
                )}
                {canEdit && editor?.kind !== "opening" && (
                  <button
                    type="button"
                    onClick={() => setEditor({ productId: row.productId, kind: "opening" })}
                    className={buttonClass(row.openingText === null ? "primary" : "quiet", "sm")}
                  >
                    {row.openingText === null ? "أدخل الرصيد" : row.openingManual ? "عدِّله" : "استبدِله يدوياً"}
                  </button>
                )}
              </dd>

              <dt className="text-muted">+ المشتريات</dt>
              <dd className="flex flex-wrap items-center gap-2">
                {row.purchasesText === null ? (
                  <span className="text-warn">كمّيّة المشتريات غير معروفة</span>
                ) : row.purchasesZero ? (
                  <span>لا مشتريات</span>
                ) : (
                  <>
                    <span className="nums font-bold">{row.purchasesText}</span>
                    {row.manualReceiptsText !== null && (
                      <span className="text-muted">منها <span className="nums">{row.manualReceiptsText}</span> أُدخلت يدوياً</span>
                    )}
                  </>
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setEditor({ productId: row.productId, kind: "receipt" })}
                    className={buttonClass(row.purchasesText === null ? "primary" : "quiet", "sm")}
                  >
                    أدخل الكمّيّة المستلَمة
                  </button>
                )}
              </dd>

              {row.adjustmentsText !== null && (
                <>
                  <dt className="text-muted">± إضافات</dt>
                  <dd className="nums">{row.adjustmentsText}</dd>
                </>
              )}

              <dt className="text-muted">− الاستهلاك المتوقَّع</dt>
              <dd>
                {row.consumptionText === null
                  ? <span className="text-warn">غير معروف — لا وصفةَ تصل إليه</span>
                  : <span className="nums font-bold">{row.consumptionText}</span>}
                <span className="text-muted"> من المبيعات</span>
              </dd>

              {row.wasteText !== null && (
                <>
                  <dt className="text-muted">− هدرٌ مسجَّل</dt>
                  <dd className="nums">{row.wasteText}</dd>
                </>
              )}

              <dt className="font-bold">= يُتوقَّع على الرفّ</dt>
              <dd>
                {row.expected === null
                  ? <span className="text-warn">غير معروف — حدٌّ في المعادلة مجهول</span>
                  : <span className="nums font-bold">{row.expected}</span>}
              </dd>
            </dl>

            {(receiptsBy.get(row.productId) ?? []).length > 0 && (
              <ReceiptList receipts={receiptsBy.get(row.productId)!} canEdit={canEdit} />
            )}

            {(duplicatesBy.get(row.productId) ?? []).length > 0 && (
              <DuplicateQuestion duplicates={duplicatesBy.get(row.productId)!} canEdit={canEdit} />
            )}

            {editor?.productId === row.productId && editor.kind === "opening" && (
              <OpeningEditor countId={countId} row={row} onDone={() => setEditor(null)} />
            )}
            {editor?.productId === row.productId && editor.kind === "receipt" && (
              <ReceiptForm
                productId={row.productId}
                productName={row.productName}
                branchId={branchId}
                unitChoices={row.unitChoices}
                defaultUnit={row.unitChoices[row.unitChoices.length - 1]?.value ?? row.baseUnit}
                defaultDate={defaultReceiptDate}
                periodStart={periodStart}
                periodEnd={periodEnd}
                suppliers={suppliers}
                onDone={() => setEditor(null)}
              />
            )}
          </li>
        ))}
      </ul>

      {visible.length === 0 && (
        <p className="rounded-2xl border border-dashed border-line px-5 py-10 text-center text-sm text-muted">
          {onlyMissing ? "لا صنفَ ينقصه شيء — المعادلةُ معروفةُ الحدود كلُّها." : "لا صنفَ يطابق هذا الترشيح."}
        </p>
      )}

      <div className="mt-4">
        <button type="button" onClick={onDone} className={buttonClass("primary")}>
          تابِع — أدخِل ما وجدتَه
        </button>
      </div>
    </div>
  );
}

/* ─────────────── محرِّرُ الرصيد الافتتاحيّ في سطره ─────────────── */

function OpeningEditor({ countId, row, onDone }: { countId: string; row: StepRow; onDone: () => void }) {
  const router = useRouter();
  const [value, setValue] = useState(row.openingManual && row.openingEntered ? row.openingEntered : "");
  const [unit, setUnit] = useState(
    row.openingManual && row.openingEnteredUnit ? row.openingEnteredUnit : row.unitChoices[row.unitChoices.length - 1]?.value ?? row.baseUnit,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(quantity: string | null) {
    setBusy(true);
    setError(null);
    const r = await postJson("/api/inventory/count", {
      action: "opening", countId, entries: [{ productId: row.productId, quantity, unit }],
    });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    router.refresh();
    onDone();
  }

  return (
    <div className="mt-2 rounded-xl border border-line bg-canvas p-3">
      <p className="text-[11px] font-bold">ما كان على الرفّ أوّلَ الأسبوع — {row.productName}</p>
      {row.openingText !== null && !row.openingManual && (
        <p className="mt-1 text-[11px] text-muted">
          الحاليّ {row.openingText} {row.openingSourceLabel} — وما تُدخله يغلبه صراحةً ويُكتَب مصدرُه «يدويّ».
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-muted">
          الرصيد
          <input
            type="text" inputMode="decimal" dir="ltr" autoFocus value={value}
            onChange={(e) => setValue(e.target.value)} disabled={busy} placeholder="5.2"
            className="nums mt-1 block min-h-11 w-24 rounded-xl border border-line bg-raised px-2 text-center text-sm"
          />
        </label>
        <label className="text-[11px] text-muted">
          الوحدة
          <select
            value={unit} onChange={(e) => setUnit(e.target.value)} disabled={busy || row.unitChoices.length < 2}
            className="mt-1 block min-h-11 rounded-xl border border-line bg-raised px-2 text-xs"
          >
            {row.unitChoices.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </label>
        <button type="button" disabled={busy || value.trim() === ""} onClick={() => void save(value.trim())} className={buttonClass("primary", "sm")}>
          {busy ? "يُحفظ…" : "احفظ الرصيد"}
        </button>
        {row.openingManual && (
          <button type="button" disabled={busy} onClick={() => void save(null)} className={buttonClass("secondary", "sm")}>
            أفرِغه — يعود كما كان
          </button>
        )}
        <button type="button" disabled={busy} onClick={onDone} className={buttonClass("quiet", "sm")}>تراجع</button>
      </div>
      {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}
    </div>
  );
}

/* ─────────────── الاستلاماتُ المقيَّدة لهذا الصنف ─────────────── */

function ReceiptList({ receipts, canEdit }: { receipts: ReceiptRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function voidIt(id: string) {
    setBusy(true);
    setError(null);
    const r = await postJson("/api/inventory/receipt", { action: "void", receiptId: id, reason });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setVoiding(null);
    setReason("");
    router.refresh();
  }

  return (
    <ul className="mt-2 space-y-1 rounded-lg bg-sunken px-3 py-2 text-[11px]">
      {receipts.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="nums">{r.receivedOn}</span>
          <span className="nums font-bold">{r.quantityText}</span>
          <span className="text-muted">
            أُدخلت يدوياً
            {r.supplierName && ` · ${r.supplierName}`}
            {r.documentRef && ` · ${r.documentRef}`}
            {r.linkedInvoiceNumber && ` · هي فاتورة ${r.linkedInvoiceNumber}`}
            {r.confirmedSeparate && " · شحنةٌ منفصلة"}
          </span>
          {canEdit && voiding !== r.id && (
            <button type="button" onClick={() => setVoiding(r.id)} className={buttonClass("quiet", "sm")}>ألغِها</button>
          )}
          {voiding === r.id && (
            <span className="flex w-full flex-wrap items-center gap-2">
              <input
                type="text" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
                placeholder="سببُ الإلغاء" aria-label="سببُ الإلغاء"
                className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-raised px-2 text-sm"
              />
              <button
                type="button" disabled={busy || reason.trim().length < 3}
                onClick={() => void voidIt(r.id)} className={buttonClass("danger", "sm")}
              >
                ألغِها — وتبقى في السجلّ
              </button>
              <button type="button" onClick={() => setVoiding(null)} className={buttonClass("quiet", "sm")}>تراجع</button>
            </span>
          )}
        </li>
      ))}
      {error && <li className="text-danger">{error}</li>}
    </ul>
  );
}

/* ─────── استلامٌ قد يكون هو الفاتورة التي وصلت بعده ─────── */

function DuplicateQuestion({ duplicates, canEdit }: { duplicates: DuplicateRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(receiptId: string, resolution: { kind: "LINK"; invoiceLineId: string } | { kind: "SEPARATE" }) {
    setBusy(true);
    setError(null);
    const r = await postJson("/api/inventory/receipt", { action: "resolve", receiptId, resolution });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    router.refresh();
  }

  return (
    <div className="mt-2 rounded-lg border border-warn/40 bg-warn-bg p-3 text-[11px]">
      <p className="font-bold text-warn">
        كمّيّةٌ أدخلتَها يدوياً قد تكون هي نفسَ بندِ فاتورةٍ وصلت — فالمشترياتُ غير معروفة حتى تختار.
      </p>
      <ul className="mt-2 space-y-1.5">
        {duplicates.map((d) => (
          <li key={`${d.receiptId}:${d.invoiceLineId}`} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1">
              {d.supplierName} · {d.invoiceNumber} · <span className="nums">{d.effectiveDate}</span>
              <span className="text-muted">{d.basis === "SAME_QUANTITY" ? " — بالكمّيّة نفسِها" : " — كمّيّتُها غير معروفة"}</span>
            </span>
            {canEdit && (
              <>
                <button type="button" disabled={busy} onClick={() => void resolve(d.receiptId, { kind: "LINK", invoiceLineId: d.invoiceLineId })} className={buttonClass("primary", "sm")}>
                  هي هذه — اربطهما
                </button>
                <button type="button" disabled={busy} onClick={() => void resolve(d.receiptId, { kind: "SEPARATE" })} className={buttonClass("secondary", "sm")}>
                  شحنتان مختلفتان
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-danger">{error}</p>}
    </div>
  );
}

function group<T>(items: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = out.get(k);
    if (list) list.push(it);
    else out.set(k, [it]);
  }
  return out;
}
