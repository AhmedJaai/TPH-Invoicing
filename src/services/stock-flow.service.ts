/**
 * المشترى مقابل المباع — يجمع لنافذةٍ كلَّ ما يحتاجه `lib/finance/stock-flow.ts`.
 *
 * لا معادلةَ ثانية: الاستهلاكُ من `computeConsumption`، والمشترياتُ من `summarisePurchases`،
 * والكلفةُ بترتيب الجرد نفسِه (متوسّطُ شراء الفترة ← آخرُ فاتورة ← الكتالوج). والجديدُ
 * طرفا المعادلة: **العدُّ** — جردُنا المقفَل إن طابق الطرف، وإلّا ما عدّه من يجرد في فودكس
 * (واقعةٌ كتبها إنسان، لا حسابُ فودكس) — ويُقال مصدرُه.
 *
 * وفودكس شاهدٌ بجانب كلّ رقم: صرفُه، وهدرُه، ومشترياتُه. لا يدخل المعادلةَ منه إلّا
 * المعدود.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";
import { computeConsumption } from "@/lib/inventory/consumption";
import { summarisePurchases, unitCostMilliMinor, type PurchaseGap } from "@/lib/inventory/purchases";
import { indexRecipeVersions } from "@/lib/inventory/recipe";
import { toCanonical } from "@/lib/inventory/units";
import { buildFlowItem, ratioBp, totalFlow, type CostBasis, type FlowItem, type FlowTotals } from "@/lib/finance/stock-flow";
import { stockWindow, type StockWindow } from "@/lib/finance/stock-window";
import { addDays, daysBetween } from "@/lib/riyadh-time";
import type { StoredUnit } from "@/lib/unit-conversion";
import { catalogCosts, fallbackCosts, loadPurchaseLines, loadSoldForReport, loadWaste } from "./inventory.service";
import { loadRecipeVersions } from "./recipe.service";
import type { Conn } from "./types";


export type CountSource = "OURS" | "FOODICS";

export interface StockFlow {
  window: StockWindow;
  /** مصدرُ كلّ طرف — `null` لا عدَّ. */
  openingSource: CountSource | null;
  closingSource: CountSource | null;
  items: FlowItem[];
  totals: FlowTotals;
  coverage: {
    /** قيمةُ بنود الفواتير في النافذة (بلا ما رُبط بصنفٍ ليس مخزوناً). */
    invoiceLinesMinor: number;
    /** منها ما دخل الحساب: مربوطٌ بصنف مخزونٍ معروفُ الكمّيّة. */
    measuredMinor: number;
    /** نسبتُها بنقاط الأساس — `null` لا بنود. */
    bp: number | null;
    /** ما خرج، بسببه. */
    gaps: PurchaseGap[];
    /** مبيعاتٌ لم تدخل الاستهلاك (بلا وصفة أو غير مربوطة) وقيمتُها. */
    salesExcludedMinor: number;
    salesIncludedMinor: number;
    /** أيّامُ النافذة التي قُرئ صرفُ فودكس لها. */
    witnessDays: number;
    days: number;
  };
}

/** أيّامُ العدّ المعروفة (جردُنا المقفَل وجرودُ فودكس الكاملة). */
export async function loadCountDays(conn: Conn = db): Promise<{ ours: string[]; foodics: string[] }> {
  const [ours, foodics] = await Promise.all([
    conn.execute<{ day: string }>(sql`select period_end::text as day from inventory_counts where status = 'FINALISED'`),
    /* عدٌّ بصنفٍ أو اثنين تصحيحٌ في وسط الأسبوع لا جرد */
    conn.execute<{ day: string }>(sql`
      select c.stock_day as day from foodics_stock_counts c
        join foodics_stock_count_items i on i.count_id = c.id
       group by c.stock_day having count(distinct i.item_id) >= 10
    `),
  ]);
  return { ours: ours.rows.map((r) => r.day), foodics: foodics.rows.map((r) => r.day) };
}

/**
 * المعدودُ في يومٍ لكلّ صنف بالمِلّي المعياريّ، ومصدرُه. جردُنا المقفَل يغلب صنفاً صنفاً،
 * وما لم يكن في نطاقه يسدّه عدُّ فودكس لتلك الليلة.
 */
