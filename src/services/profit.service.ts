/**
 * دفترُ الربح — **الموضعُ الواحد** الذي يُحسَب فيه كلُّ رقمٍ في المساحة الماليّة.
 *
 * الشاشاتُ تستدعيه ولا تحسب: قائمةُ الدخل، ومقارنةُ الأشهر، والقراءةُ الذكيّة، وتقريرُ
 * المحاسب تقرأ `loadPnl` نفسَها، فلا شاشتان تجيبان «كم ربحتُ؟» برقمين.
 *
 * من أين كلُّ عنصر:
 *   - **الإيراد**: ما دفعه الزبائن — دفعاتُ طلبات فودكس غيرُ «House Account» بعد المرتجَع
 *     (الرقمُ الذي يُقابَل بتسويات البنك في `/money/foodics`) — ناقصاً ضريبةَ المبيعات كما
 *     قيّدها مجالُ المبيعات. مشروباتُ الموظّفين لا إيرادَ لها.
 *   - **المشتريات**: صافي فواتيرنا بتاريخ دخول بضاعتها، بلا الأصول الثابتة.
 *   - **المخزون**: ما عُدّ على الرفّ في طرفَي الشهر (`stock-flow.service.ts`) مقوَّماً بآخر
 *     كلفةٍ معروفة عند آخره — معدَّلٌ واحد للطرفين، فتغيّرُ السعر لا يصير تكلفة.
 *   - **المصروفات**: جدولُ `expenses` بشهره، ناقصاً ما ليس مصروفاً (ضريبةُ الرسوم، سدادُ
 *     الهيئة)، ومعه ما أقرّه المالك (`finance_declarations`).
 *
 * قراءةٌ وحدها: لا يُنشئ قيداً ولا يمسّ مالاً مقيَّداً. والتجميدُ (`freezePnl`) يحفظ
 * التقريرَ نفسَه لا رقماً في دفتر.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { financeDeclarations, financeSnapshots, monthCloses, products } from "@/db/schema";
import { isTxCategory, type TxCategory } from "@/lib/bank/rules";
import { computeConsumption, type SoldLineInput } from "@/lib/inventory/consumption";
import { varianceCostMinor } from "@/lib/inventory/purchases";
import { indexRecipeVersions, type RecipeVersionInput } from "@/lib/inventory/recipe";
import { toCanonical } from "@/lib/inventory/units";
import {
  buildPnl, isTaxSettlement, RECOVERABLE_VAT, spreadShare,
  type ExcludedRow, type OpexRow, type Pnl, type PnlInput, type StockCogs,
} from "@/lib/finance/pnl";
import { previousMonth, stockWindow, type StockWindow } from "@/lib/finance/stock-window";
import { addDays, currentMonthRiyadh, daysBetween, daysInMonth, monthEndDay, todayInRiyadh } from "@/lib/riyadh-time";
import type { StoredUnit } from "@/lib/unit-conversion";
import { recordAudit } from "@/lib/audit";
import { catalogCosts, latestInvoiceUnitCosts, loadSoldForReport, loadWaste } from "./inventory.service";
import { loadRecipeVersions } from "./recipe.service";
import { loadCountDays } from "./stock-flow.service";
import { coverageOf } from "./vat-return.service";
import type { Conn } from "./types";

/* ─────────────────────────── الإيراد ─────────────────────────── */

export interface MonthRevenue {
  month: string;
  /** ما دفعه الزبائن بعد المرتجَع، شاملاً الضريبة. */
  paidMinor: number;
  cashMinor: number;
  cardMinor: number;
  vatMinor: number;
  /** ما رُدّ للزبائن (موجباً) وخصمُ الطلبات — للعرض. */
  refundsMinor: number;
  discountMinor: number;
  /** مشروباتُ الموظّفين بسعر القائمة — ليست إيراداً. */
  staffListMinor: number;
  orders: number;
  coveredDays: number;
  expectedDays: number;
}

/** أيّامُ الشهر المنتظَرة: من أوّل يومِ بيعٍ عرفناه (شهرُ الافتتاح) وحتى أمس للشهر الجاري. */
function expectedDays(month: string, firstDay: string, today: string): number {
  const start = firstDay > `${month}-01` ? firstDay : `${month}-01`;
  const monthEnd = monthEndDay(month);
  const end = today <= monthEnd ? addDays(today, -1) : monthEnd;
  return end < start ? 0 : daysBetween(start, end) + 1;
}

