import { Badge, Delta } from "@/components/ui";
import { Money } from "@/components/money";
import { T } from "@/components/i18n/t";
import { PRICE_GAP_LABEL, type PriceState } from "@/lib/price-watch";

/**
 * حكمُ سعر الصنف في خليّة — من `lib/price-watch.ts` وحده، فلا تقول شاشتان شيئين.
 * ما يفسّره غيرُ السعر يُسمّى سببُه ولا يُعرض نسبةً، وما لم يؤكَّد يُقال إنّه ينتظر.
 */
export function PriceStateCell({ state, purchases }: { state: PriceState; purchases: number }) {
  if (state.kind === "MOVED" || state.kind === "UNCONFIRMED") {
    const pct = Math.round(state.deltaBp / 100);
    if (state.reason !== null) {
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5 text-[11px]">
          <Badge tone="warn">راجع البند</Badge>
          <span className="text-muted">
            <T s="{0} — كان {1}" a={[PRICE_GAP_LABEL[state.reason], <Money key="1" minor={state.fromMinor} />]} />
          </span>
        </span>
      );
    }
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Delta pct={pct} favourable={pct <= 0} />
        <span className="text-[11px] text-muted">
          {state.kind === "MOVED"
            ? <T s="من {0}" a={[<Money key="0" minor={state.fromMinor} />]} />
            : <T s="من {0} — في فاتورة واحدة، ينتظر الفاتورة التالية" a={[<Money key="0" minor={state.fromMinor} />]} />}
        </span>
      </span>
    );
  }
  if (state.kind === "MIXED") {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-[11px]">
        <Badge>سعران معاً</Badge>
        <span className="text-muted">بندان باسم واحد في الفاتورة نفسها، فلا يُقارن سعرهما</span>
      </span>
    );
  }
  return <span className="text-[11px] text-muted">{state.kind === "STABLE" || purchases > 1 ? "لم يتغيّر" : "شراء واحد"}</span>;
}