export async function loadCountAt(day: string, stock: ReadonlyMap<string, { id: string; baseUnit: StoredUnit }>, conn: Conn): Promise<{ values: Map<string, number>; source: CountSource | null }> {
  /* عدّان في الليلة نفسِها: الأحدثُ يغلب لكلّ صنف */
  const rows = await conn.execute<{ sku: string | null; quantity_milli: string; factor_milli: string | null }>(sql`
    select distinct on (i.item_id) i.sku, i.quantity_milli::text, i.factor_milli::text
      from foodics_stock_count_items i join foodics_stock_counts c on c.id = i.count_id
     where c.stock_day = ${day}
     order by i.item_id, c.counted_at desc nulls last
  `);
  const values = new Map<string, number>();
  for (const r of rows.rows) {
    const product = r.sku ? stock.get(r.sku) : undefined;
    if (!product || r.factor_milli === null) continue;
    /* مِلّي‑وحدةِ‑تخزين × مِلّي‑معامِل ÷ ألف = مِلّي من وحدة الصرف، وهي وحدةُ أساس الصنف */
    values.set(product.id, toCanonical(Math.round((Number(r.quantity_milli) * Number(r.factor_milli)) / 1000), product.baseUnit));
  }
  const ours = await conn.execute<{ product_id: string; actual: string | null }>(sql`
    select l.product_id, l.actual_milli::text as actual
      from inventory_count_lines l join inventory_counts c on c.id = l.count_id
     where c.status = 'FINALISED' and c.period_end = ${day} and l.actual_milli is not null and l.in_scope
  `);
  for (const r of ours.rows) values.set(r.product_id, Number(r.actual));
  return { values, source: ours.rows.length > 0 ? "OURS" : rows.rows.length > 0 ? "FOODICS" : null };
}