export async function loadRevenue(conn: Conn = db): Promise<Map<string, MonthRevenue>> {
  const [pay, vat, heads] = await Promise.all([
    conn.execute<{ month: string; paid: string; cash: string; card: string; refunds: string; staff: string }>(sql`
      select substr(o.business_date, 1, 7) as month,
             coalesce(sum(p.amount_minor) filter (where p.method_type <> 5), 0)::bigint as paid,
             coalesce(sum(p.amount_minor) filter (where p.method_type = 1), 0)::bigint as cash,
             coalesce(sum(p.amount_minor) filter (where p.method_type not in (1, 5)), 0)::bigint as card,
             coalesce(-sum(p.amount_minor) filter (where p.method_type <> 5 and p.amount_minor < 0), 0)::bigint as refunds,
             coalesce(sum(p.amount_minor) filter (where p.method_type = 5), 0)::bigint as staff
        from foodics_orders o join foodics_order_payments p on p.order_id = o.id
       where o.status in (4, 5)
       group by 1
    `),
    conn.execute<{ month: string; vat: string }>(sql`
      select to_char(business_date, 'YYYY-MM') as month, coalesce(sum(vat_minor), 0)::bigint as vat
        from sales where is_void = false group by 1
    `),
    conn.execute<{ month: string; discount: string; orders: number; days: number; first_day: string }>(sql`
      select substr(business_date, 1, 7) as month,
             coalesce(sum(discount_minor) filter (where status = 4), 0)::bigint as discount,
             count(*) filter (where status = 4)::int as orders,
             count(distinct business_date) filter (where status in (4, 5))::int as days,
             (select min(business_date) from foodics_orders) as first_day
        from foodics_orders group by 1
    `),
  ]);
  const headOf = new Map(heads.rows.map((r) => [r.month, r]));
  const vatOf = new Map(vat.rows.map((r) => [r.month, Number(r.vat)]));
  const today = todayInRiyadh();
  return new Map(pay.rows.flatMap((r) => {
    const head = headOf.get(r.month);
    if (!head) return [];
    return [[r.month, {
      month: r.month,
      paidMinor: Number(r.paid), cashMinor: Number(r.cash), cardMinor: Number(r.card),
      vatMinor: vatOf.get(r.month) ?? 0,
      refundsMinor: Number(r.refunds), discountMinor: Number(head.discount), staffListMinor: Number(r.staff),
      orders: head.orders, coveredDays: head.days, expectedDays: expectedDays(r.month, head.first_day, today),
    }] as const];
  }));
}

/**
 * أيّامٌ قرأتها المزامنة: مدى كلّ تعبئةٍ ناجحة، وكلُّ يومٍ منذ أوّل مزامنةٍ جارية ناجحة.
 * يُرجع عدّاداً للأيّام المقروءة في مدى — بها يُفرَّق «مغلق» عن «لم يُقرأ».
 */
async function loadReadDays(conn: Conn): Promise<(from: string, to: string) => number> {
  const runs = await conn.execute<{ scope: string; day: string }>(sql`
    select scope, to_char(started_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as day
      from foodics_sync_runs where status = 'OK'
  `);
  const ranges: [string, string][] = [];
  let incrementalFrom: string | null = null;
  let incrementalTo: string | null = null;
  for (const r of runs.rows) {
    const m = /^WINDOW (\d{4}-\d{2}-\d{2})→(\d{4}-\d{2}-\d{2})$/.exec(r.scope);
    if (m) ranges.push([m[1], m[2]]);
    else if (r.scope === "INCREMENTAL") {
      if (incrementalFrom === null || r.day < incrementalFrom) incrementalFrom = r.day;
      if (incrementalTo === null || r.day > incrementalTo) incrementalTo = r.day;
    }
  }
  if (incrementalFrom !== null && incrementalTo !== null) ranges.push([incrementalFrom, incrementalTo]);
  return (from, to) => {
    let n = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) if (ranges.some(([a, b]) => d >= a && d <= b)) n++;
    return n;
  };
}

/* ─────────────────────────── المشتريات ─────────────────────────── */

const EFFECTIVE_DAY = sql`coalesce(i.received_on, to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD'))`;
/** صافي الفاتورة: المقروء، وإلّا الإجماليّ ناقصاً ضريبتَه، وإلّا الإجماليّ (ويُعَدّ). */
const INVOICE_NET = sql`(case when i.subtotal_minor is not null then i.subtotal_minor when i.vat_minor is not null then i.total_minor - i.vat_minor else i.total_minor end)`;

interface PurchaseDay { day: string; netMinor: number; invoices: number; grossOnly: number }

async function loadPurchaseDays(from: string, to: string, conn: Conn): Promise<PurchaseDay[]> {
  const rows = await conn.execute<{ day: string; net: string; n: number; gross_only: number }>(sql`
    select ${EFFECTIVE_DAY} as day, sum(${INVOICE_NET})::bigint as net, count(*)::int as n,
           count(*) filter (where i.subtotal_minor is null and i.vat_minor is null)::int as gross_only
      from invoices i
     where i.is_fixed_asset = false and ${EFFECTIVE_DAY} >= ${from} and ${EFFECTIVE_DAY} <= ${to}
     group by 1
  `);
  return rows.rows.map((r) => ({ day: r.day, netMinor: Number(r.net), invoices: r.n, grossOnly: r.gross_only }));
}

export interface PurchaseInvoiceRow {
  id: string;
  invoiceNumber: string;
  supplierName: string;
  day: string;
  netMinor: number;
  /** لم يُقرأ صافيها ولا ضريبتُها — دخلت بإجماليّها. */
  grossOnly: boolean;
}

