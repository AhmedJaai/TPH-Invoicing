"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Copy, MessageCircle, Minus, Plus, Store, Truck } from "lucide-react";
import { Badge, Card, buttonClass } from "./ui";
import { Input, toast } from "./ui-client";
import { Money } from "./money";
import { DAY, PRODUCT, countNoun, countNounGen } from "@/lib/arabic";
import { readableQuantity } from "@/lib/finance/quantity";
import { buildOrderMessage, lineCost, supplierTotals, type OrderLine, type SupplierOrder } from "@/lib/inventory/order-list";
import { decimalToMilli, milliToDecimal, fromCanonical, toCanonical, toLatinDigits } from "@/lib/inventory/units";
import { formatDay } from "@/lib/riyadh-time";
import { whatsappHref } from "@/lib/supplier-edit";
import { storedUnitLabel, type StoredUnit } from "@/lib/unit-conversion";

/** وحدةُ الكتابة لما لا عبوةَ له: الكيلو للجرام واللترُ للمليلتر. */
function entryUnit(u: StoredUnit): StoredUnit {
  return u === "G" ? "KG" : u === "ML" ? "L" : u;
}

/** القيمةُ الأولى في الحقل: عددُ العبوات، أو الكمّيّةُ بوحدة الكتابة. */
function initialText(l: OrderLine): string {
  if (l.packs !== null) return String(l.packs);
  const milli = fromCanonical(l.orderMilli, entryUnit(l.baseUnit));
  return milliToDecimal(milli).replace(/\.?0+$/, "");
}

/** ما كُتب في الحقل ← عبواتٌ وكمّيّةٌ بمِلّي وحدة الأساس. `null` لا يُقرأ. */
function parseEntry(l: OrderLine, text: string): { packs: number | null; orderMilli: number } | null {
  const raw = toLatinDigits(text.trim());
  if (raw === "") return null;
  if (l.packMilli !== null) {
    if (!/^\d+$/.test(raw)) return null;
    const packs = Number(raw);
    return Number.isSafeInteger(packs) ? { packs, orderMilli: packs * l.packMilli } : null;
  }
  const milli = decimalToMilli(raw);
  if (milli === null || milli < 0) return null;
  return { packs: null, orderMilli: toCanonical(milli, entryUnit(l.baseUnit)) };
}

/** الكمّيّةُ كما تُكتب للمورّد. */
function quantityText(l: OrderLine, packs: number | null, orderMilli: number): string {
  if (packs !== null && l.packMilli !== null) return `${packs} × ${readableQuantity(l.packMilli, l.baseUnit)}`;
  return readableQuantity(orderMilli, l.baseUnit);
}

export function OrderList({ groups, showMoney }: { groups: readonly SupplierOrder[]; showMoney: boolean }) {
  return (
    <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-4">
      {groups.map((g) => <SupplierCard key={g.supplierId ?? "unknown"} group={g} showMoney={showMoney} />)}
    </div>
  );
}

