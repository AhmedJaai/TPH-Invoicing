/**
 * تحليلُ مبيعات الشهر — «ماذا أبيع ومتى؟ وما الذي يأكل ربحي؟».
 *
 * الإيرادُ هنا هو إيرادُ قائمة الدخل نفسُه (`loadRevenue`): ما دفعه الزبائن بلا House
 * Account. وتفصيلُ الأصناف من بنود البيع، وكلفتُها من الوصفات بمعدّلات الشهر نفسِها
 * التي تقوّم بها قائمةُ الدخل استهلاكَها النظريّ — فمجموعُ كلفة الأصناف هو ذاك الرقم.
 *
 * وسعرُ الصنف يُعرَض شاملاً الضريبة كما في الإيصال، وهامشُه على سعره بلا ضريبة
 * (÷ ١٫١٥): الخياراتُ المعفاة قليلة، والهامشُ هنا للمقارنة بين الأصناف لا للإقرار.
 *
 * وصفٌ لما وقع: لا اسمَ عميلٍ، ولا حكمَ على أحد.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";
import { eq } from "drizzle-orm";
import { computeConsumption } from "@/lib/inventory/consumption";
import { varianceCostMinor } from "@/lib/inventory/purchases";
import { indexRecipeVersions } from "@/lib/inventory/recipe";
import { previousMonth } from "@/lib/finance/stock-window";
import { monthEndDay, todayInRiyadh } from "@/lib/riyadh-time";
import { netInsideGross } from "@/lib/vat";
import { loadSoldForReport } from "./inventory.service";
import { loadRates, loadRevenue, type MonthRevenue } from "./profit.service";
import { loadRecipeVersions } from "./recipe.service";
import type { Conn } from "./types";

export const ORDER_TYPE_LABEL: Record<number, string> = { 1: "محلّيّ", 2: "سفريّ", 3: "توصيل", 4: "من السيّارة" };

export interface ItemRow {
  key: string;
  name: string;
  quantityMilli: number;
  /** بسعر البيع شاملاً الضريبة، قبل خصم الطلب. */
  salesMinor: number;
  /** كلفةُ مكوّناته من الوصفة — `null` لا وصفةَ أو مكوّنٌ بلا كلفة. */
  costMinor: number | null;
  /** الهامشُ على السعر بلا ضريبة، بنقاط الأساس. */
  marginBp: number | null;
  /** مبيعاتُ الشهر السابق وكمّيّتُه — `null` لم يُبَع فيه. */
  previousSalesMinor: number | null;
  previousQuantityMilli: number | null;
  /** مشروباتُ موظّفين من هذا الصنف (كمّيّة) — لا إيرادَ لها. */
  staffMilli: number;
}

export interface SalesAnalysis {
  month: string;
  revenue: MonthRevenue | null;
  previous: MonthRevenue | null;
  /** أيّامُ الشهر السابق حتى اليوم نفسه — للمقارنة العادلة بشهرٍ لم ينتهِ. */
  previousToDatePaidMinor: number | null;
  days: { day: string; paidMinor: number; orders: number }[];
  hours: { hour: number; paidMinor: number; orders: number }[];
  weekdays: { weekday: number; paidMinor: number; orders: number; days: number }[];
  methods: { name: string; type: number; amountMinor: number; payments: number }[];
  types: { type: number; label: string; paidMinor: number; orders: number }[];
  items: ItemRow[];
  /** ما خرج من الإيراد. */
  leaks: {
    discountMinor: number; discountedOrders: number;
    refundsMinor: number; refundOrders: number;
    voidOrders: number;
    staffListMinor: number; staffOrders: number; staffCostMinor: number | null;
  };
  /** من سجّل الطلبات في فودكس — لمعرفة أيمكن تفصيلٌ بحسب الكاشير. */
  openOrdersUnsynced: boolean;
}