export async function loadStockFlow(window: StockWindow, conn: Conn = db): Promise<StockFlow> {
  const stock = await conn
    .select({ id: products.id, name: products.nameAr, baseUnit: products.baseUnit, sku: products.foodicsItemSku, packMilli: products.catalogPackMilli })
    .from(products)
    .where(and(eq(products.isStockItem, true), eq(products.isActive, true)));
  const baseUnitOf = new Map(stock.map((p) => [p.id, p.baseUnit] as const));
  const bySku = new Map(stock.flatMap((p) => (p.sku ? [[p.sku, { id: p.id, baseUnit: p.baseUnit }] as const] : [])));

  const versions = await loadRecipeVersions(conn);
  const soldLines = await loadSoldForReport(window.from, window.to, versions, conn);
  const consumption = computeConsumption(soldLines, indexRecipeVersions(versions));
  /* مكوّنٌ تذكره وصفةٌ ما — «لم يُبَع ما يصل إليه» صفرٌ بدليل، وغيرُه مجهول */
  const reached = new Set(versions.flatMap((v) => v.ingredients.map((g) => g.productId)));

  const purchases = await loadPurchaseLines(window.from, window.to, conn);
  const summary = summarisePurchases(purchases.inPeriod, (id) => baseUnitOf.get(id) ?? null);
  const lastCost = fallbackCosts(purchases.lookback, baseUnitOf);
  const catalog = await catalogCosts(baseUnitOf, conn);
  const waste = await loadWaste(window.from, window.to, null, conn);

  const [everLinked, nonStock, opening, closing, moves, moveDays, witnessBuys] = await Promise.all([
    conn.execute<{ product_id: string }>(sql`select distinct product_id from supplier_products where product_id is not null`),
    conn.execute<{ id: string }>(sql`select id from products where is_stock_item = false`),
    window.openingCountDay ? loadCountAt(window.openingCountDay, bySku, conn) : Promise.resolve({ values: new Map<string, number>(), source: null }),
    window.closingCountDay ? loadCountAt(window.closingCountDay, bySku, conn) : Promise.resolve({ values: new Map<string, number>(), source: null }),
    conn.execute<{ sku: string | null; kind: number; milli: string | null; unknown: number }>(sql`
      select sku, kind, sum(ingredient_milli)::text as milli, count(*) filter (where ingredient_milli is null)::int as unknown
        from foodics_item_moves
       where business_date >= ${window.from} and business_date <= ${window.to}
       group by sku, kind
    `),
    conn.execute<{ n: number }>(sql`select count(*)::int as n from foodics_move_days where business_date >= ${window.from} and business_date <= ${window.to}`),
    conn.execute<{ sku: string | null; milli: string }>(sql`
      select i.sku, sum(case when p.type = 4 then -i.quantity_milli else i.quantity_milli end)::text as milli
        from foodics_purchase_items i join foodics_purchases p on p.id = i.purchase_id
       where p.business_date >= ${window.from} and p.business_date <= ${window.to}
       group by i.sku
    `),
  ]);
  const linkedSet = new Set(everLinked.rows.map((r) => r.product_id));
  const nonStockSet = new Set(nonStock.rows.map((r) => r.id));
  const days = daysBetween(window.from, window.to) + 1;
  const witnessComplete = Number(moveDays.rows[0]?.n ?? 0) >= days;

  const moveOf = (sku: string | null, kind: number): number | null => {
    if (!sku || !witnessComplete) return null;
    const row = moves.rows.find((m) => m.sku === sku && m.kind === kind);
    if (!row) return 0;
    return row.unknown > 0 || row.milli === null ? null : Number(row.milli);
  };
  const unmeasured = new Map<string, { lines: number; minor: number }>();
  for (const g of summary.gaps) {
    if (!g.productId || g.reason === "UNLINKED_PRODUCT") continue;
    const acc = unmeasured.get(g.productId) ?? { lines: 0, minor: 0 };
    acc.lines++; acc.minor += g.lineTotalMinor;
    unmeasured.set(g.productId, acc);
  }

  const items = stock.map((p) => {
    const bought = summary.byProduct.get(p.id);
    const used = consumption.byIngredient.get(p.id);
    const periodRate = unitCostMilliMinor(bought, p.baseUnit, null);
    const last = lastCost.get(p.id) ?? null;
    const cat = catalog.get(p.id) ?? null;
    const [rateMilliMinor, costBasis]: [number | null, CostBasis | null] =
      periodRate !== null ? [periodRate, "PERIOD_PURCHASES"] : last !== null ? [last, "LAST_INVOICE"] : cat !== null ? [cat, "CATALOG"] : [null, null];
    const sold = moveOf(p.sku, 8);
    const returned = moveOf(p.sku, 9);
    const witnessBuy = witnessBuys.rows.find((w) => w.sku !== null && w.sku === p.sku);
    const gap = unmeasured.get(p.id);
    return buildFlowItem({
      productId: p.id, name: p.name, baseUnit: p.baseUnit,
      purchasedMilli: bought?.canonicalMilli ?? 0,
      purchasedMinor: bought?.knownCostMinor ?? 0,
      unmeasuredLines: gap?.lines ?? 0, unmeasuredMinor: gap?.minor ?? 0,
      everLinked: linkedSet.has(p.id),
      consumed: used
        ? { milli: used.canonicalMilli, salesMilli: used.fromSalesMilli, staffMilli: used.fromComplimentaryMilli, refundsMilli: used.fromRefundsMilli }
        : reached.has(p.id) && soldLines.length > 0 ? { milli: 0, salesMilli: 0, staffMilli: 0, refundsMilli: 0 } : null,
      unitConflict: (used?.unitConflict ?? null) !== null,
      wasteMilli: waste.get(p.id) ?? 0,
      openingMilli: opening.values.get(p.id) ?? null,
      closingMilli: closing.values.get(p.id) ?? null,
      rateMilliMinor, costBasis,
      witnessConsumedMilli: sold === null || returned === null ? null : toCanonical(sold - returned, p.baseUnit),
      witnessWasteMilli: ((w) => (w === null ? null : toCanonical(w, p.baseUnit)))(moveOf(p.sku, 10)),
      /* مِلّي‑وحدةِ‑تخزين × عبوةُ الكتالوج = وحدةُ الأساس؛ بلا عبوةٍ معروفة لا تحويل */
      witnessPurchasedMilli: p.packMilli === null ? null
        : toCanonical(Math.round((Number(witnessBuy?.milli ?? 0) * Number(p.packMilli)) / 1000), p.baseUnit),
    });
  });

  /* التغطية: ما رُبط بصنفٍ ليس مخزوناً (معدّات، خدمات) خارج المقام بقرار إنسان */
  const stockGaps = summary.gaps.filter((g) => !(g.productId && nonStockSet.has(g.productId)));
  const linkedMinor = [...summary.byProduct.values()].reduce((s, b) => s + b.knownCostMinor, 0);
  const invoiceLinesMinor = linkedMinor + stockGaps.reduce((s, g) => s + g.lineTotalMinor, 0);
  const totals = totalFlow(items);
  /* ما دخل الحسابَ فعلاً: صنفٌ أُخرجت مشترياتُه إلى «مجهول» لا يُعدّ مغطًّى ولو رُبط بعضُه */
  const measuredMinor = totals.purchasedMinor;

  return {
    window,
    openingSource: opening.source,
    closingSource: closing.source,
    items,
    totals,
    coverage: {
      invoiceLinesMinor, measuredMinor, bp: ratioBp(measuredMinor, invoiceLinesMinor), gaps: stockGaps,
      salesExcludedMinor: consumption.excluded.filter((e) => e.reason !== "VOID").reduce((s, e) => s + e.lineTotalMinor, 0),
      salesIncludedMinor: consumption.included.totalMinor,
      witnessDays: Number(moveDays.rows[0]?.n ?? 0), days,
    },
  };
}

