/**
 * المشترى والمباع والمتوقَّع متبقّياً — يجمع لكلّ صنف مخزونٍ ما يحتاجه `stock-balance.ts`.
 *
 * يُحمَّل كلُّ شيءٍ **منذ البداية حتى آخر المدّة** مرّةً واحدة ثمّ يُقطَع في الذاكرة ثلاثَ
 * قطع: المدّةُ المعروضة، ومنذ البداية حتى آخرها (للمتوقَّع)، ومنذ البداية حتى يوم آخر
 * عدٍّ (للضائع). الاستهلاكُ من `computeConsumption` والمشترياتُ من `summarisePurchases` —
 * لا معادلةَ ثانية. ووحدةُ كلّ صنفٍ وعبوتُه من كتالوج فودكس المستورَد (`catalog_pack_milli`).
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";
import { computeConsumption, type SoldLineInput } from "@/lib/inventory/consumption";
import { summarisePurchases, type PurchaseLineInput } from "@/lib/inventory/purchases";
import { indexRecipeVersions } from "@/lib/inventory/recipe";
import { toCanonical } from "@/lib/inventory/units";
import { buildBalanceItem, totalBalance, type BalanceItem, type BalanceTotals, type RangeFigures } from "@/lib/finance/stock-balance";
import { addDays, monthEndDay, todayInRiyadh } from "@/lib/riyadh-time";
import type { StoredUnit } from "@/lib/unit-conversion";
import { loadPurchaseLines, loadSoldForReport } from "./inventory.service";
import { loadRates } from "./profit.service";
import { loadRecipeVersions } from "./recipe.service";
import { loadCountAt, loadCountDays, type CountSource } from "./stock-flow.service";
import type { Conn } from "./types";

/** قبل أوّل فاتورةٍ وأوّل بيع — «منذ البداية». */
const BEGINNING = "2020-01-01";

export interface StockBalance {
  /** المدّةُ المعروضة — `from` فارغٌ لـ«كلّ الوقت». */
  from: string | null;
  to: string;
  firstDay: string | null;
  countDay: string | null;
  countSource: CountSource | null;
  items: BalanceItem[];
  totals: BalanceTotals;
  /** مبيعاتٌ لم تدخل الاستهلاك (بلا وصفة) في المدّة. */
  salesWithoutRecipeMinor: number;
  /** بنودُ فواتيرنا في المدّة التي لم تُربَط بصنف — قيمتُها. */
  unlinkedInvoiceMinor: number;
  /** لصنفٍ واحد إن طُلب: شهراً بشهر. */
  trend: { month: string; purchasedMilli: number | null; soldMilli: number | null; expectedMilli: number | null }[];
}

interface Loaded {
  stock: { id: string; name: string; baseUnit: StoredUnit; sku: string | null; packMilli: number | null }[];
  sold: SoldLineInput[];
  bought: PurchaseLineInput[];
  foodics: { sku: string; day: string; milli: number; minor: number }[];
  waste: { productId: string; day: string; canonical: number }[];
  versions: ReturnType<typeof indexRecipeVersions>;
  reached: Set<string>;
  everLinked: Set<string>;
}