/** فواتيرُ المدى التي كوّنت رقمَ المشتريات — بتاريخ دخول بضاعتها. */
export async function loadPurchaseInvoices(from: string, to: string, conn: Conn = db): Promise<PurchaseInvoiceRow[]> {
  const rows = await conn.execute<{ id: string; invoice_number: string; supplier_name: string; day: string; net: string; gross_only: boolean }>(sql`
    select i.id, i.invoice_number, su.name_ar as supplier_name, ${EFFECTIVE_DAY} as day, ${INVOICE_NET}::bigint as net,
           (i.subtotal_minor is null and i.vat_minor is null) as gross_only
      from invoices i join suppliers su on su.id = i.supplier_id
     where i.is_fixed_asset = false and ${EFFECTIVE_DAY} >= ${from} and ${EFFECTIVE_DAY} <= ${to}
     order by ${INVOICE_NET} desc
  `);
  return rows.rows.map((r) => ({ id: r.id, invoiceNumber: r.invoice_number, supplierName: r.supplier_name, day: r.day, netMinor: Number(r.net), grossOnly: Boolean(r.gross_only) }));
}

/** حركاتُ البنك الصادرة من فئة — مرشّحاتُ «وزِّعها على أشهر». */
export async function loadSpreadCandidates(category: TxCategory, conn: Conn = db): Promise<{ id: string; day: string; amountMinor: number; label: string; spread: boolean }[]> {
  const rows = await conn.execute<{ id: string; day: string; amount_minor: number; label: string | null; spread: boolean }>(sql`
    select bt.id, to_char(bt.value_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as day, bt.amount_minor,
           coalesce(nullif(bt.beneficiary_raw, ''), left(bt.description, 60)) as label,
           exists (select 1 from finance_declarations d where d.bank_transaction_id = bt.id and d.voided_at is null and d.kind = 'SPREAD') as spread
      from bank_transactions bt
     where bt.direction = 'DEBIT' and bt.category::text = ${category}
     order by bt.value_date desc limit 60
  `);
  return rows.rows.map((r) => ({ id: r.id, day: r.day, amountMinor: r.amount_minor, label: r.label ?? "حركة بنك", spread: Boolean(r.spread) }));
}

/* ─────────────────────────── الاستهلاكُ النظريّ يوماً بيوم ─────────────────────────── */

interface StockBasics {
  baseUnitOf: Map<string, StoredUnit>;
  bySku: Map<string, { id: string; name: string; baseUnit: StoredUnit }>;
  nameOf: Map<string, string>;
}

async function loadStockBasics(conn: Conn): Promise<StockBasics> {
  const rows = await conn
    .select({ id: products.id, name: products.nameAr, baseUnit: products.baseUnit, sku: products.foodicsItemSku })
    .from(products).where(eq(products.isStockItem, true));
  return {
    baseUnitOf: new Map(rows.map((p) => [p.id, p.baseUnit])),
    bySku: new Map(rows.flatMap((p) => (p.sku ? [[p.sku, { id: p.id, name: p.name, baseUnit: p.baseUnit }] as const] : []))),
    nameOf: new Map(rows.map((p) => [p.id, p.name])),
  };
}

/** معدَّلُ كلفة كلّ صنف حتى يوم: آخرُ فاتورةٍ معروفة، وإلّا كلفةُ الكتالوج. */
export async function loadRates(asOf: string, baseUnitOf: ReadonlyMap<string, StoredUnit>, conn: Conn = db): Promise<Map<string, number>> {
  const [invoice, catalog] = await Promise.all([latestInvoiceUnitCosts(asOf, conn), catalogCosts(baseUnitOf, conn)]);
  const out = new Map<string, number>();
  for (const [id, rate] of catalog) if (rate !== null && rate > 0) out.set(id, rate);
  for (const [id, rate] of invoice) out.set(id, rate);
  return out;
}

interface DayCost { minor: number; staffMinor: number; unpricedMilli: number }

function dailyTheoretical(
  lines: readonly SoldLineInput[],
  versions: Map<string, RecipeVersionInput[]>,
  rates: ReadonlyMap<string, number>,
  baseUnitOf: ReadonlyMap<string, StoredUnit>,
): Map<string, DayCost> {
  const byDay = new Map<string, SoldLineInput[]>();
  for (const line of lines) {
    const list = byDay.get(line.businessDate);
    if (list) list.push(line); else byDay.set(line.businessDate, [line]);
  }
  const out = new Map<string, DayCost>();
  for (const [day, dayLines] of byDay) {
    const used = computeConsumption(dayLines, versions);
    const acc: DayCost = { minor: 0, staffMinor: 0, unpricedMilli: 0 };
    for (const ing of used.byIngredient.values()) {
      const base = baseUnitOf.get(ing.productId);
      const rate = rates.get(ing.productId) ?? null;
      if (!base || ing.unitConflict !== null) continue;
      const cost = varianceCostMinor(ing.canonicalMilli, rate, base);
      if (cost === null) { acc.unpricedMilli += ing.canonicalMilli; continue; }
      acc.minor += cost;
      acc.staffMinor += varianceCostMinor(ing.fromComplimentaryMilli, rate, base) ?? 0;
    }
    out.set(day, acc);
  }
  return out;
}

