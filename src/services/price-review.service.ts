/**
 * آخرُ سعرٍ قُيِّد لكلّ صنفٍ عند مورّدٍ بعينه — لمقارنة المراجعة (`lib/price-at-review.ts`).
 * قراءةٌ وحدها، ومن `invoice_lines` القائم: لا جدولَ ولا حسابَ جديد.
 */
import { and, desc, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { invoiceLines } from "@/db/schema";
import type { LastPrice } from "@/lib/price-at-review";
import { todayInRiyadh } from "@/lib/riyadh-time";

export async function loadLastItemPrices(supplierId: string, keys: readonly string[]): Promise<Map<string, LastPrice>> {
  const out = new Map<string, LastPrice>();
  if (keys.length === 0) return out;
  const rows = await db
    .select({
      key: invoiceLines.normalizedDescription,
      unitPriceMinor: invoiceLines.unitPriceMinor,
      invoiceDate: invoiceLines.invoiceDate,
    })
    .from(invoiceLines)
    .where(and(
      eq(invoiceLines.supplierId, supplierId),
      inArray(invoiceLines.normalizedDescription, [...keys].slice(0, 200)),
      /* بلا تاريخٍ لا يُعرف أنّه «آخر»، وسعرٌ صفرٌ ليس سعراً يُقارَن به */
      isNotNull(invoiceLines.invoiceDate),
      gt(invoiceLines.unitPriceMinor, 0),
    ))
    .orderBy(desc(invoiceLines.invoiceDate))
    .limit(2000);
  /* الأحدثُ أوّلاً — فأوّلُ ما يُرى لكلّ صنفٍ هو آخرُ سعره */
  for (const r of rows) {
    if (out.has(r.key) || !r.invoiceDate) continue;
    out.set(r.key, { unitPriceMinor: r.unitPriceMinor, day: todayInRiyadh(r.invoiceDate) });
  }
  return out;
}
