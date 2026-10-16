import { ArrowDown, ArrowUp, MessageCircle } from "lucide-react";
import { Money } from "./money";
import { buttonClass } from "./ui-tokens";
import { formatBp } from "@/lib/inventory/equation";
import { formatRiyalsDisplay } from "@/lib/money";
import { priceObjection, type PriceMove } from "@/lib/price-at-review";
import { formatDay } from "@/lib/riyadh-time";
import { whatsappHref } from "@/lib/supplier-edit";

/**
 * «أغلى بـ٨٪ من آخر مرّة» — في بطاقة المراجعة، والمندوبُ ما زال عند الباب.
 *
 * الأرقامُ من الخادم (`/api/analyze`): سعرُ الوحدة المقروء مقابل آخر سعرٍ قُيِّد
 * للصنف نفسه عند المورّد نفسه. وما ارتفع معه «اعترض» برسالةٍ جاهزة — رابطٌ يفتح
 * واتساب ولا يُرسل شيئاً وحده.
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
    return [{ description: x.description, nowMinor: x.nowMinor, wasMinor: x.wasMinor, deltaBp: x.deltaBp, wasDay: x.wasDay }];
  });
}

export function PriceMovesNote({ moves, supplierName }: { moves: readonly PriceMove[]; supplierName: string }) {
  if (moves.length === 0) return null;
  const rises = moves.filter((m) => m.deltaBp > 0);
  return (
    <section className={`rounded-xl border px-4 py-3 ${rises.length > 0 ? "border-warn/30 bg-warn-bg" : "border-line bg-sunken/50"}`}>
      <h4 className="text-xs font-bold">
        {rises.length > 0 ? "أسعار ارتفعت عن آخر توريد" : "أسعار انخفضت عن آخر توريد"}
      </h4>
      <p className="mt-0.5 text-[11px] leading-relaxed text-ink-soft">
        سعر الوحدة كما قرئ مقابل آخر سعر قيّد للصنف نفسه عند {supplierName}. دون 3٪ لا يذكر.
      </p>
      <ul className="mt-2 space-y-1.5">
        {moves.map((m) => {
          const up = m.deltaBp > 0;
          const Icon = up ? ArrowUp : ArrowDown;
          return (
            <li key={m.description} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
              <span className="min-w-0 flex-1 basis-40 truncate font-bold" dir="auto">{m.description}</span>
              <span className="text-ink-soft">
                <Money minor={m.nowMinor} /> — وكان <Money minor={m.wasMinor} /> في {formatDay(m.wasDay)}
              </span>
              <span className={`inline-flex items-center gap-0.5 font-bold ${up ? "text-warn" : "text-ok"}`}>
                <Icon className="h-3 w-3" strokeWidth={2.5} aria-hidden />
                <span className="sr-only">{up ? "أغلى" : "أرخص"}</span>
                {formatBp(Math.abs(m.deltaBp))}
              </span>
            </li>
          );
        })}
      </ul>
      {rises.length > 0 && (
        <a
          href={whatsappHref(null, priceObjection(supplierName, moves, formatRiyalsDisplay, formatDay))}
          target="_blank"
          rel="noopener noreferrer"
          className={`${buttonClass("secondary", "sm")} mt-3`}
        >
          <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          اعترض — رسالة واتساب جاهزة
        </a>
      )}
    </section>
  );
}