function sumDays<T>(map: ReadonlyMap<string, T>, from: string, to: string, pick: (v: T) => number): number {
  let total = 0;
  for (const [day, v] of map) if (day >= from && day <= to) total += pick(v);
  return total;
}

/* ─────────────────────────── تكلفةُ المبيعات بالجرد ─────────────────────────── */

/** قفزةٌ بين عدَّين فوق هذا الضِعف وهذه القيمة خطأُ إدخالٍ على الأرجح — يُخرَج الصنفُ ويُسمّى. */
const SUSPECT_MULTIPLE = 20;
const SUSPECT_FLOOR_MINOR = 1_000_00;

async function countValuesAt(day: string, basics: StockBasics, conn: Conn): Promise<Map<string, number>> {
  const rows = await conn.execute<{ sku: string | null; quantity_milli: string; factor_milli: string | null }>(sql`
    select distinct on (i.item_id) i.sku, i.quantity_milli::text, i.factor_milli::text
      from foodics_stock_count_items i join foodics_stock_counts c on c.id = i.count_id
     where c.stock_day = ${day}
     order by i.item_id, c.counted_at desc nulls last
  `);
  const values = new Map<string, number>();
  for (const r of rows.rows) {
    const product = r.sku ? basics.bySku.get(r.sku) : undefined;
    if (!product || r.factor_milli === null) continue;
    values.set(product.id, toCanonical(Math.round((Number(r.quantity_milli) * Number(r.factor_milli)) / 1000), product.baseUnit));
  }
  const ours = await conn.execute<{ product_id: string; actual: string }>(sql`
    select l.product_id, l.actual_milli::text as actual
      from inventory_count_lines l join inventory_counts c on c.id = l.count_id
     where c.status = 'FINALISED' and c.period_end = ${day} and l.actual_milli is not null and l.in_scope
  `);
  for (const r of ours.rows) values.set(r.product_id, Number(r.actual));
  return values;
}

export interface StockCogsDetail extends StockCogs {
  /** الأصنافُ التي كوّنت فرقَ المخزون — للنقر. */
  items: { productId: string; name: string; openingMinor: number; closingMinor: number }[];
  purchasesMonthMinor: number;
}

async function stockCogs(
  month: string, window: StockWindow, basics: StockBasics, rates: ReadonlyMap<string, number>,
  purchases: readonly PurchaseDay[], theoretical: ReadonlyMap<string, DayCost>, conn: Conn,
): Promise<{ cogs: StockCogsDetail | null; missing: string | null }> {
  if (!window.openingCountDay) return { cogs: null, missing: "لا عدَّ قرب أوّل الشهر" };
  if (!window.closingCountDay) return { cogs: null, missing: "لا عدَّ قرب آخر الشهر" };
  const [open, close] = await Promise.all([
    countValuesAt(window.openingCountDay, basics, conn),
    countValuesAt(window.closingCountDay, basics, conn),
  ]);
  const items: StockCogsDetail["items"] = [];
  const suspectItems: string[] = [];
  for (const [productId, openMilli] of open) {
    const closeMilli = close.get(productId);
    const base = basics.baseUnitOf.get(productId);
    const rate = rates.get(productId) ?? null;
    if (closeMilli === undefined || !base) continue;
    const openingMinor = varianceCostMinor(openMilli, rate, base);
    const closingMinor = varianceCostMinor(closeMilli, rate, base);
    if (openingMinor === null || closingMinor === null) continue;
    const name = basics.nameOf.get(productId) ?? productId;
    const [small, large] = openMilli < closeMilli ? [openMilli, closeMilli] : [closeMilli, openMilli];
    if (large > small * SUSPECT_MULTIPLE && Math.abs(openingMinor - closingMinor) >= SUSPECT_FLOOR_MINOR) {
      suspectItems.push(name);
      continue;
    }
    items.push({ productId, name, openingMinor, closingMinor });
  }
  if (items.length === 0) return { cogs: null, missing: "لا صنفَ عُدّ في الطرفين وله كلفةٌ معروفة" };

  const openingValueMinor = items.reduce((s, x) => s + x.openingMinor, 0);
  const closingValueMinor = items.reduce((s, x) => s + x.closingMinor, 0);
  const P = (from: string, to: string) => (from > to ? 0 : purchases.filter((p) => p.day >= from && p.day <= to).reduce((s, p) => s + p.netMinor, 0));
  const B = (from: string, to: string) => (from > to ? 0 : sumDays(theoretical, from, to, (v) => v.minor));
  /* مخزونُ طرف التقويم = المعدود ± ما اشتُري وما صُرف نظريّاً في الأيّام بينهما */
  const rollTo = (boundary: string, countDay: string, value: number) =>
    countDay <= boundary
      ? value + P(addDays(countDay, 1), boundary) - B(addDays(countDay, 1), boundary)
      : value - P(addDays(boundary, 1), countDay) + B(addDays(boundary, 1), countDay);

  const monthStart = `${month}-01`;
  const monthEnd = monthEndDay(month);
  const eve = addDays(monthStart, -1);
  const purchasesMonthMinor = P(monthStart, monthEnd);
  const minor = purchasesMonthMinor
    + rollTo(eve, window.openingCountDay, openingValueMinor)
    - rollTo(monthEnd, window.closingCountDay, closingValueMinor);
  return {
    cogs: {
      minor,
      openingDay: window.openingCountDay, closingDay: window.closingCountDay,
      adjustedDays: Math.abs(daysBetween(eve, window.openingCountDay)) + Math.abs(daysBetween(monthEnd, window.closingCountDay)),
      countedItems: items.length, openingValueMinor, closingValueMinor, suspectItems,
      items: items.sort((a, b) => Math.abs(b.openingMinor - b.closingMinor) - Math.abs(a.openingMinor - a.closingMinor)),
      purchasesMonthMinor,
    },
    missing: null,
  };
}

