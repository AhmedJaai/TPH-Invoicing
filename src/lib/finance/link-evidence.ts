/**
 * دليلُ الربط من فودكس — بندُ فاتورتنا أمام بند شراءٍ أُدخل في فودكس للمورّد نفسه في
 * الأيّام نفسها **بالمبلغ نفسه**. الموظّفُ الذي أدخل الفاتورة في فودكس اختار صنفَ
 * المخزون وكتب كمّيّته — فهو قال، سطراً سطراً، ما لم يقله أحدٌ عندنا بعد.
 *
 * وهذا اقتراحٌ يُقرّه إنسان: المبلغُ المتطابق قد يقع مصادفةً بين صنفين بالسعر نفسه
 * (شرابان بثمانيةٍ وأربعين). فلا يُقترَح إلّا ما اتّفقت شواهدُه على صنفٍ واحد، ولا تُقترَح
 * عبوةٌ إلّا إن اتّفقت الشواهدُ عليها.
 */
import type { StoredUnit } from "@/lib/unit-conversion";

export interface EvidenceMatch {
  supplierProductId: string;
  /** صنفُ المخزون عندنا الذي يقابل رمزَ فودكس. */
  productId: string;
  baseUnit: StoredUnit;
  /** كمّيّةُ سطر فاتورتنا بالمِلّي — `null` لم تُقرأ. */
  invoiceQtyMilli: number | null;
  /** كمّيّةُ فودكس بوحدة أساس الصنف، بالمِلّي. */
  foodicsBaseMilli: number;
}

export interface LinkEvidence {
  productId: string;
  baseUnit: StoredUnit;
  /** كم سطراً أيّد هذا الصنف. */
  matches: number;
  /** ما في وحدة الفاتورة الواحدة بوحدة أساس الصنف — `null` الشواهدُ لم تتّفق أو لم تُقرأ كمّيّة. */
  contentQuantity: string | null;
}

/** أدنى حصّةٍ للصنف الغالب بين شواهد البند ليُقترَح (بنقاط الأساس). */
export const EVIDENCE_AGREEMENT_BP = 8_000;
/** سماحةُ اتّفاق العبوة بين شاهدَين (بنقاط الأساس). */
const PACK_TOLERANCE_BP = 100;

/** «1500» مِلّي ← «1.5» — ثلاثُ خاناتٍ على الأكثر، بلا أصفارٍ زائدة. */
function milliText(milli: number): string {
  const whole = Math.floor(milli / 1000);
  const frac = String(milli % 1000).padStart(3, "0").replace(/0+$/, "");
  return frac === "" ? String(whole) : `${whole}.${frac}`;
}

export function summariseEvidence(matches: readonly EvidenceMatch[]): Map<string, LinkEvidence> {
  const bySp = new Map<string, EvidenceMatch[]>();
  for (const m of matches) bySp.set(m.supplierProductId, [...(bySp.get(m.supplierProductId) ?? []), m]);

  const out = new Map<string, LinkEvidence>();
  for (const [sp, list] of bySp) {
    const votes = new Map<string, EvidenceMatch[]>();
    for (const m of list) votes.set(m.productId, [...(votes.get(m.productId) ?? []), m]);
    const [winner] = [...votes.values()].sort((a, b) => b.length - a.length);
    if (winner.length * 10_000 < list.length * EVIDENCE_AGREEMENT_BP) continue;

    /* ما في الوحدة = كمّيّةُ فودكس ÷ كمّيّةُ فاتورتنا — ويلزم أن تتّفق عليه الشواهد */
    const perUnit = winner.flatMap((m) =>
      m.invoiceQtyMilli !== null && m.invoiceQtyMilli > 0 && m.foodicsBaseMilli > 0
        ? [Math.round((m.foodicsBaseMilli * 1000) / m.invoiceQtyMilli)] : []);
    let contentQuantity: string | null = null;
    if (perUnit.length === winner.length && perUnit.length > 0) {
      const lo = Math.min(...perUnit);
      const hi = Math.max(...perUnit);
      if ((hi - lo) * 10_000 <= lo * PACK_TOLERANCE_BP && lo > 0) contentQuantity = milliText(lo);
    }
    out.set(sp, { productId: winner[0].productId, baseUnit: winner[0].baseUnit, matches: winner.length, contentQuantity });
  }
  return out;
}
