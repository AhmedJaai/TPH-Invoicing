/**
 * مزامنةُ فودكس — تقرأ من الواجهة وتكتب في موضعين لا يختلطان:
 *
 *   ١. **المرآة** (`foodics_*`): ما قاله فودكس كما قاله — رأسُ الطلب ودفعاتُه،
 *      ومشترياتُه، وصناديقُه. تُقارَن به دفاترُنا ولا يُحسَب منها مال.
 *   ٢. **مجالُ المبيعات** (`sales`): الطلباتُ بنودُها عبر مسار الاستيراد القائم
 *      (`importParsedSales`) بمفاتيح ملفّ الإكسل نفسِها — فما دخل من البابين طلبٌ واحد.
 *
 * والمبيعاتُ من فودكس موثوقة؛ وحسابُه للمخزون ليس كذلك، فلا يُؤخَذ منه مخزونٌ
 * ولا كلفة. والمشترياتُ والصناديقُ تدخل المرآةَ وحدها.
 *
 * كلُّ كتابةٍ بمعرّف فودكس: التشغيلُ مرّتين يُحدِّث ولا يضاعف.
 */
import { createHash } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  foodicsItemMoves, foodicsMoveDays, foodicsOrderPayments, foodicsOrders, foodicsPurchaseItems, foodicsPurchases,
  foodicsStockCountItems, foodicsStockCounts, foodicsSuppliers, foodicsSyncRuns, foodicsTills, salesImports, salesSources,
} from "@/db/schema";
import { fetchAll, fetchPage, foodicsConfigured, FoodicsNotConfiguredError } from "@/lib/foodics/client";
import { parseFoodicsMoment, quantityToMilli, riyalsToMinor } from "@/lib/foodics/money";
import { FOODICS_API_ADAPTER, isSettledOrder, mirrorOrder, ordersToSalesFile } from "@/lib/foodics/orders";
import {
  FoodicsCatalogProduct, FoodicsInventoryItem, FoodicsInventoryTx, FoodicsOrder, FoodicsStockCount, FoodicsStockMove,
  FoodicsSupplier, FoodicsTill, INVENTORY_TX, STOCK_MOVE_KINDS,
} from "@/lib/foodics/types";
import { aggregateMoves, daysOf, stockCountRow } from "@/lib/foodics/stock";
import { catalogItemsFromApi, catalogProductsFromApi } from "@/lib/foodics/catalog";
import type { ParsedCatalog } from "@/lib/inventory/foodics-catalog";
import { addDays, todayInRiyadh } from "@/lib/riyadh-time";
import { ensureFoodicsSource, importParsedSales } from "./sales-import.service";
import { acquireLease, loadCronRun, releaseLease } from "./job-state.service";
import type { CronRun } from "@/lib/cron";

const ORDER_INCLUDE = "payments.payment_method,products.product.category,products.options.modifier_option,products.taxes,branch,original_order,combos";
const PURCHASE_INCLUDE = "supplier,items";
/** هامشٌ يُعاد قراءتُه قبل آخر ما عُرف — طلبٌ عُدّل في الثانية نفسِها لا يسقط بين مزامنتين. */
const OVERLAP_MINUTES = 10;

export interface SyncCounts {
  ordersRead: number;
  ordersMirrored: number;
  salesWritten: number;
  salesRestated: number;
  linesRevised: number;
  purchases: number;
  suppliers: number;
  tills: number;
  /** جرودُ فودكس المقروءة، وأيّامُ الصرف التي أُعيد جمعُها. */
  stockCounts: number;
  moveDays: number;
  /** صفوفٌ ردّها المخطّط أو لم يُقرأ مبلغُها — تُقال ولا تُبتلَع. */
  rejected: number;
  problems: string[];
  /** انتهت المهلةُ قبل آخر صفحة — يُكمَل بتشغيلٍ ثانٍ. */
  partial: boolean;
}