/** نافذةُ الشهر من أيّام العدّ المعروفة وآخر يومِ بيع. */
export async function loadMonthWindow(month: string, conn: Conn = db): Promise<StockWindow> {
  const [days, last] = await Promise.all([
    loadCountDays(conn),
    conn.execute<{ day: string | null }>(sql`select max(business_date)::text as day from sales`),
  ]);
  return stockWindow(month, [...new Set([...days.ours, ...days.foodics])], last.rows[0]?.day ?? null);
}

export async function loadMonthStockFlow(month: string, conn: Conn = db): Promise<StockFlow> {
  return loadStockFlow(await loadMonthWindow(month, conn), conn);
}

/** نافذةُ كلّ الأشهر معاً: من أوّل عدٍّ إلى آخره — المخزونُ يتقاصّ فيها ويبقى الفاقد. */
export async function loadCumulativeStockFlow(conn: Conn = db): Promise<StockFlow | null> {
  const days = await loadCountDays(conn);
  const all = [...new Set([...days.ours, ...days.foodics])].sort();
  if (all.length < 2) return null;
  const first = all[0];
  const last = all[all.length - 1];
  return loadStockFlow({ month: "", from: addDays(first, 1), to: last, openingCountDay: first, closingCountDay: last }, conn);
}

/* ─────────────────────────── تفصيلُ صنف ─────────────────────────── */

export interface ItemDetail {
  flow: StockFlow;
  item: FlowItem | null;
  /** بنودُ فواتيرنا المربوطة به في النافذة. */
  purchases: { lineId: string; invoiceId: string; invoiceNumber: string; supplierName: string; day: string; description: string; canonicalMilli: number | null; lineTotalMinor: number }[];
  /** ما بِيع وصرف منه — صنفُ القائمة وكمّيّتُه وما استهلكه. */
  sales: { name: string; soldMilli: number; usedMilli: number; staffMilli: number }[];
}

export async function loadItemDetail(productId: string, window: StockWindow, conn: Conn = db): Promise<ItemDetail> {
  const flow = await loadStockFlow(window, conn);
  const item = flow.items.find((x) => x.productId === productId) ?? null;
  const versions = await loadRecipeVersions(conn);
  const index = indexRecipeVersions(versions);
  const [sold, bought] = await Promise.all([
    loadSoldForReport(window.from, window.to, versions, conn),
    loadPurchaseLines(window.from, window.to, conn),
  ]);
  const byMenu = new Map<string, typeof sold>();
  for (const line of sold) {
    if (line.isVoid || !line.menuProductId) continue;
    const key = line.menuProductId;
    const list = byMenu.get(key);
    if (list) list.push(line); else byMenu.set(key, [line]);
  }
  const sales: ItemDetail["sales"] = [];
  for (const lines of byMenu.values()) {
    const used = computeConsumption(lines, index).byIngredient.get(productId);
    if (!used || used.canonicalMilli === 0) continue;
    sales.push({
      name: lines[0].posProductName,
      soldMilli: lines.reduce((s, l) => s + (l.isRefund ? -l.quantityMilli : l.quantityMilli), 0),
      usedMilli: used.canonicalMilli, staffMilli: used.fromComplimentaryMilli,
    });
  }
  const baseUnit = item?.baseUnit ?? null;
  return {
    flow, item,
    purchases: bought.inPeriod.filter((l) => l.productId === productId).map((l) => {
      const one = baseUnit ? summarisePurchases([l], () => baseUnit).byProduct.get(productId) : undefined;
      return {
        lineId: l.lineId, invoiceId: l.invoiceId, invoiceNumber: l.invoiceNumber, supplierName: l.supplierName,
        day: l.invoiceDate, description: l.description, canonicalMilli: one?.canonicalMilli ?? null, lineTotalMinor: l.lineTotalMinor,
      };
    }),
    sales: sales.sort((a, b) => b.usedMilli - a.usedMilli),
  };
}

/** أشهرُ البيع المعروفة، الأحدثُ أوّلاً. */
export async function loadFlowMonths(conn: Conn = db): Promise<string[]> {
  const rows = await conn.execute<{ month: string }>(sql`select distinct to_char(business_date, 'YYYY-MM') as month from sales order by 1 desc`);
  return rows.rows.map((r) => r.month);
}
