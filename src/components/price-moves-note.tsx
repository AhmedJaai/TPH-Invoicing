import { ArrowDown, ArrowUp, MessageCircle } from "lucide-react";
import { Money } from "./money";
import { buttonClass } from "./ui-tokens";
import { formatBp } from "@/lib/inventory/equation";
import { formatRiyalsDisplay } from "@/lib/money";
import { priceObjection, type PriceMove } from "@/lib/price-at-review";
import { PRICE_GAP_LABEL, type PriceGapReason } from "@/lib/price-watch";
import { formatDay } from "@/lib/riyadh-time";
import { whatsappHref } from "@/lib/supplier-edit";
import { T } from "@/components/i18n/t";

/**
 * «أغلى بـ٨٪ من آخر مرّة» — في بطاقة المراجعة، والمندوبُ ما زال عند الباب.
 *
 * الأرقامُ من الخادم (`/api/analyze`): سعرُ الوحدة الفعليّ مقابل السعر المعتاد للصنف
 * نفسه عند المورّد نفسه (`price-watch.ts`). وما ارتفع فعلاً معه «اعترض» برسالةٍ جاهزة —
 * رابطٌ يفتح واتساب ولا يُرسل شيئاً وحده. وما فرقُه الضريبةُ أو الوحدة «راجع البند».
 */

/** يُقرأ بفحصٍ لا بتحويل نوع — والردُّ القديمُ بلا الحقل «لا مقارنة». */
export function readPriceMoves(v: unknown): PriceMove[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): PriceMove[] => {
    if (typeof x !== "object" || x === null) return [];
    if (!("description" in x) || typeof x.description !== "string") return [];
    if (!("nowMinor" in x) || typeof x.nowMinor !== "number" || !Number.isSafeInteger(x.nowMinor)) return [];
    if (!("wasMinor" in x) || typeof x.wasMinor !== "number" || !Number.isSafeInteger(x.wasMinor)) return [];
    if (!("deltaBp" in x) || typeof x.deltaBp !== "number" || !Number.isSafeInteger(x.deltaBp)) return [];
    if (!("wasDay" in x) || typeof x.wasDay !== "string") return [];
    const reason: PriceGapReason | null = "reason" in x && (x.reason === "VAT" || x.reason === "UNIT") ? x.reason : null;
    return [{ description: x.description, nowMinor: x.nowMinor, wasMinor: x.wasMinor, deltaBp: x.deltaBp, wasDay: x.wasDay, reason }];
  });
}

export function PriceMovesNote({ moves, supplierName }: { moves: readonly PriceMove[]; supplierName: string }) {
  if (moves.length === 0) return null;
  const real = moves.filter((m) => m.reason === null);
  const checks = moves.filter((m) => m.reason !== null);
  const rises = real.filter((m) => m.deltaBp > 0);
  return (
    <section className={`rounded-xl border px-4 py-3 ${rises.length > 0 ? "border-warn/30 bg-warn-bg" : "border-line bg-sunken/50"}`}>
      {real.length > 0 && (
        <>
          <h4 className="text-xs font-bold">
            {rises.length > 0 ? "أسعار أعلى من المعتاد" : "أسعار أقل من المعتاد"}
          </h4>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-soft">
            <T s="سعر الوحدة بعد الخصم مقارنةً بالسعر المعتاد للصنف نفسه عند {0}. لا تظهر الفروق الأقل من 3٪." a={[supplierName]} /></p>
          <ul className="mt-2 space-y-1.5">
            {real.map((m) => <li key={m.description}><MoveRow m={m} /></li>)}
          </ul>
        </>
      )}
      {checks.length > 0 && (
        <div className={real.length > 0 ? "mt-3 border-t border-line pt-3" : ""}>
          <h4 className="text-xs font-bold">راجع قراءة هذه البنود قبل الأرشفة</h4>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-soft">فرقها لا يشبه تغيّر سعر، فالأرجح أن البند قُرئ خطأً.</p>
          <ul className="mt-2 space-y-1.5">
            {checks.map((m) => (
              <li key={m.description} className="text-xs">
                <MoveRow m={m} />
                <span className="block text-[11px] text-muted">{PRICE_GAP_LABEL[m.reason!]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {rises.length > 0 && (
        <a
          href={whatsappHref(null, priceObjection(supplierName, moves, formatRiyalsDisplay, formatDay))}
          target="_blank"
          rel="noopener noreferrer"
          className={`${buttonClass("secondary", "sm")} mt-3`}
        >
          <T s="{0}اعترض برسالة واتساب جاهزة" a={[<MessageCircle key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></a>
      )}
    </section>
  );
}

function MoveRow({ m }: { m: PriceMove }) {
  const up = m.deltaBp > 0;
  const Icon = up ? ArrowUp : ArrowDown;
  const tone = m.reason !== null ? "text-ink-soft" : up ? "text-warn" : "text-ok";
  return (
    <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
      <span className="min-w-0 flex-1 basis-40 truncate font-bold" dir="auto">{m.description}</span>
      <span className="text-ink-soft">
        <T s="{0}، والمعتاد {1} (آخره {2})" a={[<Money key="0" minor={m.nowMinor} />, <Money key="1" minor={m.wasMinor} />, formatDay(m.wasDay)]} /></span>
      <span className={`inline-flex items-center gap-0.5 font-bold ${tone}`}>
        <Icon className="h-3 w-3" strokeWidth={2.5} aria-hidden />
        <span className="sr-only">{up ? "أغلى" : "أرخص"}</span>
        {formatBp(Math.abs(m.deltaBp))}
      </span>
    </span>
  );
}