export async function loadSalesAnalysis(month: string, conn: Conn = db): Promise<SalesAnalysis> {
  const from = `${month}-01`;
  const to = monthEndDay(month);
  const prev = previousMonth(month);
  const prevFrom = `${prev}-01`;
  const prevTo = monthEndDay(prev);
  const today = todayInRiyadh();
  /* اليومُ المقابل في الشهر السابق — شهرٌ جارٍ يُقارَن بما مضى من سابقه لا بكلّه */
  const dayOfMonth = today.startsWith(month) ? today.slice(8, 10) : null;

  const [revenue, days, hours, methods, types, leakRows, versions, stock, prevToDate] = await Promise.all([
    loadRevenue(conn),
    conn.execute<{ day: string; paid: string; orders: number }>(sql`
      select o.business_date as day, coalesce(sum(p.amount_minor) filter (where p.method_type <> 5), 0)::bigint as paid,
             count(distinct o.id) filter (where o.status = 4)::int as orders
        from foodics_orders o join foodics_order_payments p on p.order_id = o.id
       where o.status in (4, 5) and o.business_date >= ${from} and o.business_date <= ${to}
       group by 1 order by 1
    `),
    conn.execute<{ hour: number; weekday: number; paid: string; orders: number; days: number }>(sql`
      select extract(hour from o.opened_at at time zone 'Asia/Riyadh')::int as hour,
             extract(dow from o.business_date::date)::int as weekday,
             coalesce(sum(p.amount_minor) filter (where p.method_type <> 5), 0)::bigint as paid,
             count(distinct o.id)::int as orders, count(distinct o.business_date)::int as days
        from foodics_orders o join foodics_order_payments p on p.order_id = o.id
       where o.status = 4 and o.opened_at is not null and o.business_date >= ${from} and o.business_date <= ${to}
       group by 1, 2
    `),
    conn.execute<{ name: string; type: number; amount: string; n: number }>(sql`
      select p.method_name as name, p.method_type as type, sum(p.amount_minor)::bigint as amount, count(*)::int as n
        from foodics_orders o join foodics_order_payments p on p.order_id = o.id
       where o.status in (4, 5) and o.business_date >= ${from} and o.business_date <= ${to}
       group by 1, 2 order by 3 desc
    `),
    conn.execute<{ type: number; paid: string; orders: number }>(sql`
      select o.type, coalesce(sum(p.amount_minor) filter (where p.method_type <> 5), 0)::bigint as paid, count(distinct o.id)::int as orders
        from foodics_orders o join foodics_order_payments p on p.order_id = o.id
       where o.status = 4 and o.business_date >= ${from} and o.business_date <= ${to}
       group by 1 order by 2 desc
    `),
    conn.execute<{ discounted: number; refund_orders: number; void_orders: number; staff_orders: number }>(sql`
      select count(*) filter (where status = 4 and discount_minor > 0)::int as discounted,
             count(*) filter (where status = 5)::int as refund_orders,
             count(*) filter (where status = 7)::int as void_orders,
             (select count(distinct o2.id) from foodics_orders o2 join foodics_order_payments p2 on p2.order_id = o2.id
               where p2.method_type = 5 and o2.status = 4 and o2.business_date >= ${from} and o2.business_date <= ${to})::int as staff_orders
        from foodics_orders where business_date >= ${from} and business_date <= ${to}
    `),
    loadRecipeVersions(conn),
    conn.select({ id: products.id, baseUnit: products.baseUnit }).from(products).where(eq(products.isStockItem, true)),
    dayOfMonth === null ? Promise.resolve(null) : conn.execute<{ paid: string }>(sql`
      select coalesce(sum(p.amount_minor) filter (where p.method_type <> 5), 0)::bigint as paid
        from foodics_orders o join foodics_order_payments p on p.order_id = o.id
       where o.status in (4, 5) and o.business_date >= ${prevFrom} and o.business_date < ${`${prev}-${dayOfMonth}`}
    `),
  ]);

  const baseUnitOf = new Map(stock.map((p) => [p.id, p.baseUnit]));
  const rates = await loadRates(to < today ? to : today, baseUnitOf, conn);
  const index = indexRecipeVersions(versions);
  const [lines, prevLines] = await Promise.all([
    loadSoldForReport(from, to, versions, conn),
    loadSoldForReport(prevFrom, prevTo, versions, conn),
  ]);

  /* الصنفُ بمفتاح رمزه في نقاط البيع، وإلّا باسمه */
  const keyOf = (l: { posProductExternalId: string | null; posProductName: string }) => l.posProductExternalId ?? `NAME:${l.posProductName}`;
  const previousOf = new Map<string, { sales: number; qty: number }>();
  for (const l of prevLines) {
    if (l.isVoid || l.isRefund || l.isComplimentary) continue;
    const acc = previousOf.get(keyOf(l)) ?? { sales: 0, qty: 0 };
    acc.sales += l.lineTotalMinor; acc.qty += l.quantityMilli;
    previousOf.set(keyOf(l), acc);
  }
  const groups = new Map<string, typeof lines>();
  for (const l of lines) {
    if (l.isVoid) continue;
    const list = groups.get(keyOf(l));
    if (list) list.push(l); else groups.set(keyOf(l), [l]);
  }
  let staffCostMinor: number | null = 0;
  const items: ItemRow[] = [...groups].map(([key, group]) => {
    const sold = group.filter((l) => !l.isRefund && !l.isComplimentary);
    const staff = group.filter((l) => l.isComplimentary);
    const costOf = (subset: typeof group): number | null => {
      if (subset.length === 0) return 0;
      const used = computeConsumption(subset, index);
      if (used.included.lines < subset.length) return null;
      let total = 0;
      for (const ing of used.byIngredient.values()) {
        const base = baseUnitOf.get(ing.productId);
        const cost = base && ing.unitConflict === null ? varianceCostMinor(ing.canonicalMilli, rates.get(ing.productId) ?? null, base) : null;
        if (cost === null) return null;
        total += cost;
      }
      return total;
    };
    const salesMinor = sold.reduce((s, l) => s + l.lineTotalMinor, 0);
    const costMinor = sold.length === 0 ? null : costOf(sold);
    const staffCost = costOf(staff);
    if (staffCostMinor !== null) staffCostMinor = staffCost === null ? null : staffCostMinor + staffCost;
    const net = netInsideGross(salesMinor);
    const before = previousOf.get(key);
    return {
      key, name: group[0].posProductName,
      quantityMilli: sold.reduce((s, l) => s + l.quantityMilli, 0),
      salesMinor, costMinor,
      marginBp: costMinor !== null && net > 0 ? Math.round(((net - costMinor) * 10_000) / net) : null,
      previousSalesMinor: before?.sales ?? null, previousQuantityMilli: before?.qty ?? null,
      staffMilli: staff.reduce((s, l) => s + l.quantityMilli, 0),
    };
  }).filter((i) => i.quantityMilli > 0 || i.staffMilli > 0).sort((a, b) => b.salesMinor - a.salesMinor);

  const hourAcc = new Map<number, { paidMinor: number; orders: number }>();
  const dayAcc = new Map<number, { paidMinor: number; orders: number; days: number }>();
  for (const r of hours.rows) {
    const h = hourAcc.get(r.hour) ?? { paidMinor: 0, orders: 0 };
    h.paidMinor += Number(r.paid); h.orders += r.orders;
    hourAcc.set(r.hour, h);
    const d = dayAcc.get(r.weekday) ?? { paidMinor: 0, orders: 0, days: 0 };
    d.paidMinor += Number(r.paid); d.orders += r.orders; d.days = Math.max(d.days, r.days);
    dayAcc.set(r.weekday, d);
  }
  const mine = revenue.get(month) ?? null;
  const leak = leakRows.rows[0];
  return {
    month, revenue: mine, previous: revenue.get(prev) ?? null,
    previousToDatePaidMinor: prevToDate ? Number(prevToDate.rows[0]?.paid ?? 0) : null,
    days: days.rows.map((r) => ({ day: r.day, paidMinor: Number(r.paid), orders: r.orders })),
    hours: [...hourAcc].map(([hour, v]) => ({ hour, ...v })).sort((a, b) => a.hour - b.hour),
    weekdays: [...dayAcc].map(([weekday, v]) => ({ weekday, ...v })).sort((a, b) => a.weekday - b.weekday),
    methods: methods.rows.map((r) => ({ name: r.name, type: r.type, amountMinor: Number(r.amount), payments: r.n })),
    types: types.rows.map((r) => ({ type: r.type, label: ORDER_TYPE_LABEL[r.type] ?? `نوع ${r.type}`, paidMinor: Number(r.paid), orders: r.orders })),
    items,
    leaks: {
      discountMinor: mine?.discountMinor ?? 0, discountedOrders: leak?.discounted ?? 0,
      refundsMinor: mine?.refundsMinor ?? 0, refundOrders: leak?.refund_orders ?? 0,
      voidOrders: leak?.void_orders ?? 0,
      staffListMinor: mine?.staffListMinor ?? 0, staffOrders: leak?.staff_orders ?? 0, staffCostMinor,
    },
    openOrdersUnsynced: false,
  };
}