/* ─────────────────────────── المصروفات وإقراراتُ المالك ─────────────────────────── */

export interface Declaration {
  id: string;
  kind: "SPREAD" | "OFF_BOOK" | "NONE";
  category: TxCategory;
  label: string;
  amountMinor: number;
  fromMonth: string;
  toMonth: string;
  bankTransactionId: string | null;
  note: string | null;
  createdAt: Date;
}

export async function loadDeclarations(conn: Conn = db): Promise<Declaration[]> {
  const rows = await conn.select().from(financeDeclarations).where(isNull(financeDeclarations.voidedAt));
  return rows.flatMap((r) => (isTxCategory(r.category) ? [{
    id: r.id, kind: r.kind, category: r.category, label: r.label, amountMinor: r.amountMinor,
    fromMonth: r.fromMonth, toMonth: r.toMonth, bankTransactionId: r.bankTransactionId, note: r.note, createdAt: r.createdAt,
  }] : []));
}

export interface ExpenseRowView extends OpexRow {
  id: string;
  occurredOn: string | null;
  bankTransactionId: string | null;
  declarationId: string | null;
}

async function loadOpex(month: string, declarations: readonly Declaration[], conn: Conn): Promise<{ opex: ExpenseRowView[]; excluded: (ExcludedRow & { id: string })[]; declaredNone: TxCategory[]; ownerDrawsMinor: number }> {
  const [rows, draws] = await Promise.all([
    conn.execute<{ id: string; category: string; label: string; amount_minor: number; source: string; occurred_on: string; bank_transaction_id: string | null; description: string | null; beneficiary: string | null }>(sql`
      select e.id, e.category::text as category, e.label, e.amount_minor, e.source::text as source, e.occurred_on,
             e.bank_transaction_id, bt.description, bt.beneficiary_raw as beneficiary
        from expenses e left join bank_transactions bt on bt.id = e.bank_transaction_id
       where e.period_month = ${month}
       order by e.amount_minor desc
    `),
    conn.execute<{ total: string }>(sql`
      select coalesce(sum(amount_minor), 0)::bigint as total from bank_transactions
       where direction = 'DEBIT' and category = 'PERSONAL'
         and to_char(value_date at time zone 'Asia/Riyadh', 'YYYY-MM') = ${month}
    `),
  ]);
  const spreadTx = new Map(declarations.filter((d) => d.kind === "SPREAD" && d.bankTransactionId).map((d) => [d.bankTransactionId, d]));
  const opex: ExpenseRowView[] = [];
  const excluded: (ExcludedRow & { id: string })[] = [];
  for (const r of rows.rows) {
    if (!isTxCategory(r.category)) continue;
    const source = r.source === "INVOICE" ? "INVOICE" as const : r.source === "MANUAL" ? "MANUAL" as const : "BANK" as const;
    if (RECOVERABLE_VAT.has(r.category)) {
      excluded.push({ id: r.id, label: r.label, amountMinor: r.amount_minor, reason: "ضريبةُ رسومٍ تُخصَم في الإقرار" });
    } else if (r.category === "GOVERNMENT" && isTaxSettlement(r.description, r.beneficiary, r.label)) {
      excluded.push({ id: r.id, label: r.label, amountMinor: r.amount_minor, reason: "سدادٌ لهيئة الزكاة والضريبة — تسويةُ ضريبةٍ لا مصروف" });
    } else if (r.bank_transaction_id && spreadTx.has(r.bank_transaction_id)) {
      /* دفعةٌ وُزّعت على أشهر: تخرج من شهر دفعها وتدخل حصصاً أدناه */
    } else {
      opex.push({ id: r.id, category: r.category, label: r.label, amountMinor: r.amount_minor, source, occurredOn: r.occurred_on, bankTransactionId: r.bank_transaction_id, declarationId: null });
    }
  }
  const declaredNone: TxCategory[] = [];
  for (const d of declarations) {
    if (month < d.fromMonth || month > d.toMonth) continue;
    if (d.kind === "NONE") declaredNone.push(d.category);
    else {
      const amountMinor = d.kind === "SPREAD" ? spreadShare(d.amountMinor, d.fromMonth, d.toMonth, month) : d.amountMinor;
      if (amountMinor > 0) opex.push({ id: `decl-${d.id}`, category: d.category, label: d.label, amountMinor, source: d.kind, occurredOn: null, bankTransactionId: d.bankTransactionId, declarationId: d.id });
    }
  }
  return { opex, excluded, declaredNone, ownerDrawsMinor: Number(draws.rows[0]?.total ?? 0) };
}

