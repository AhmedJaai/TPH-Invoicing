import { formatDay } from "@/lib/riyadh-time";
import { WASTE_REASON_LABEL, type WasteReason } from "@/lib/inventory/waste-board";
import { countNoun, LINE } from "@/lib/arabic";
import type { WasteRow } from "./inventory-waste";

/**
 * سجلُّ الهدر في جردٍ مقفل — كلُّ سطرٍ سُجّل في أسبوعه، للقراءة وحدها.
 *
 * كانت شاشةُ الجرد المقفل لا تعرض منه شيئاً (قائمتُه تُحمَّل للمفتوح وحده) فلا يُرى إلّا رقمٌ مجمَّع
 * داخل جدول كلّ صنف (أحمد، ١ نوفمبر ٢٠٢٦: «المفترض يظهر كلّ المواد أو الأسطر لا أكثرها هدراً فقط»).
 * لا زرَّ إبطال هنا: المقفل لا يُعدَّل، ويُعاد فتحُ الجرد أولاً.
 */
export function WasteLedger({ rows }: { rows: readonly WasteRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label="الهدر المسجّل في هذا الأسبوع" className="rounded-xl border border-line bg-raised p-4 shadow-raised">
      <h4 className="text-sm font-bold">الهدر المسجّل في هذا الأسبوع <span className="font-normal text-muted">({countNoun(rows.length, LINE)})</span></h4>
      <ul className="mt-3 divide-y divide-line-soft text-xs">
        {rows.map((w) => (
          <li key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span className="nums w-28 shrink-0 text-muted">{formatDay(w.occurredOn)}</span>
            <span className="min-w-0 flex-1 basis-40 font-bold">{w.productName}</span>
            <span className="nums font-bold">{w.quantityText}</span>
            <span className="text-muted">
              {WASTE_REASON_LABEL[w.reason as WasteReason] ?? w.reason}
              {w.note && ` · ${w.note}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