function emptyCounts(): SyncCounts {
  return { ordersRead: 0, ordersMirrored: 0, salesWritten: 0, salesRestated: 0, linesRevised: 0, purchases: 0, suppliers: 0, tills: 0, stockCounts: 0, moveDays: 0, rejected: 0, problems: [], partial: false };
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function formatMoment(at: Date): string {
  return at.toISOString().slice(0, 19).replace("T", " ");
}

/* ─────────────────────────── الطلبات ─────────────────────────── */

async function writeOrders(orders: readonly FoodicsOrder[], actorId: string | null, counts: SyncCounts): Promise<void> {
  counts.ordersRead += orders.length;

  const mirrors = orders.flatMap((o) => {
    const m = mirrorOrder(o);
    if (m === null) {
      counts.rejected++;
      counts.problems.push(`الطلب ${o.reference}: تعذّرت قراءة إجماليه أو دفعته، فلم يُسجَّل في بيانات فودكس`);
      return [];
    }
    return [m];
  });

  await db.transaction(async (t) => {
    for (const part of chunks(mirrors, 300)) {
      await t.insert(foodicsOrders).values(part.map((m) => m.order)).onConflictDoUpdate({
        target: foodicsOrders.id,
        set: {
          reference: sql`excluded.reference`, businessDate: sql`excluded.business_date`,
          status: sql`excluded.status`, type: sql`excluded.type`, source: sql`excluded.source`,
          totalMinor: sql`excluded.total_minor`, discountMinor: sql`excluded.discount_minor`,
          vatMinor: sql`excluded.vat_minor`, originalReference: sql`excluded.original_reference`,
          openedAt: sql`excluded.opened_at`, closedAt: sql`excluded.closed_at`,
          sourceUpdatedAt: sql`excluded.source_updated_at`, syncedAt: sql`now()`,
        },
      });
      /* دفعاتُ الطلب تُستبدَل كلُّها: دفعةٌ حُذفت عند فودكس لا تبقى عندنا */
      const ids = part.map((m) => m.order.id);
      await t.execute(sql`delete from foodics_order_payments where order_id = any(${`{${ids.join(",")}}`}::text[])`);
      const payments = part.flatMap((m) => m.payments);
      for (const pp of chunks(payments, 500)) await t.insert(foodicsOrderPayments).values(pp).onConflictDoNothing();
    }
  });
  counts.ordersMirrored += mirrors.length;

  /* ── والبنودُ إلى مجال المبيعات عبر المسار القائم ── */
  const { file, problems } = ordersToSalesFile(orders);
  for (const p of problems) counts.problems.push(`الطلب ${p.reference}: ${p.reason}`);
  counts.rejected += problems.length;
  if (file.sales.length === 0) return;

  const sha = createHash("sha256").update(JSON.stringify(
    file.sales.map((s) => [s.externalId, s.businessDate, s.grossMinor, s.refundMinor, s.discountMinor, s.vatMinor, s.isVoid, s.lines.map((l) => [l.externalId, l.contentHash])]),
  )).digest("hex");
  const [seen] = await db.select({ id: salesImports.id }).from(salesImports).where(eq(salesImports.fileSha256, sha)).limit(1);
  if (seen) return;

  const result = await importParsedSales({
    file, sha, adapterName: FOODICS_API_ADAPTER, messages: [], retryOf: null,
    input: {
      fileName: `واجهة فودكس · ${file.periodStart ?? "؟"} → ${file.periodEnd ?? "؟"}`,
      actorId,
      buffer: { byteLength: 0 },
    },
  });
  if (result.blocked) {
    counts.problems.push(result.blocked);
    return;
  }
  counts.salesWritten += result.totals.salesWritten;
  counts.salesRestated += result.totals.salesRestated;
  counts.linesRevised += result.revisions.length;
}

export interface OrderWindow {
  /** أيّامُ عملٍ بعينها (شاملةَ الطرفين) — للتعبئة الأولى. */
  from?: string;
  to?: string;
  /** أو كلُّ ما عُدّل بعد لحظة — للمزامنة الجارية. */
  updatedAfter?: Date;
}

/**
 * يقرأ الطلبات صفحةً صفحة ويكتب كلَّ دفعةٍ حين تكتمل.
 * `deadlineAt` موعدٌ لا تُبدأ بعده صفحة: الوقوفُ بمهلةٍ معلَنة خيرٌ من قتلٍ صامت.
 */
export async function syncOrders(window: OrderWindow, actorId: string | null, counts: SyncCounts, deadlineAt: number | null = null): Promise<void> {
  const query: Record<string, string> = { include: ORDER_INCLUDE };
  if (window.updatedAfter) {
    query["filter[updated_after]"] = formatMoment(window.updatedAfter);
    query.sort = "updated_at";
  } else {
    /* حدّا الواجهة خارجان عن المدى، فيُوسَّعان يوماً من كلّ طرف */
    if (window.from) query["filter[business_date_after]"] = addDays(window.from, -1);
    if (window.to) query["filter[business_date_before]"] = addDays(window.to, 1);
    query.sort = "reference";
  }

  /* تُجمَع صفحاتٌ ثمّ تُكتب معاً — أسبوعٌ حقيقيّ نحو ألف طلب، وهو ما جُرّب عليه مسارُ الاستيراد */
  const BATCH_PAGES = 20;
  let buffer: FoodicsOrder[] = [];
  for (let page = 1; ; page++) {
    if (deadlineAt !== null && Date.now() > deadlineAt) { counts.partial = true; break; }
    const got = await fetchPage("orders", FoodicsOrder, query, page);
    counts.rejected += got.rejected;
    if (got.rejected > 0) counts.problems.push(`${got.rejected} طلباً في الصفحة ${page} بصيغة غير معروفة`);
    buffer.push(...got.items.filter(isSettledOrder));
    const last = page >= got.lastPage;
    if (page % BATCH_PAGES === 0 || last) {
      await writeOrders(buffer, actorId, counts);
      buffer = [];
    }
    if (last) break;
  }
  if (buffer.length > 0) await writeOrders(buffer, actorId, counts);
}

/* ─────────────────────────── المورّدون والمشتريات ─────────────────────────── */

export async function syncSuppliers(counts: SyncCounts): Promise<void> {
  const { items, rejected } = await fetchAll("suppliers", FoodicsSupplier);
  counts.rejected += rejected;
  if (items.length === 0) return;
  await db.insert(foodicsSuppliers)
    .values(items.map((s) => ({ id: s.id, name: s.name.trim(), deletedAt: parseFoodicsMoment(s.deleted_at) })))
    /* الربطُ بمورّدنا عملُ إنسانٍ لا يُمَسّ — يُحدَّث الاسمُ وحالُ الحذف وحدهما */
    .onConflictDoUpdate({ target: foodicsSuppliers.id, set: { name: sql`excluded.name`, deletedAt: sql`excluded.deleted_at`, syncedAt: sql`now()` } });
  counts.suppliers += items.length;
}

function purchaseRow(tx: FoodicsInventoryTx) {
  const updated = parseFoodicsMoment(tx.updated_at);
  const items = (tx.items ?? []).map((it, position) => {
    const quantityMilli = quantityToMilli(it.pivot.quantity);
    const costMinor = riyalsToMinor(it.pivot.cost);
    return quantityMilli === null || costMinor === null ? null : {
      purchaseId: tx.id, position, itemId: it.id, sku: it.sku ?? null, name: it.name.trim(),
      storageUnit: it.storage_unit ?? null, quantityMilli, costMinor,
    };
  });
  const paidTaxMinor = riyalsToMinor(tx.paid_tax) ?? 0;
  const additionalCostMinor = riyalsToMinor(tx.additional_cost) ?? 0;
  /* بندٌ واحدٌ لم يُقرأ يُسقِط الحركةَ كلَّها: مجموعٌ ناقصٌ يُقرأ فرقاً في السعر وهو ليس كذلك */
  if (updated === null || items.some((x) => x === null)) return null;
  const read = items.flatMap((x) => (x === null ? [] : [x]));
  const subtotalMinor = read.reduce((s, x) => s + x.costMinor, 0);
  return {
    head: {
      id: tx.id, reference: tx.reference, type: tx.type, status: tx.status, businessDate: tx.business_date,
      foodicsSupplierId: tx.supplier?.id ?? null,
      invoiceNumber: tx.invoice_number?.trim() || null, invoiceDate: tx.invoice_date?.trim() || null,
      subtotalMinor, paidTaxMinor, additionalCostMinor,
      totalMinor: subtotalMinor + paidTaxMinor + additionalCostMinor,
      notes: tx.notes?.trim() || null, postedAt: parseFoodicsMoment(tx.posted_at), sourceUpdatedAt: updated,
    },
    items: read,
    supplier: tx.supplier ?? null,
  };
}

/** المشترياتُ ومرتجَعُها — مئاتٌ لا آلاف، فتُقرأ كلُّها كلَّ مرّة: تعديلٌ قديمٌ لا يفوت. */
export async function syncPurchases(counts: SyncCounts): Promise<void> {
  for (const type of [INVENTORY_TX.PURCHASING, INVENTORY_TX.RETURN_TO_SUPPLIER]) {
    const { items, rejected } = await fetchAll("inventory_transactions", FoodicsInventoryTx, { "filter[type]": type, include: PURCHASE_INCLUDE });
    counts.rejected += rejected;
    const rows = items.flatMap((tx) => {
      const row = purchaseRow(tx);
      if (row === null) {
        counts.rejected++;
        counts.problems.push(`حركة الشراء ${tx.reference}: تعذّرت قراءة الكمية أو التكلفة، فلم تُسجَّل في بيانات فودكس`);
        return [];
      }
      return [row];
    });
    if (rows.length === 0) continue;

    await db.transaction(async (t) => {
      /* مورّدٌ في حركةٍ ولم يرد في قائمة المورّدين (محذوف) — يُقيَّد كي لا يُكسَر المرجع */
      const suppliers = new Map(rows.flatMap((r) => (r.supplier ? [[r.supplier.id, r.supplier.name.trim()] as const] : [])));
      if (suppliers.size > 0) {
        await t.insert(foodicsSuppliers).values([...suppliers].map(([id, name]) => ({ id, name }))).onConflictDoNothing();
      }
      for (const part of chunks(rows, 200)) {
        await t.insert(foodicsPurchases).values(part.map((r) => r.head)).onConflictDoUpdate({
          target: foodicsPurchases.id,
          set: {
            reference: sql`excluded.reference`, type: sql`excluded.type`, status: sql`excluded.status`,
            businessDate: sql`excluded.business_date`, foodicsSupplierId: sql`excluded.foodics_supplier_id`,
            invoiceNumber: sql`excluded.invoice_number`, invoiceDate: sql`excluded.invoice_date`,
            subtotalMinor: sql`excluded.subtotal_minor`, paidTaxMinor: sql`excluded.paid_tax_minor`,
            additionalCostMinor: sql`excluded.additional_cost_minor`, totalMinor: sql`excluded.total_minor`,
            notes: sql`excluded.notes`, postedAt: sql`excluded.posted_at`,
            sourceUpdatedAt: sql`excluded.source_updated_at`, syncedAt: sql`now()`,
          },
        });
        const ids = part.map((r) => r.head.id);
        await t.execute(sql`delete from foodics_purchase_items where purchase_id = any(${`{${ids.join(",")}}`}::text[])`);
        for (const ip of chunks(part.flatMap((r) => r.items), 500)) await t.insert(foodicsPurchaseItems).values(ip);
      }
    });
    counts.purchases += rows.length;
  }
}

/* ─────────────────────────── الصناديق ─────────────────────────── */

export async function syncTills(counts: SyncCounts): Promise<void> {
  const { items, rejected } = await fetchAll("tills", FoodicsTill, { include: "user,device" });
  counts.rejected += rejected;
  for (const part of chunks(items, 300)) {
    await db.insert(foodicsTills).values(part.map((x) => ({
      id: x.id, businessDate: x.business_date,
      openingMinor: riyalsToMinor(x.opening_amount), closingMinor: riyalsToMinor(x.closing_amount),
      estimatedCashMinor: riyalsToMinor(x.estimated_cash), varianceMinor: riyalsToMinor(x.variance),
      openedAt: parseFoodicsMoment(x.opened_at), closedAt: parseFoodicsMoment(x.closed_at),
      userName: x.user?.name?.trim() || null, deviceName: x.device?.name?.trim() || null,
    }))).onConflictDoUpdate({
      target: foodicsTills.id,
      set: {
        businessDate: sql`excluded.business_date`, openingMinor: sql`excluded.opening_minor`,
        closingMinor: sql`excluded.closing_minor`, estimatedCashMinor: sql`excluded.estimated_cash_minor`,
        varianceMinor: sql`excluded.variance_minor`, openedAt: sql`excluded.opened_at`,
        closedAt: sql`excluded.closed_at`, userName: sql`excluded.user_name`,
        deviceName: sql`excluded.device_name`, syncedAt: sql`now()`,
      },
    });
  }
  counts.tills += items.length;
}

/* ─────────────────────────── شاهدُ المخزون ─────────────────────────── */

/** جرودُ فودكس — عشراتٌ لا آلاف، فتُقرأ كلُّها: جردٌ عُدّل بعد أسبوعٍ لا يفوت. */
export async function syncStockCounts(counts: SyncCounts): Promise<void> {
  const { items, rejected } = await fetchAll("inventory_counts", FoodicsStockCount, { include: "items,creator" });
  counts.rejected += rejected;
  const rows = items.flatMap((c) => {
    const row = stockCountRow(c);
    if (row === null) {
      counts.rejected++;
      counts.problems.push(`الجرد ${c.reference}: تعذّرت قراءة الكمية، فلم يُسجَّل في بيانات فودكس`);
      return [];
    }
    return [row];
  });
  if (rows.length === 0) return;
  await db.transaction(async (t) => {
    for (const part of chunks(rows, 100)) {
      await t.insert(foodicsStockCounts).values(part.map((r) => r.head)).onConflictDoUpdate({
        target: foodicsStockCounts.id,
        set: {
          reference: sql`excluded.reference`, businessDate: sql`excluded.business_date`, stockDay: sql`excluded.stock_day`,
          status: sql`excluded.status`, creatorName: sql`excluded.creator_name`, countedAt: sql`excluded.counted_at`,
          sourceUpdatedAt: sql`excluded.source_updated_at`, syncedAt: sql`now()`,
        },
      });
      /* بنودُ الجرد تُستبدَل كلُّها: بندٌ حُذف عند فودكس لا يبقى عندنا */
      const ids = part.map((r) => r.head.id);
      await t.execute(sql`delete from foodics_stock_count_items where count_id = any(${`{${ids.join(",")}}`}::text[])`);
      for (const ip of chunks(part.flatMap((r) => r.items), 500)) await t.insert(foodicsStockCountItems).values(ip);
    }
  });
  counts.stockCounts += rows.length;
}

/** أدنى ما يبقى من مهلة المسار ليُحسَب الفرقُ المتكرّر بعد المزامنة. */
const GAPS_MIN_BUDGET_MS = 25_000;

/** كم يوماً يُعاد جمعُ صرفه في المزامنة الجارية — مرتجَعٌ أو هدرٌ يُكتب لطلب الأمس. */
const MOVE_REFRESH_DAYS = 2;

/**
 * صرفُ فودكس يوماً يوماً: تُقرأ حركاتُ اليوم كلُّها ثمّ يُستبدَل مجموعُه في معاملةٍ واحدة.
 * فاليومُ إمّا كاملٌ وله صفٌّ في `foodics_move_days`، وإمّا لم يُقرأ — لا نصفَ يوم.
 */
export async function syncItemMoves(from: string, to: string, counts: SyncCounts, deadlineAt: number | null = null): Promise<void> {
  for (const day of daysOf(from, to)) {
    if (deadlineAt !== null && Date.now() > deadlineAt) { counts.partial = true; return; }
    const moves: FoodicsStockMove[] = [];
    for (const kind of STOCK_MOVE_KINDS) {
      const got = await fetchAll("inventory_transactions", FoodicsStockMove, { "filter[type]": kind, "filter[business_date]": day, include: "items" });
      counts.rejected += got.rejected;
      if (got.rejected > 0) counts.problems.push(`${got.rejected} حركة صرف في ${day} بصيغة غير معروفة`);
      moves.push(...got.items);
    }
    const { rows, unread } = aggregateMoves(moves);
    if (unread > 0) {
      counts.rejected += unread;
      counts.problems.push(`${unread} بند صرف في ${day} تعذّرت قراءة كميته أو تكلفته`);
    }
    await db.transaction(async (t) => {
      await t.delete(foodicsItemMoves).where(eq(foodicsItemMoves.businessDate, day));
      for (const part of chunks(rows, 500)) await t.insert(foodicsItemMoves).values(part);
      await t.insert(foodicsMoveDays).values({ businessDate: day, txCount: moves.length })
        .onConflictDoUpdate({ target: foodicsMoveDays.businessDate, set: { txCount: sql`excluded.tx_count`, syncedAt: sql`now()` } });
    });
    counts.moveDays++;
  }
}

/* ─────────────────────────── التشغيل ─────────────────────────── */

export interface SyncOptions {
  actorId: string | null;
  /** تعبئةٌ لأيّامٍ بعينها بدل «ما تغيّر منذ آخر مرّة». */
  window?: { from: string; to: string };
  /** كم يُمهَل قبل الوقوف — للمسار الذي عمرُه ستّون ثانية. */
  budgetMs?: number;
  /** الطلباتُ وحدها (للتعبئة أسبوعاً أسبوعاً). */
  ordersOnly?: boolean;
  /** صرفُ الأصناف وحده لمدى `window` — للتعبئة التاريخيّة (`--moves`). */
  movesOnly?: boolean;
}

export interface SyncResult {
  runId: string;
  status: "OK" | "PARTIAL" | "FAILED";
  counts: SyncCounts;
  error: string | null;
}

/** آخرُ لحظةِ تعديلٍ عرفناها — منها تبدأ المزامنةُ الجارية. `null` «لم نقرأ شيئاً بعد». */
async function lastKnownUpdate(): Promise<Date | null> {
  const [row] = await db.select({ at: sql<Date | null>`max(${foodicsOrders.sourceUpdatedAt})` }).from(foodicsOrders);
  return row?.at ? new Date(row.at) : null;
}

/**
 * سببُ السقوط لا نصُّ الاستعلام. خطأُ Drizzle رسالتُه «Failed query: …» بالعبارة
 * ومعاملاتِها كلِّها، وسببُ القاعدة الحقيقيُّ (أيُّ قيدٍ رفض) مدفونٌ في `cause` —
 * فكانت الشاشةُ تعرض صفحةَ SQL ولا تقول لماذا.
 */
export function describeFailure(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = e.cause;
  if (cause instanceof Error) {
    const constraint = "constraint" in cause ? cause.constraint : null;
    return typeof constraint === "string" && constraint.length > 0
      ? `${cause.message} (${constraint})`
      : cause.message;
  }
  return e.message.startsWith("Failed query:") ? e.message.split("\n")[0].slice(0, 200) : e.message;
}

/** أوّلُ يومٍ يُقرأ إن لم يُقرأ شيءٌ قبلُ ولم يُحدَّد مدى — شهرٌ يكفي المسارَ القصير، والباقي للنصّ. */
const FIRST_RUN_DAYS = 3;

export async function runFoodicsSync(options: SyncOptions): Promise<SyncResult> {
  if (!foodicsConfigured()) throw new FoodicsNotConfiguredError();
  const counts = emptyCounts();
  const deadlineAt = options.budgetMs ? Date.now() + options.budgetMs : null;
  const [run] = await db.insert(foodicsSyncRuns)
    .values({ scope: options.window ? `WINDOW ${options.window.from}→${options.window.to}` : "INCREMENTAL", status: "RUNNING", startedById: options.actorId })
    .returning({ id: foodicsSyncRuns.id });

  let error: string | null = null;
  try {
    if (options.movesOnly && options.window) {
      await syncItemMoves(options.window.from, options.window.to, counts, deadlineAt);
    } else if (!options.ordersOnly) {
      await syncSuppliers(counts);
      await syncPurchases(counts);
      await syncTills(counts);
      await syncStockCounts(counts);
    }
    if (options.movesOnly) {
      /* لا طلبات في هذا التشغيل */
    } else if (options.window) {
      await syncOrders(options.window, options.actorId, counts, deadlineAt);
    } else {
      const known = await lastKnownUpdate();
      const since = known
        ? new Date(known.getTime() - OVERLAP_MINUTES * 60_000)
        : new Date(Date.now() - FIRST_RUN_DAYS * 86_400_000);
      await syncOrders({ updatedAfter: since }, options.actorId, counts, deadlineAt);
      /* آخرُ ما يُقرأ: إن ضاق الوقتُ بقي ما سبق كاملاً وقيل «بقي ما يُكمَل» */
      const today = todayInRiyadh();
      await syncItemMoves(addDays(today, -MOVE_REFRESH_DAYS), today, counts, deadlineAt);
      /*
        والفرقُ المتكرّر في الأصناف يُعاد حسابُه هنا ويُحفَظ — «يحتاج قرارك» يقرؤه محفوظاً
        ولا يحسبه. يُتخطّى إن ضاق الوقت: حسابُه ثلاثةُ أشهرٍ من الأسطر.
      */
      if (!counts.partial && (deadlineAt === null || deadlineAt - Date.now() > GAPS_MIN_BUDGET_MS)) {
        try {
          const { refreshRecurringGaps } = await import("./finance-attention.service");
          await refreshRecurringGaps();
        } catch (e) {
          counts.problems.push(`تعذّر حساب الفروقات المتكررة في الأصناف: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  } catch (e) {
    error = describeFailure(e);
  }

  const status: SyncResult["status"] = error ? "FAILED" : counts.partial ? "PARTIAL" : "OK";
  /* ما يُحفَظ من المشاكل معدود — سجلٌّ لا مستودع */
  const stored = { ...counts, problems: counts.problems.slice(0, 50) };
  await db.update(foodicsSyncRuns)
    .set({ status, finishedAt: new Date(), counts: stored as never, error })
    .where(eq(foodicsSyncRuns.id, run.id));
  const sourceId = await ensureFoodicsSource();
  await db.update(salesSources)
    .set(error ? { lastError: error } : { isConnected: true, lastSyncAt: new Date(), lastError: null })
    .where(eq(salesSources.id, sourceId));
  return { runId: run.id, status, counts, error };
}

/*
  مزامنةٌ واحدةٌ في كلّ لحظة: الخلفيّةُ تُطلَق من كلّ جهازٍ ولسانٍ بتوقيته، فبدأت
  اثنتان بفارق ثلاث ثوانٍ (١٩ أكتوبر ٢٠٢٦) وسقطت الثانية. والعقدُ أطولُ من عمر المسار
  فلا ينقضي وصاحبُه يعمل، وينقضي وحده إن قتلته المنصّة. ويأخذه البابان معاً —
  «زامن الآن» (`/api/foodics-sync`) والتشغيلُ المجدول (`/api/cron/foodics`).
*/
const SYNC_LEASE = "foodics-sync-lease";
const SYNC_LEASE_MS = 70_000;

export interface LeaseDeps {
  acquire: (name: string, holder: string, ttlMs: number) => Promise<boolean>;
  release: (name: string, holder: string) => Promise<void>;
  run: (options: SyncOptions) => Promise<SyncResult>;
}

/** المزامنةُ تحت عقدها — `busy` إن كانت أخرى تجري، فلا تقع الثانيةُ ولا تكتب شيئاً. */
export async function runLeasedFoodicsSync(
  options: { actorId: string | null; budgetMs: number },
  deps?: Partial<LeaseDeps>,
): Promise<{ busy: true } | { busy: false; result: SyncResult }> {
  const acquire = deps?.acquire ?? ((n, h, t) => acquireLease(n, h, t));
  const release = deps?.release ?? ((n, h) => releaseLease(n, h));
  const run = deps?.run ?? runFoodicsSync;
  const holder = crypto.randomUUID();
  if (!(await acquire(SYNC_LEASE, holder, SYNC_LEASE_MS))) return { busy: true };
  try {
    return { busy: false, result: await run({ actorId: options.actorId, budgetMs: options.budgetMs }) };
  } finally {
    await release(SYNC_LEASE, holder).catch(() => undefined);
  }
}

export interface FoodicsStatus {
  configured: boolean;
  lastRun: { status: string; startedAt: Date; finishedAt: Date | null; error: string | null; scope: string } | null;
  lastOkAt: Date | null;
  orders: number;
  firstDay: string | null;
  lastDay: string | null;
  purchases: number;
  /** آخرُ تشغيلٍ مجدول (`/api/cron/foodics`) — `null`: لم يجرِ قطّ. */
  scheduled: CronRun | null;
}

/** حالُ الوصل لشاشاته — «أيعرف شيئاً؟» قبل أن يُعرَض رقم. */
export async function loadFoodicsStatus(): Promise<FoodicsStatus> {
  const [[lastRun], [ok], [o], [p], scheduled] = await Promise.all([
    db.select().from(foodicsSyncRuns).orderBy(desc(foodicsSyncRuns.startedAt)).limit(1),
    db.select({ at: sql<Date | null>`max(${foodicsSyncRuns.finishedAt})` }).from(foodicsSyncRuns).where(eq(foodicsSyncRuns.status, "OK")),
    db.select({ n: sql<number>`count(*)::int`, first: sql<string | null>`min(${foodicsOrders.businessDate})`, last: sql<string | null>`max(${foodicsOrders.businessDate})` }).from(foodicsOrders),
    db.select({ n: sql<number>`count(*)::int` }).from(foodicsPurchases),
    loadCronRun("foodics").catch(() => null),
  ]);
  return {
    configured: foodicsConfigured(),
    lastRun: lastRun ? { status: lastRun.status, startedAt: lastRun.startedAt, finishedAt: lastRun.finishedAt, error: lastRun.error, scope: lastRun.scope } : null,
    lastOkAt: ok?.at ? new Date(ok.at) : null,
    orders: Number(o?.n ?? 0),
    firstDay: o?.first ?? null,
    lastDay: o?.last ?? null,
    purchases: Number(p?.n ?? 0),
    scheduled,
  };
}

/* ─────────────────────────── الكتالوج ─────────────────────────── */

/**
 * كتالوجُ فودكس من واجهته — أصنافُ المخزون والأصنافُ المباعة والوصفات — بالصيغة التي
 * يكتبها `importParsedCatalog`. قراءةٌ وحدها: الكتابةُ بعد معاينةٍ وإقرار، كالملفّات.
 */
export async function fetchFoodicsCatalog(): Promise<{ file: { fileName: string }; result: ParsedCatalog }[]> {
  if (!foodicsConfigured()) throw new FoodicsNotConfiguredError();
  const [items, products] = await Promise.all([
    fetchAll("inventory_items", FoodicsInventoryItem),
    fetchAll("products", FoodicsCatalogProduct, { include: "ingredients" }),
  ]);
  const stock = catalogItemsFromApi(items.items);
  const menu = catalogProductsFromApi(products.items);
  if (items.rejected > 0) stock.warnings.push(`${items.rejected} صنف مخزون بصيغة غير معروفة، فلم يُقرأ.`);
  if (products.rejected > 0) menu.products.warnings.push(`${products.rejected} صنفاً مباعاً بصيغة غير معروفة، فلم يُقرأ.`);
  return [
    { file: { fileName: "فودكس · أصناف المخزون" }, result: stock },
    { file: { fileName: "فودكس · الأصناف المباعة" }, result: menu.products },
    { file: { fileName: "فودكس · الوصفات" }, result: menu.recipes },
  ];
}