/* ─────────────────────────── قائمةُ الشهر ─────────────────────────── */

export interface PnlView {
  month: string;
  pnl: Pnl;
  input: PnlInput;
  revenue: MonthRevenue | null;
  window: StockWindow;
  stock: StockCogsDetail | null;
  opexRows: ExpenseRowView[];
  excludedRows: (ExcludedRow & { id: string })[];
  closed: boolean;
  /** مجمَّدٌ؟ ومتى — و`stale` إن خالف الحيُّ المجمَّدَ في الربح أو الإيراد. */
  frozenAt: Date | null;
  stale: boolean;
}

interface Shared {
  revenue: Map<string, MonthRevenue>;
  basics: StockBasics;
  versions: Map<string, RecipeVersionInput[]>;
  rawVersions: RecipeVersionInput[];
  /** أيّامٌ قُرئت من فودكس ولو بلا طلب — يومٌ مغلقٌ ليس يوماً غائباً. */
  readDays: (from: string, to: string) => number;
  countDays: string[];
  lastSaleDay: string | null;
  declarations: Declaration[];
  closed: Set<string>;
}

async function loadShared(conn: Conn): Promise<Shared> {
  const [revenue, basics, versions, days, last, declarations, closes] = await Promise.all([
    loadRevenue(conn), loadStockBasics(conn), loadRecipeVersions(conn), loadCountDays(conn),
    conn.execute<{ day: string | null }>(sql`select max(business_date)::text as day from sales`),
    loadDeclarations(conn),
    conn.select({ month: monthCloses.month }).from(monthCloses).where(eq(monthCloses.status, "CLOSED")),
  ]);
  return {
    revenue, basics, versions: indexRecipeVersions(versions), rawVersions: versions,
    readDays: await loadReadDays(conn),
    countDays: [...new Set([...days.ours, ...days.foodics])],
    lastSaleDay: last.rows[0]?.day ?? null, declarations,
    closed: new Set(closes.map((c) => c.month)),
  };
}

async function computePnl(month: string, shared: Shared, conn: Conn): Promise<Omit<PnlView, "frozenAt" | "stale">> {
  const today = todayInRiyadh();
  const monthStart = `${month}-01`;
  const monthEnd = monthEndDay(month);
  const open = today <= monthEnd;
  const window = stockWindow(month, shared.countDays, shared.lastSaleDay);
  /* المدى الأوسع بين التقويم ونافذة العدّ — منه تُسدّ أيّامُ الفرق */
  const from = window.from < monthStart ? window.from : monthStart;
  const to = window.to > monthEnd ? window.to : monthEnd;

  const rates = await loadRates(monthEnd < today ? monthEnd : today, shared.basics.baseUnitOf, conn);
  const [soldLines, purchases, waste, coverage, opexData, foodics] = await Promise.all([
    loadSoldForReport(from, to, shared.rawVersions, conn),
    loadPurchaseDays(from, to, conn),
    loadWaste(monthStart, monthEnd, null, conn),
    coverageOf([month], conn),
    loadOpex(month, shared.declarations, conn),
    conn.execute<{ cost: string | null; days: number }>(sql`
      select (select sum(case when kind = 9 then -cost_micro when kind = 8 then cost_micro else 0 end)
                from foodics_item_moves where business_date >= ${monthStart} and business_date <= ${monthEnd})::text as cost,
             (select count(*) from foodics_move_days where business_date >= ${monthStart} and business_date <= ${monthEnd})::int as days
    `),
  ]);
  const theoretical = dailyTheoretical(soldLines, shared.versions, rates, shared.basics.baseUnitOf);
  const inMonth = purchases.filter((p) => p.day >= monthStart && p.day <= monthEnd);
  const stock = open
    ? { cogs: null, missing: "الشهرُ لم ينتهِ" }
    : await stockCogs(month, window, shared.basics, rates, purchases, theoretical, conn);

  const revenue = shared.revenue.get(month) ?? null;
  const hasSales = soldLines.some((l) => l.businessDate >= monthStart && l.businessDate <= monthEnd);
  let wasteMinor = 0;
  for (const [productId, milli] of waste) {
    const base = shared.basics.baseUnitOf.get(productId);
    if (base) wasteMinor += varianceCostMinor(milli, rates.get(productId) ?? null, base) ?? 0;
  }
  const expected = revenue?.expectedDays ?? daysInMonth(month);
  /* يومٌ قرأته المزامنةُ ولم تجد فيه طلباً يومٌ مغلق — لا يُعدّ ناقصاً */
  const covered = revenue ? Math.min(expected, Math.max(revenue.coveredDays, shared.readDays(monthStart, monthEnd))) : 0;
  const input: PnlInput = {
    month, open,
    revenue: revenue ? { paidMinor: revenue.paidMinor, vatMinor: revenue.vatMinor, coveredDays: covered, expectedDays: expected } : null,
    cogs: {
      purchasesMinor: inMonth.reduce((s, p) => s + p.netMinor, 0),
      purchasesInvoices: inMonth.reduce((s, p) => s + p.invoices, 0),
      purchasesGrossOnly: inMonth.reduce((s, p) => s + p.grossOnly, 0),
      theoreticalMinor: hasSales ? sumDays(theoretical, monthStart, monthEnd, (v) => v.minor) : null,
      stock: stock.cogs, stockMissing: stock.missing,
      /* شاهدُ فودكس يُقال للشهر الذي قُرئ صرفُه كلُّه وحده */
      foodicsMinor: foodics.rows[0]?.cost != null && Number(foodics.rows[0].days) >= expected && expected > 0
        ? Math.round(Number(foodics.rows[0].cost) / 1000) : null,
      wasteMinor,
      staffMinor: hasSales ? sumDays(theoretical, monthStart, monthEnd, (v) => v.staffMinor) : null,
    },
    opex: opexData.opex, excluded: opexData.excluded, declaredNone: opexData.declaredNone,
    bankGapDays: coverage[0]?.gapDays ?? null,
    ownerDrawsMinor: opexData.ownerDrawsMinor,
  };
  return {
    month, pnl: buildPnl(input), input, revenue, window, stock: stock.cogs,
    opexRows: opexData.opex, excludedRows: opexData.excluded, closed: shared.closed.has(month),
  };
}