function SupplierCard({ group: g, showMoney }: { group: SupplierOrder; showMoney: boolean }) {
  const [text, setText] = useState<Record<string, string>>(() => Object.fromEntries(g.lines.map((l) => [l.productId, initialText(l)])));
  const entries = useMemo(() => g.lines.map((l) => ({ line: l, parsed: parseEntry(l, text[l.productId] ?? "") })), [g.lines, text]);
  const ordered = entries.filter((e) => e.parsed !== null && e.parsed.orderMilli > 0);
  const invalid = entries.filter((e) => e.parsed === null).length;
  const totals = supplierTotals(ordered.map((e) => lineCost(e.parsed!.packs, e.line.packPriceMinor)));
  const message = buildOrderMessage(g.supplierName, ordered.map((e) => ({
    label: e.line.name, quantity: quantityText(e.line, e.parsed!.packs, e.parsed!.orderMilli),
  })));
  const canSend = ordered.length > 0 && invalid === 0;
  const why = invalid > 0 ? "صحّح الكمية غير المقروءة أولاً" : ordered.length === 0 ? "لا صنف بكمية أكبر من صفر" : undefined;

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      toast({ tone: "ok", title: "نُسخت رسالة الطلب", body: "الصقها في واتساب المورّد وراجعها قبل الإرسال.", duration: 3000 });
    } catch {
      toast({ tone: "warn", title: "تعذّر النسخ", body: "المتصفح منع النسخ. حدّد نص الرسالة أدناه وانسخه بنفسك." });
    }
  }

  const step = (l: OrderLine, by: number) => {
    const cur = parseEntry(l, text[l.productId] ?? "");
    const next = Math.max(0, (cur?.packs ?? 0) + by);
    setText((t) => ({ ...t, [l.productId]: String(next) }));
  };

  return (
    <Card padded={false}>
      <header className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3 sm:px-5">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          {g.supplierId ? <Truck className="h-4 w-4" strokeWidth={2} aria-hidden /> : <Store className="h-4 w-4" strokeWidth={2} aria-hidden />}
        </span>
        <div className="min-w-0 flex-1 basis-48">
          <h2 className="text-[15px] font-bold">
            {g.supplierSlug ? <Link href={`/suppliers/${g.supplierSlug}`} className="hover:underline">{g.supplierName}</Link> : "مورّد غير معروف"}
          </h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            {g.supplierId
              ? <>{countNoun(g.lines.length, PRODUCT)} · آخر شراء منه لهذه الأصناف</>
              : <>أصناف لم تُشترَ بفاتورة مربوطة بصنفها، فلا يُعرف مورّدها ولا سعرها. <Link href="/finance/stock/links" className="font-bold text-accent hover:underline">اربط بنود الفواتير</Link></>}
          </p>
        </div>
        {showMoney && (
          <div className="text-end">
            <p className="text-[11px] text-muted">تقدير الطلب</p>
            <p className="text-base font-bold">
              {invalid > 0
                ? <span className="text-sm text-ink-soft">غير معروف حتى تُصحَّح الكمية</span>
                : totals.totalMinor !== null
                ? <Money minor={totals.totalMinor} currency />
                : totals.knownCostMinor > 0
                  ? <><Money minor={totals.knownCostMinor} currency /><span className="block text-[11px] font-normal text-warn">{`ودون سعر ${countNounGen(totals.unknownCostLines, PRODUCT)}`}</span></>
                  : <span className="text-sm text-ink-soft">غير معروف</span>}
            </p>
          </div>
        )}
      </header>

      <ul className="divide-y divide-line">
        {entries.map(({ line: l, parsed }) => {
          const id = `qty-${l.productId}`;
          const cost = parsed ? lineCost(parsed.packs, l.packPriceMinor) : null;
          return (
            <li key={l.productId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1 basis-56">
                <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                  <label htmlFor={id}>{l.name}</label>
                  <Badge tone={l.daysLeft <= 2 ? "danger" : "warn"}>{l.daysLeft === 0 ? "نفد أو يكاد" : `يكفي ${countNounGen(l.daysLeft, DAY)}`}</Badge>
                </p>
                <p className="mt-0.5 text-xs text-ink-soft">
                  على الرف نحو <span className="nums">{readableQuantity(l.onShelfMilli, l.baseUnit)}</span>، ويُصرف <span className="nums">{readableQuantity(l.dailyUseMilli, l.baseUnit)}</span> يومياً
                </p>
                {l.description && (
                  <p className="mt-0.5 truncate text-[11px] text-muted" title={l.description}>
                    {l.lastDay && <>آخر شراء <bdi>{formatDay(l.lastDay)}</bdi>: </>}<bdi>{l.description}</bdi>
                  </p>
                )}
              </div>
              <div className="flex w-full items-center gap-1.5 sm:w-auto">
                {l.packMilli !== null && (
                  <button type="button" onClick={() => step(l, -1)} aria-label={`أنقص ${l.name} عبوة`} className={buttonClass("secondary", "sm")}>
                    <Minus className="h-4 w-4" strokeWidth={2} aria-hidden />
                  </button>
                )}
                <div className="min-w-0 flex-1 sm:w-20 sm:flex-none">
                <Input
                  id={id}
                  type="text"
                  inputMode={l.packMilli !== null ? "numeric" : "decimal"}
                  dir="ltr"
                  autoComplete="off"
                  value={text[l.productId] ?? ""}
                  onChange={(e) => setText((t) => ({ ...t, [l.productId]: e.target.value }))}
                  invalid={parsed === null}
                  aria-describedby={`${id}-unit`}
                  className="nums text-center"
                />
                </div>
                {l.packMilli !== null && (
                  <button type="button" onClick={() => step(l, 1)} aria-label={`زد ${l.name} عبوة`} className={buttonClass("secondary", "sm")}>
                    <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
                  </button>
                )}
                <span id={`${id}-unit`} className="min-w-16 text-xs text-ink-soft">
                  {l.packMilli !== null ? <>عبوة × <span className="nums">{readableQuantity(l.packMilli, l.baseUnit)}</span></> : storedUnitLabel(entryUnit(l.baseUnit))}
                </span>
              </div>
              {showMoney && (
                <div className="w-24 text-end text-sm">
                  {parsed === null ? <span className="text-[11px] font-bold text-danger">كمية غير مقروءة</span>
                    : cost !== null ? <Money minor={cost} /> : <span className="text-[11px] font-bold text-ink-soft">غير معروف</span>}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <footer className="border-t border-line px-4 py-3 sm:px-5">
        <details className="group">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs font-bold text-accent sm:min-h-8">نص الرسالة</summary>
          <pre dir="rtl" className="mt-2 whitespace-pre-wrap rounded-lg font-sans bg-sunken p-3 text-xs leading-relaxed text-ink">{message}</pre>
        </details>
        <div className="mt-2 flex max-w-full flex-wrap items-center gap-2">
          <button type="button" onClick={() => void copy()} disabled={!canSend} title={why} className={buttonClass("primary", "sm")}>
            <Copy className="h-4 w-4" strokeWidth={2} aria-hidden />
            انسخ رسالة الطلب
          </button>
          {g.supplierId && g.phoneE164 && (
            canSend
              ? <a href={whatsappHref(g.phoneE164, message)} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
                  <MessageCircle className="h-4 w-4" strokeWidth={2} aria-hidden />
                  افتح واتساب المورّد
                </a>
              : null
          )}
          {g.supplierSlug && !g.phoneE164 && (
            <Link href={`/suppliers/${g.supplierSlug}`} className={buttonClass("quiet", "sm")}>لا رقم واتساب محفوظ — أضفه</Link>
          )}
          {why && <span className="text-xs text-ink-soft">{why}</span>}
        </div>
        <p className="mt-2 text-[11px] text-muted">لا يُرسل شيء من هنا. {showMoney ? "التقدير بسعر العبوة في آخر فاتورة، وقد يتغير." : ""}</p>
      </footer>
    </Card>
  );
}
