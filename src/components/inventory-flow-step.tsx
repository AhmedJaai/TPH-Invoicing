"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { Equal, TriangleAlert } from "lucide-react";
import { buttonClass } from "./ui";
import { ReceiptForm } from "./inventory-receipt-form";
import { OpeningGrid } from "./inventory-opening-grid";
import type { StepRow } from "./inventory-count-steps";
import { Toolbar } from "./inventory-toolbar";
import { PRODUCT, countNoun } from "@/lib/arabic";

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
      <div className="mb-4 max-w-3xl">
        <h2 className="text-base font-bold">المعادلةُ التي يُحسَب بها فرقُك</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">
          لكلّ صنف: ما كان على الرفّ، وما دخل، وما صُرف من المبيعات بنسخة الوصفة السارية <strong>في تاريخ كلّ بيعة</strong> —
          فيخرج ما يُتوقَّع أن تجده. وما لا يُعرَف يبقى «غير معروف» ولا يُحسَب صفراً، <strong>ولك أن تُدخله</strong> من موضعه.
        </p>
      </div>

      {(missingOpening > 0 || missingPurchases > 0) && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-warn/25 bg-warn-bg px-4 py-3">
          <TriangleAlert className="h-[18px] w-[18px] shrink-0 text-warn" strokeWidth={2} aria-hidden />
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink-soft">
            {missingOpening > 0 && <><span className="font-bold text-ink">{countNoun(missingOpening, PRODUCT)}</span> رصيدُه الافتتاحيّ غير معروف. </>}
            {missingPurchases > 0 && <><span className="font-bold text-ink">{countNoun(missingPurchases, PRODUCT)}</span> كمّيّةُ مشترياته غير معروفة. </>}
            وبلا هذه لا يُحسَب لها فرق.
          </p>
          <button type="button" onClick={() => setOnlyMissing((v) => !v)} className={buttonClass("secondary", "sm")}>
            {onlyMissing ? "اعرض الكلّ" : "اعرض ما ينقصه شيء"}
          </button>
          {canEdit && missingOpening > 0 && (
            <button type="button" onClick={() => setGrid((v) => !v)} className={buttonClass(grid ? "quiet" : "primary", "sm")}>
              {grid ? "أغلِق الجدول" : "أدخل الأرصدة دفعةً واحدة"}
            </button>
          )}
        </div>
      )}

      {grid && canEdit && (
        <OpeningGrid countId={countId} rows={rows} categories={categories} onDone={() => setGrid(false)} />
      )}

      <Toolbar query={query} setQuery={setQuery} category={category} setCategory={setCategory} categories={categories} />

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-5 py-10 text-center text-sm text-muted">
          {onlyMissing ? "لا صنفَ ينقصه شيء — المعادلةُ معروفةُ الحدود كلُّها." : "لا صنفَ يطابق هذا الترشيح."}
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((row) => (
            <li key={row.productId} className="rounded-xl border border-line bg-raised p-4 shadow-raised">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <p className="min-w-0 flex-1 truncate text-[14px] font-bold">
                  {row.productName}
                  <span className="ms-2 text-[11px] font-medium text-muted">{row.categoryLabel} · بـ{row.unitLabel}</span>
                </p>
                <p className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold ${row.expected === null ? "bg-warn-bg text-warn" : "bg-accent-soft text-accent"}`}>
                  <Equal className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                  يُتوقَّع على الرفّ:
                  <span className={row.expected === null ? "" : "nums"}>{row.expected ?? "غير معروف"}</span>
                </p>
              </div>

              {/* ── حدودُ المعادلة: كلُّ حدٍّ بقيمته ومصدرِه، والمجهولُ بفعله ── */}
              <dl className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
                <Term
                  op={null}
                  label="الرصيد الافتتاحيّ"
                  value={row.openingText}
                  source={row.openingText === null ? "لا جردَ سابقٌ ولا رصيدٌ مكتوب" : row.openingSourceLabel}
                  action={canEdit ? (
                    <button
                      type="button"
                      onClick={() => setEditor({ productId: row.productId, kind: "opening" })}
                      className={buttonClass(row.openingText === null ? "primary" : "quiet", "sm")}
                    >
                      {row.openingText === null ? "أدخل الرصيد" : row.openingManual ? "عدِّله" : "استبدِله يدوياً"}
                    </button>
                  ) : undefined}
                />
                <Term
                  op="+"
                  label="المشتريات"
                  value={row.purchasesText === null ? null : row.purchasesZero ? "لا مشتريات" : row.purchasesText}
                  plain={row.purchasesZero}
                  source={row.purchasesText === null
                    ? "بندٌ لم تُعرَف كمّيّتُه أو استلامٌ لم يُحسَم"
                    : row.manualReceiptsText !== null ? `منها ${row.manualReceiptsText} أُدخلت يدوياً` : "من الفواتير"}
                  action={canEdit ? (
                    <button
                      type="button"
                      onClick={() => setEditor({ productId: row.productId, kind: "receipt" })}
                      className={buttonClass(row.purchasesText === null ? "primary" : "quiet", "sm")}
                    >
                      أدخل كمّيّةً مستلَمة
                    </button>
                  ) : undefined}
                  extra={row.adjustmentsText !== null ? <>± إضافات <span className="nums">{row.adjustmentsText}</span></> : undefined}
                />
                <Term
                  op="−"
                  label="الاستهلاك المتوقَّع"
                  value={row.consumptionText}
                  source={row.consumptionText === null ? "لا وصفةَ تصل إليه" : "من المبيعات بوصفاتها"}
                  action={row.consumptionText === null ? (
                    /* المجهولُ هنا وصفةٌ غائبة — وموضعُ كتابتها الوصفات، بلا بحثٍ عنه */
                    <Link href="/inventory/recipes" className={buttonClass("secondary", "sm")}>
                      اكتب وصفةً تستعمله
                    </Link>
                  ) : undefined}
                  extra={row.wasteText !== null ? <>− هدرٌ مسجَّل <span className="nums">{row.wasteText}</span></> : undefined}
                />
                <Term
                  op="="
                  label="المتوقَّع"
                  value={row.expected}
                  strong
                  source={row.expected === null
                    ? `مجهولٌ لأنّ ${[row.openingText === null && "الرصيد", row.purchasesText === null && "المشتريات", row.consumptionText === null && "الاستهلاك"].filter(Boolean).join(" و") || "حدّاً فيه"} غير معروف — أكمِله في مربّعه`
                    : "يُقابَل بما تعدّه"}
                />
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
      )}
    </div>
  );
}

/** حدٌّ في المعادلة — قيمتُه أو «غير معروف»، ومصدرُه، وفعلُه إن جُهل. */
function Term({
  op, label, value, source, action, extra, strong = false, plain = false,
}: {
  op: "+" | "−" | "=" | null;
  label: string;
  value: string | null;
  source: string;
  action?: React.ReactNode;
  extra?: React.ReactNode;
  strong?: boolean;
  /** قيمةٌ جملةٌ لا رقم — «لا مشتريات». */
  plain?: boolean;
}) {
  const unknown = value === null;
  return (
    <div className={`flex min-w-0 flex-col rounded-lg border px-3 py-2.5 ${
      unknown ? "border-warn/30 bg-warn-bg" : strong ? "border-accent-line bg-accent-soft/50" : "border-line-soft bg-sunken/60"
    }`}>
      <dt className="flex items-center gap-1 text-[11px] font-medium text-muted">
        {op && <span aria-hidden className="text-[13px] font-bold text-ink-soft">{op}</span>}
        {label}
      </dt>
      <dd className={`mt-1 text-[15px] font-bold leading-tight ${unknown ? "text-warn" : ""}`}>
        {unknown ? "غير معروف" : <span className={plain ? "text-[13px]" : "nums"}>{value}</span>}
      </dd>
      <dd className="mt-0.5 text-[11px] leading-relaxed text-muted">{source}</dd>
      {extra && <dd className="mt-0.5 text-[11px] text-ink-soft">{extra}</dd>}
      {action && <dd className="mt-auto pt-2">{action}</dd>}
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
    <div className="mt-3 animate-rise rounded-xl border border-accent-line bg-accent-soft/40 p-4">
      <p className="text-[13px] font-bold">ما كان على الرفّ أوّلَ الأسبوع — {row.productName}</p>
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
            className="nums mt-1 block min-h-11 w-24 rounded-lg border border-line-input bg-raised px-2 text-center text-base"
          />
        </label>
        <label className="text-[11px] text-muted">
          الوحدة
          <select
            value={unit} onChange={(e) => setUnit(e.target.value)} disabled={busy || row.unitChoices.length < 2}
            className="mt-1 block min-h-11 rounded-lg border border-line-input bg-raised px-2 text-sm"
          >
            {row.unitChoices.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </label>
        <button aria-busy={busy} type="button" disabled={busy || value.trim() === ""} onClick={() => void save(value.trim())} className={buttonClass("primary", "sm")}>
          احفظ الرصيد
        </button>
        {row.openingManual && (
          <button type="button" disabled={busy} onClick={() => void save(null)} className={buttonClass("secondary", "sm")}>
            أفرِغه — يعود كما كان
          </button>
        )}
        <button type="button" disabled={busy} onClick={onDone} className={buttonClass("quiet", "sm")}>تراجع</button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
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
    <ul className="mt-3 space-y-1.5 rounded-lg border border-line-soft bg-sunken/60 px-3 py-2.5 text-xs">
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
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-input bg-raised px-3 text-sm"
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
    <div className="mt-3 rounded-xl border border-warn/25 bg-warn-bg p-3.5 text-xs">
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