type Frozen = Omit<PnlView, "frozenAt" | "stale">;

/** لقطةُ الشهر المقفل إن جُمِّدت — وتواريخُها نصوصٌ في JSON فتُردّ كما هي. */
async function readSnapshot(month: string, conn: Conn): Promise<{ view: Frozen; frozenAt: Date } | null> {
  const [row] = await conn.select().from(financeSnapshots).where(eq(financeSnapshots.month, month)).limit(1);
  if (!row) return null;
  /* اللقطةُ كتبها `freezePnl` من `computePnl` نفسِها — شكلُها شكلُه */
  return { view: row.payload as Frozen, frozenAt: row.frozenAt };
}

/**
 * قائمةُ دخل الشهر. الشهرُ المقفل المجمَّد يُقرأ من لقطته — **ثابتٌ لا يُعاد حسابُه** —
 * ويُقال إن خالفه الحسابُ الحيّ (فاتورةٌ متأخّرة، إقرارٌ جديد) ليُعاد تجميدُه بقرار.
 */
export async function loadPnl(month: string, conn: Conn = db, shared?: Shared, checkStale = true): Promise<PnlView> {
  const s = shared ?? await loadShared(conn);
  const snap = s.closed.has(month) ? await readSnapshot(month, conn) : null;
  /* في سلسلة الأشهر يكفي المجمَّد: لا يُعاد حسابُ ما ثبت ليُعرَض رقمُه */
  if (snap && !checkStale) return { ...snap.view, closed: true, frozenAt: snap.frozenAt, stale: false };
  const live = await computePnl(month, s, conn);
  if (!snap) return { ...live, frozenAt: null, stale: false };
  const stale = snap.view.pnl.profitMinor !== live.pnl.profitMinor || snap.view.pnl.revenueMinor !== live.pnl.revenueMinor
    || snap.view.pnl.profitLabel !== live.pnl.profitLabel;
  return { ...snap.view, closed: true, frozenAt: snap.frozenAt, stale };
}

/** الحسابُ الحيّ للشهر مهما كان مجمَّداً — ليُعرَض بجانب المجمَّد قبل إعادة التجميد. */
export async function loadLivePnl(month: string, conn: Conn = db): Promise<Frozen> {
  return computePnl(month, await loadShared(conn), conn);
}

/** أشهرُ المقهى من أوّل شهرِ بيعٍ إلى الجاري، الأحدثُ أوّلاً. */
export async function loadPnlSeries(conn: Conn = db): Promise<PnlView[]> {
  const shared = await loadShared(conn);
  const months = [...shared.revenue.keys()].sort();
  const current = currentMonthRiyadh();
  const first = months[0] ?? current;
  const all: string[] = [];
  for (let m = current; m >= first; m = previousMonth(m)) all.push(m);
  const out: PnlView[] = [];
  /* متتابعةٌ: كلُّ شهرٍ يحمّل أسطرَ مبيعاته، وستّةٌ معاً تزحم التجمّع */
  for (const m of all) out.push(await loadPnl(m, conn, shared, false));
  return out;
}

export class FreezeRefused extends Error {}

/** يجمّد قائمةَ دخل شهرٍ مقفل كما تُحسَب الآن. يُكتب في سجلّ التدقيق بطرفيه. */
export async function freezePnl(month: string, actorId: string | null): Promise<void> {
  const live = await loadLivePnl(month);
  if (!live.closed) throw new FreezeRefused("لا يُجمَّد تقريرُ شهرٍ لم يُقفَل — أقفِل الشهر أوّلاً.");
  await db.transaction(async (t) => {
    const [before] = await t.select().from(financeSnapshots).where(eq(financeSnapshots.month, month)).limit(1);
    await t.insert(financeSnapshots).values({ month, payload: live, frozenById: actorId })
      .onConflictDoUpdate({ target: financeSnapshots.month, set: { payload: live, frozenAt: new Date(), frozenById: actorId } });
    await recordAudit({
      actorId, action: "FINANCE_PNL_FROZEN", entityType: "finance_snapshot", entityId: month,
      before: before ? { profitMinor: (before.payload as Frozen).pnl.profitMinor, label: (before.payload as Frozen).pnl.profitLabel } : null,
      after: { profitMinor: live.pnl.profitMinor, label: live.pnl.profitLabel },
    }, t);
  });
}