function figures(data: Loaded, from: string, to: string): Map<string, RangeFigures> {
  const inRange = (day: string) => day >= from && day <= to;
  const sold = data.sold.filter((l) => inRange(l.businessDate));
  const used = computeConsumption(sold, data.versions).byIngredient;
  const baseUnitOf = new Map(data.stock.map((p) => [p.id, p.baseUnit] as const));
  const ours = summarisePurchases(data.bought.filter((l) => inRange(l.invoiceDate)), (id) => baseUnitOf.get(id) ?? null);
  const unmeasured = new Set(ours.gaps.flatMap((g) => (g.productId && g.reason !== "UNLINKED_PRODUCT" ? [g.productId] : [])));
  const out = new Map<string, RangeFigures>();
  for (const p of data.stock) {
    const mine = ours.byProduct.get(p.id);
    const consumed = used.get(p.id);
    let foodicsMilli = 0;
    let foodicsMinor = 0;
    if (p.sku) for (const f of data.foodics) if (f.sku === p.sku && inRange(f.day)) { foodicsMilli += f.milli; foodicsMinor += f.minor; }
    let wasteMilli = 0;
    for (const w of data.waste) if (w.productId === p.id && inRange(w.day)) wasteMilli += w.canonical;
    out.set(p.id, {
      invoicesMilli: data.everLinked.has(p.id) && !unmeasured.has(p.id) ? mine?.canonicalMilli ?? 0 : null,
      invoicesMinor: mine?.knownCostMinor ?? 0,
      /* مِلّي‑وحدةِ‑تخزين × عبوةُ الكتالوج ÷ ألف = مِلّي وحدةِ الأساس */
      foodicsMilli: p.sku && p.packMilli !== null ? toCanonical(Math.round((foodicsMilli * p.packMilli) / 1000), p.baseUnit) : null,
      foodicsMinor,
      soldMilli: consumed ? (consumed.unitConflict !== null ? null : consumed.canonicalMilli) : data.reached.has(p.id) ? 0 : null,
      staffMilli: consumed?.fromComplimentaryMilli ?? 0,
      wasteMilli,
    });
  }
  return out;
}

async function load(to: string, conn: Conn): Promise<Loaded> {
  const [stock, versions, purchases, foodics, waste, linked] = await Promise.all([
    conn.select({ id: products.id, name: products.nameAr, baseUnit: products.baseUnit, sku: products.foodicsItemSku, packMilli: products.catalogPackMilli })
      .from(products).where(and(eq(products.isStockItem, true), eq(products.isActive, true))),
    loadRecipeVersions(conn),
    loadPurchaseLines(BEGINNING, to, conn),
    conn.execute<{ sku: string; day: string; milli: string; minor: string }>(sql`
      select i.sku, p.business_date as day,
             sum(case when p.type = 4 then -i.quantity_milli else i.quantity_milli end)::text as milli,
             sum(case when p.type = 4 then -i.cost_minor else i.cost_minor end)::text as minor
        from foodics_purchase_items i join foodics_purchases p on p.id = i.purchase_id
       where i.sku is not null and p.business_date <= ${to}
       group by i.sku, p.business_date
    `),
    conn.execute<{ product_id: string; day: string; quantity_milli: string; unit: StoredUnit }>(sql`
      select product_id, occurred_on as day, quantity_milli::text, unit::text as unit
        from waste_records where voided_at is null and occurred_on <= ${to}
    `),
    conn.execute<{ product_id: string }>(sql`select distinct product_id from supplier_products where product_id is not null`),
  ]);
  const sold = await loadSoldForReport(BEGINNING, to, versions, conn);
  return {
    stock: stock.map((p) => ({ ...p, packMilli: p.packMilli === null ? null : Number(p.packMilli) })),
    sold, bought: purchases.inPeriod,
    foodics: foodics.rows.map((r) => ({ sku: r.sku, day: r.day, milli: Number(r.milli), minor: Number(r.minor) })),
    waste: waste.rows.map((w) => ({ productId: w.product_id, day: w.day, canonical: toCanonical(Number(w.quantity_milli), w.unit) })),
    versions: indexRecipeVersions(versions),
    reached: new Set(versions.flatMap((v) => v.ingredients.map((g) => g.productId))),
    everLinked: new Set(linked.rows.map((r) => r.product_id)),
  };
}

/**
 * ميزانُ الأصناف لشهرٍ (`YYYY-MM`) أو لكلّ الوقت (`null`). و`trendFor` يطلب لصنفٍ واحد
 * أشهرَه واحداً واحداً من البيانات نفسِها المحمَّلة.
 */