/* ─────────────────────────── إقراراتُ المالك: الكتابة ─────────────────────────── */

export class DeclarationRefused extends Error {}

export interface NewDeclaration {
  kind: "SPREAD" | "OFF_BOOK" | "NONE";
  category: TxCategory;
  label: string;
  amountMinor: number;
  fromMonth: string;
  toMonth: string;
  bankTransactionId: string | null;
  note: string | null;
}

/** أشهرُ توزيعٍ فوق هذا خطأُ إدخالٍ على الأرجح. */
export const MAX_DECLARATION_MONTHS = 36;

export async function createDeclaration(input: NewDeclaration, actorId: string): Promise<string> {
  if (input.fromMonth > input.toMonth) throw new DeclarationRefused("آخرُ شهرٍ قبل أوّله.");
  const [fy, fm] = input.fromMonth.split("-").map(Number);
  const [ty, tm] = input.toMonth.split("-").map(Number);
  if ((ty - fy) * 12 + (tm - fm) + 1 > MAX_DECLARATION_MONTHS) throw new DeclarationRefused(`المدى أطولُ من ${MAX_DECLARATION_MONTHS} شهراً — راجِع الشهرين.`);
  return db.transaction(async (t) => {
    let amountMinor = input.amountMinor;
    const label = input.label.trim();
    if (input.kind === "SPREAD") {
      if (!input.bankTransactionId) throw new DeclarationRefused("اختر حركةَ البنك التي تُوزَّع.");
      /* المبلغُ من القاعدة لا من المتصفّح */
      const tx = (await t.execute<{ amount_minor: number; direction: string; category: string; month: string }>(sql`
        select amount_minor, direction::text as direction, category::text as category,
               to_char(value_date at time zone 'Asia/Riyadh', 'YYYY-MM') as month
          from bank_transactions where id = ${input.bankTransactionId}
      `)).rows[0];
      if (!tx || tx.direction !== "DEBIT") throw new DeclarationRefused("الحركةُ غير موجودة أو ليست صادرة.");
      if (tx.category !== input.category) throw new DeclarationRefused("فئةُ الحركة في الكشف غيرُ الفئة المختارة — صنّف الحركةَ أوّلاً.");
      if (tx.month < input.fromMonth || tx.month > input.toMonth) throw new DeclarationRefused("شهرُ الدفع خارج المدى الذي تغطّيه — راجِع الشهرين.");
      amountMinor = tx.amount_minor;
      const [taken] = await t.select({ id: financeDeclarations.id }).from(financeDeclarations)
        .where(and(eq(financeDeclarations.bankTransactionId, input.bankTransactionId), eq(financeDeclarations.kind, "SPREAD"), isNull(financeDeclarations.voidedAt))).limit(1);
      if (taken) throw new DeclarationRefused("هذه الحركةُ موزَّعةٌ أصلاً — اسحب توزيعَها أوّلاً إن أردت تغييره.");
    } else if (input.kind === "NONE") {
      amountMinor = 0;
    } else if (!(amountMinor > 0)) {
      throw new DeclarationRefused("اكتب مبلغَ الشهر.");
    }
    if (label === "") throw new DeclarationRefused("اكتب وصفاً قصيراً.");
    const [row] = await t.insert(financeDeclarations).values({
      kind: input.kind, category: input.category, label, amountMinor,
      fromMonth: input.fromMonth, toMonth: input.toMonth,
      bankTransactionId: input.kind === "SPREAD" ? input.bankTransactionId : null,
      note: input.note?.trim() || null, createdById: actorId,
    }).returning({ id: financeDeclarations.id });
    await recordAudit({
      actorId, action: "FINANCE_DECLARATION_CREATED", entityType: "finance_declaration", entityId: row.id,
      before: null, after: { kind: input.kind, category: input.category, label, amountMinor, fromMonth: input.fromMonth, toMonth: input.toMonth },
    }, t);
    return row.id;
  });
}

/** يُسحَب ولا يُحذَف — وسحبُه مرّتين لا يكتب. */
export async function voidDeclaration(id: string, actorId: string): Promise<boolean> {
  return db.transaction(async (t) => {
    const done = await t.update(financeDeclarations).set({ voidedAt: new Date(), voidedById: actorId })
      .where(and(eq(financeDeclarations.id, id), isNull(financeDeclarations.voidedAt)))
      .returning({ label: financeDeclarations.label, amountMinor: financeDeclarations.amountMinor });
    if (done.length === 0) return false;
    await recordAudit({ actorId, action: "FINANCE_DECLARATION_VOIDED", entityType: "finance_declaration", entityId: id, before: done[0], after: null }, t);
    return true;
  });
}