export async function loadStockBalance(month: string | null, opts: { trendFor?: string; months?: readonly string[] } = {}, conn: Conn = db): Promise<StockBalance> {
  const today = todayInRiyadh();
  const monthEnd = month ? monthEndDay(month) : today;
  const to = monthEnd < today ? monthEnd : today;
  const from = month ? `${month}-01` : null;
  const data = await load(to, conn);

  const days = await loadCountDays(conn);
  const countDay = [...new Set([...days.ours, ...days.foodics])].filter((d) => d <= to).sort().pop() ?? null;
  const bySku = new Map(data.stock.flatMap((p) => (p.sku ? [[p.sku, { id: p.id, baseUnit: p.baseUnit }] as const] : [])));
  const [count, rates] = await Promise.all([
    countDay ? loadCountAt(countDay, bySku, conn) : Promise.resolve({ values: new Map<string, number>(), source: null }),
    loadRates(to, new Map(data.stock.map((p) => [p.id, p.baseUnit] as const)), conn),
  ]);

  const period = figures(data, from ?? BEGINNING, to);
  const toDate = from === null ? period : figures(data, BEGINNING, to);
  const toCount = countDay ? figures(data, BEGINNING, countDay) : null;
  const before = from === null ? null : figures(data, BEGINNING, addDays(from, -1));
  const empty: RangeFigures = { invoicesMilli: null, invoicesMinor: 0, foodicsMilli: null, foodicsMinor: 0, soldMilli: null, staffMilli: 0, wasteMilli: 0 };

  const items = data.stock.map((p) => {
    const counted = count.values.get(p.id);
    return buildBalanceItem({
      productId: p.id, name: p.name, baseUnit: p.baseUnit, rateMilliMinor: rates.get(p.id) ?? null,
      period: period.get(p.id) ?? empty, before: before === null ? null : before.get(p.id) ?? empty, toDate: toDate.get(p.id) ?? empty,
      toCount: counted === undefined ? null : toCount?.get(p.id) ?? null,
      count: counted === undefined || countDay === null || count.source === null ? null : { day: countDay, milli: counted, source: count.source },
    });
  });

  const inPeriod = (day: string) => day >= (from ?? BEGINNING) && day <= to;
  const soldPeriod = computeConsumption(data.sold.filter((l) => inPeriod(l.businessDate)), data.versions);
  const firstDay = data.sold.reduce<string | null>((min, l) => (min === null || l.businessDate < min ? l.businessDate : min), null);

  const trend: StockBalance["trend"] = [];
  const product = opts.trendFor ? data.stock.find((p) => p.id === opts.trendFor) : undefined;
  if (product) {
    /* الأكملُ من المصدرين حتى تاريخ — كما في `stock-balance.ts` */
    const bestOf = (r: RangeFigures) => (r.invoicesMilli === null ? r.foodicsMilli : r.foodicsMilli === null ? r.invoicesMilli : Math.max(r.invoicesMilli, r.foodicsMilli));
    for (const m of opts.months ?? []) {
      const end = monthEndDay(m) < to ? monthEndDay(m) : to;
      if (`${m}-01` > to) continue;
      const inMonth = figures(data, `${m}-01`, end).get(product.id) ?? empty;
      const through = figures(data, BEGINNING, end).get(product.id) ?? empty;
      const earlier = figures(data, BEGINNING, addDays(`${m}-01`, -1)).get(product.id) ?? empty;
      const b = bestOf(through);
      trend.push({
        month: m, purchasedMilli: b === null ? null : b - (bestOf(earlier) ?? 0), soldMilli: inMonth.soldMilli,
        expectedMilli: b === null || through.soldMilli === null ? null : b - through.soldMilli - through.wasteMilli,
      });
    }
  }

  return {
    from, to, firstDay, countDay, countSource: count.source,
    items, totals: totalBalance(items),
    salesWithoutRecipeMinor: soldPeriod.excluded.filter((e) => e.reason !== "VOID").reduce((s, e) => s + e.lineTotalMinor, 0),
    unlinkedInvoiceMinor: data.bought.filter((l) => inPeriod(l.invoiceDate) && !l.productId).reduce((s, l) => s + l.lineTotalMinor, 0),
    trend,
  };
}
