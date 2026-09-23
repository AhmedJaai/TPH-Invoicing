/**
 * جردُ الأسبوع — القراءةُ من القاعدة، والحسابُ في `lib/inventory/engine`.
 *
 * ── الفصلُ مقصود ──
 *
 * هذا الملفّ يجمع الوقائع: ما بِيع، وما اشتُري، وما كان على الرفّ،
 * وما سُجّل هدراً. والمحرّكُ دالّةٌ نقيّة تأخذها وتُخرج التقرير. فيُختبَر
 * الحسابُ بلا قاعدة، وتُختبَر القراءةُ بسيناريو شهادةٍ على المخطّط
 * الحقيقيّ — ولا يختلط السؤالان.
 *
 * ── والخادمُ يُعيد الحساب دائماً ──
 *
 * لا يؤخذ من المتصفّح إلّا **العدُّ الفعليّ** ومعرّفُ الصنف. وكلُّ ما
 * عداه يُشتقّ هنا: الدرسُ نفسه من `confirm.ts` و«الإقرار الجماعيّ
 * يُعيد الحساب».
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  inventoryCountLines, inventoryCountOpenings, inventoryCountSnapshots, inventoryCounts,
  inventoryMovements, products, wasteRecords,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { MILLI_MINOR } from "@/lib/money";
import { createHash } from "node:crypto";
import { isStoredUnit, type StoredUnit } from "@/lib/unit-conversion";
import { MILLI, sameUnitFamily, toCanonical } from "@/lib/inventory/units";
import {
  ENGINE_VERSION, reconcile, type CountedProduct, type EngineInput, type EngineReport, type OpeningSource,
} from "@/lib/inventory/engine";
import { duplicateCandidates, RECEIPT_MATCH_WINDOW_DAYS, type DuplicateCandidate } from "@/lib/inventory/receipts";
import { summariseVariance, type SummaryLine, type VarianceSummary } from "@/lib/inventory/variance-summary";
import type { Conn } from "./types";
import type { SoldLineInput } from "@/lib/inventory/consumption";
import type { PurchaseLineInput } from "@/lib/inventory/purchases";
import { purchaseQuantity } from "@/lib/inventory/purchases";
import { loadRecipeVersions } from "./recipe.service";
import { isInventoryWeek, weekLabel, weekOf } from "@/lib/inventory/week";

/** كم يوماً يُنظَر إلى الوراء بحثاً عن آخر كلفةٍ معروفة حين لا شراءَ في الفترة. */
const COST_LOOKBACK_DAYS = 180;

/**
 * نافذةُ التباس الاستلام — أيّامٌ بعد نهاية الفترة.
 *
 * ── لماذا وُجدت ──
 *
 * المورّد يسلّم في السابع ويصدر فاتورتَه في العاشر. وفُحص المخطّط: لا
 * عمودَ استلامٍ كان فيه. فالقاعدةُ معلَنة — **تاريخُ الفاتورة نائبٌ عن
 * تاريخ الاستلام** — ولها حدٌّ: فاتورةٌ تلي نهايةَ الفترة بأيّامٍ قليلة
 * قد تكون بضاعةَ الفترة.
 *
 * فما وقع في النافذة **يُعرَض بندَ التباسٍ ولا يُضمّ ولا يُسقَط**. ومتى
 * كُتب `received_on` حقيقيٌّ قُدّم عليه وسقط الالتباس.
 */
const RECEIPT_AMBIGUITY_DAYS = 3;

/**
 * فترةٌ تتقاطع مع جردٍ قائم — وتُسمّى فترتُه كي يُعرَف أين الاصطدام.
 */
/**
 * فترةٌ ليست أسبوعَ جرد — والسلسلةُ تنقطع بها.
 *
 * وتُقترَح الفترةُ الصحيحة في الرسالة: من رفضتَ عليه فعلاً قُل له ما
 * الصواب، وإلّا صار الرفضُ حاجزاً بلا مخرج.
 */
export class NotAWeekError extends Error {
  constructor(readonly suggestion: { start: string; end: string }) {
    super(
      `الجردُ أسبوعٌ من الأحد إلى السبت — وهذه الفترة ليست كذلك.`
      + ` أقربُ أسبوعٍ يحويها: ${weekLabel(suggestion)}.`,
    );
    this.name = "NotAWeekError";
  }
}

export class OverlappingPeriodError extends Error {
  constructor(readonly periodStart: string, readonly periodEnd: string) {
    super(`هذه الفترة تتقاطع مع جردٍ آخر (${periodStart} → ${periodEnd}) — اختر فترةً تبدأ بعده.`);
    this.name = "OverlappingPeriodError";
  }
}

export class CountLockedError extends Error {
  constructor() {
    super("هذا الجرد مقفَل — أعِد فتحَه أوّلاً إن أردت تعديله.");
    this.name = "CountLockedError";
  }
}

export interface CountHeader {
  id: string;
  branchId: string | null;
  branchName: string | null;
  periodStart: string;
  periodEnd: string;
  status: "DRAFT" | "FINALISED";
  readiness: "READY" | "PARTIAL" | "BLOCKED" | null;
  startedAt: Date;
  finalisedAt: Date | null;
  reopenCount: number;
  note: string | null;
  /** نطاقُ الجرد موروثٌ أم صريح (`041`). */
  scopeSource: "INHERITED" | "EXPLICIT";
}

function shiftDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/* ─────────────────────────── القراءة ─────────────────────────── */

async function loadCountedProducts(conn: Conn): Promise<CountedProduct[]> {
  const rows = await conn
    .select({
      id: products.id, nameAr: products.nameAr,
      category: products.category, baseUnit: products.baseUnit,
    })
    .from(products)
    .where(and(eq(products.isActive, true), eq(products.isStockItem, true)))
    .orderBy(asc(products.category), asc(products.nameAr));
  return rows;
}

/**
 * أسطرُ المبيعات في الفترة، مع صنفِ القائمة بعد الربط.
 *
 * ── والفارغُ ليس «فرعاً آخر»، هو «لم نكن نعرف» ──
 *
 * الفرعُ يُرشَّح حين يكون للجرد فرع، وإلّا حُسبت مبيعاتُ فرعٍ على مخزون
 * فرعٍ آخر. لكنّ الترشيحَ بالمساواة وحدها يُسقط **كلّ** بيعةٍ لم يُقرأ
 * فرعُها من الملفّ — وتلك حالُ كلّ تصديرٍ لا عمودَ فرعٍ فيه.
 *
 * وأثرُ ذلك أنّ الاستهلاك المتوقَّع يخرج **صفراً** بلا شكوى، فيُقال إنّ
 * المقهى لم يستهلك شيئاً ويظهر كلُّ ما اشتُري «فرقاً». وهو الدرسُ نفسه
 * الذي كلّف `014` كشفاً كاملاً مرّتين: البحثُ عن السابق قُيّد بحسابٍ
 * لم يكن يُقرأ، فلم يوجد شيء.
 *
 * فالفارغُ يدخل مع فرعه — وهو الصواب ما دام لا دليلَ على أنّه لغيره.
 */
export async function loadSoldLines(
  periodStart: string,
  periodEnd: string,
  branchId: string | null,
  conn: Conn = db,
): Promise<SoldLineInput[]> {
  const rows = await conn.execute<Record<string, unknown>>(sql`
    select s.id                as sale_id,
           sl.id               as line_id,
           s.business_date,
           sl.description,
           pp.external_id      as pos_external_id,
           pp.product_id       as menu_product_id,
           sl.quantity,
           sl.line_total_minor,
           sl.is_refund,
           (sl.is_void or s.is_void) as is_void,
           sl.is_complimentary,
           coalesce((
             select array_agg(m.pp_external)
               from (
                 select pp2.external_id as pp_external
                   from sale_lines ml
                   left join pos_products pp2 on pp2.id = ml.pos_product_id
                  where ml.sale_id = s.id and ml.is_modifier
                    and ml.parent_external_id = pp.external_id
               ) m
           ), '{}') as modifier_ids
      from sale_lines sl
      join sales s on s.id = sl.sale_id
      left join pos_products pp on pp.id = sl.pos_product_id
     where s.business_date >= ${periodStart}
       and s.business_date <= ${periodEnd}
       and not sl.is_modifier
       ${branchId ? sql`and (s.branch_id = ${branchId} or s.branch_id is null)` : sql``}
     order by s.business_date, sl.id
  `);

  return rows.rows.map((r) => ({
    saleId: String(r.sale_id),
    lineId: String(r.line_id),
    businessDate: String(r.business_date),
    posProductName: String(r.description),
    posProductExternalId: r.pos_external_id === null ? null : String(r.pos_external_id),
    menuProductId: r.menu_product_id === null ? null : String(r.menu_product_id),
    /* `numeric(12,3)` يعود نصّاً — ويُقرأ إلى المِلّي بلا فاصلةٍ عائمة في الطريق */
    quantityMilli: Math.round(Number(r.quantity) * 1000),
    lineTotalMinor: Number(r.line_total_minor),
    isRefund: Boolean(r.is_refund),
    isVoid: Boolean(r.is_void),
    isComplimentary: Boolean(r.is_complimentary),
    modifierExternalIds: Array.isArray(r.modifier_ids)
      ? (r.modifier_ids as unknown[]).filter((x): x is string => typeof x === "string")
      : [],
  }));
}

/**
 * بنودُ الفواتير ومواصفةُ عبوة كلٍّ منها.
 *
 * ويُقرأ معها نافذةٌ سابقةٌ للفترة — لا لتدخل المعادلة بل ليُعرَف منها
 * **آخرُ كلفةٍ معروفة** لصنفٍ لم يُشترَ هذا الأسبوع. وبلا ذلك تُعرَض
 * كلفةُ فرقٍ «غير معروفة» لكلّ صنفٍ لم تصل فاتورتُه في السبعة أيّام،
 * وهو أكثرُ الأصناف.
 */
export async function loadPurchaseLines(
  periodStart: string,
  periodEnd: string,
  conn: Conn = db,
  branchId: string | null = null,
): Promise<{
  inPeriod: PurchaseLineInput[];
  lookback: PurchaseLineInput[];
  /** فواتيرُ تلي نهايةَ الفترة بأيّامٍ قليلة — التباسُ استلامٍ يُعرَض. */
  ambiguous: PurchaseLineInput[];
}> {
  const from = shiftDays(periodStart, -COST_LOOKBACK_DAYS);
  const until = shiftDays(periodEnd, RECEIPT_AMBIGUITY_DAYS);

  /*
    ── تاريخُ الدخول: الحقيقيّ إن وُجد، وإلّا تاريخُ الفاتورة نائباً ──

    و`received_on` أُضيف فارغاً في `037`. فما دام فارغاً يعمل النائب
    **مُعلَناً**، ومتى مُلئ قُدّم بلا إعادة كتابةِ استعلام.
  */
  const rows = await conn.execute<Record<string, unknown>>(sql`
    select il.id            as line_id,
           il.invoice_id,
           i.invoice_number,
           su.name_ar       as supplier_name,
           coalesce(
             i.received_on,
             to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD')
           )                as effective_date,
           i.received_on is not null as receipt_known,
           il.description,
           sp.product_id,
           il.qty,
           il.line_total_minor,
           sp.pack_size,
           sp.content_unit,
           sp.content_quantity
      from invoice_lines il
      join invoices i on i.id = il.invoice_id
      join suppliers su on su.id = i.supplier_id
      left join supplier_products sp on sp.id = il.supplier_product_id
     where coalesce(i.received_on, to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD')) >= ${from}
       and coalesce(i.received_on, to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD')) <= ${until}
       /*
         ── البندُ الذي يمثّله استلامٌ يدويّ يخرج من الحساب ──

         قال صاحبُ المقهى إنّ هذا الاستلامَ هو الوجهُ الفعليّ لهذا البند:
         فالكمّيّةُ كمّيّتُه وتاريخُه تاريخُه. ويخرج البندُ **حيثما وقع
         تاريخُه** — فاتورةٌ بتاريخ ٢٠ لشحنةٍ وصلت ١٨ لا تُحسَب في أسبوع
         ٢٠ ثانيةً.
       */
       and not exists (
         select 1 from inventory_receipts r
          where r.invoice_line_id = il.id and r.voided_at is null
       )
     order by effective_date
  `);

  /*
    ── والكمّيّةُ المستلَمة يدوياً سطرٌ من الأسطر نفسِها ──

    لا معادلةٌ ثانية: تمرّ بـ`summarisePurchases` كما يمرّ بندُ الفاتورة،
    وكمّيّتُها مكتوبةٌ لا مشتقّة. وتاريخُها تاريخُ الاستلام الفعليّ.
    وكلفتُها ما كُتب لها، وإلّا كلفةُ البند المرتبط — وإلّا مجهولة فلا
    تدخل مقامَ المتوسّط.
  */
  const receipts = await conn.execute<Record<string, unknown>>(sql`
    select r.id, r.product_id, r.received_on, r.entered_milli, r.entered_unit,
           r.cost_minor, r.document_ref, r.invoice_line_id,
           il.line_total_minor as linked_total,
           su.name_ar as supplier_name
      from inventory_receipts r
      left join invoice_lines il on il.id = r.invoice_line_id
      left join suppliers su on su.id = r.supplier_id
     where r.voided_at is null
       and r.received_on >= ${from}
       and r.received_on <= ${periodEnd}
       and ${branchId ? sql`(r.branch_id = ${branchId} or r.branch_id is null)` : sql`true`}
     order by r.received_on, r.created_at
  `);

  const all = rows.rows.map((r) => ({
    lineId: String(r.line_id),
    invoiceId: String(r.invoice_id),
    invoiceNumber: String(r.invoice_number),
    supplierName: String(r.supplier_name),
    invoiceDate: String(r.effective_date),
    receiptKnown: Boolean(r.receipt_known),
    description: String(r.description),
    productId: r.product_id === null ? null : String(r.product_id),
    qty: r.qty === null ? null : String(r.qty),
    lineTotalMinor: Number(r.line_total_minor),
    packSize: r.pack_size === null ? null : String(r.pack_size),
    contentUnit: isStoredUnit(r.content_unit) ? r.content_unit : null,
    contentQuantity: r.content_quantity === null ? null : String(r.content_quantity),
  } satisfies PurchaseLineInput));

  const manual: PurchaseLineInput[] = receipts.rows.flatMap((r) => {
    const unit = r.entered_unit;
    if (!isStoredUnit(unit)) return [];
    const cost = r.cost_minor !== null ? Number(r.cost_minor)
      : r.linked_total !== null ? Number(r.linked_total) : null;
    return [{
      lineId: String(r.id),
      invoiceId: r.invoice_line_id === null ? "" : String(r.invoice_line_id),
      invoiceNumber: r.document_ref === null ? "" : String(r.document_ref),
      supplierName: r.supplier_name === null ? "" : String(r.supplier_name),
      invoiceDate: String(r.received_on),
      receiptKnown: true,
      description: "كمّيّةٌ مستلَمة",
      productId: String(r.product_id),
      qty: null,
      lineTotalMinor: cost ?? 0,
      packSize: null,
      contentUnit: null,
      contentQuantity: null,
      source: "MANUAL_RECEIPT" as const,
      receivedMilli: Number(r.entered_milli),
      receivedUnit: unit,
      costKnown: cost !== null,
    } satisfies PurchaseLineInput];
  });

  const merged = [...all, ...manual].sort((a, b) => (a.invoiceDate < b.invoiceDate ? -1 : a.invoiceDate > b.invoiceDate ? 1 : 0));

  return {
    inPeriod: merged.filter((l) => l.invoiceDate >= periodStart && l.invoiceDate <= periodEnd),
    lookback: merged.filter((l) => l.invoiceDate < periodStart),
    /* تاريخُ استلامٍ حقيقيٌّ يقطع الالتباس — فلا يُعرَض إلّا النائب */
    ambiguous: all.filter((l) => !l.receiptKnown && l.invoiceDate > periodEnd),
  };
}

/**
 * الرصيدُ الافتتاحيّ ومصدرُه.
 *
 * أربعةُ مصادر **بترتيبٍ ثابتٍ لا تتنافس فيه**:
 *
 *   ١. `MANUAL` — أدخله إنسانٌ لهذا الجرد. يغلب ما دونه **صراحةً**:
 *      كتبه عارفاً أنّ الجردَ السابق يقول غيرَه، ويُحفَظ مصدرُه.
 *   ٢. `PREVIOUS_COUNT` — فعليُّ آخر جردٍ مقفَل في الفرع نفسه.
 *   ٣. `MOVEMENT` — رصيدٌ افتتاحيٌّ تاريخيّ مسجَّل حركةً.
 *   ٤. `UNKNOWN` — ويبقى `null`. **وقراءتُه صفراً تجعل كلَّ ما اشتُري
 *      في الفترة يظهر «فرقاً».**
 *
 * والمحرّكُ يتسلّم القيمةَ المحسومة ومصدرَها معاً، فيقول التقرير «٥٫٢
 * كجم — أُدخل يدوياً» لا «٥٫٢» وحدها.
 */
export async function resolveOpenings(
  countId: string | null,
  periodStart: string,
  branchId: string | null,
  productIds: readonly string[],
  conn: Conn = db,
): Promise<{
  values: Map<string, number | null>;
  sources: Map<string, { source: OpeningSource; ref: string | null }>;
}> {
  const values = new Map<string, number | null>(productIds.map((id) => [id, null]));
  const sources = new Map<string, { source: OpeningSource; ref: string | null }>();
  if (productIds.length === 0) return { values, sources };

  const settle = (id: string, milli: number, source: OpeningSource, ref: string | null) => {
    if (!values.has(id) || values.get(id) !== null) return;
    values.set(id, milli);
    sources.set(id, { source, ref });
  };

  /* ١ · اليدويّ لهذا الجرد */
  if (countId) {
    const manual = await conn.execute<{ id: string; product_id: string; canonical_milli: string }>(sql`
      select id, product_id, canonical_milli from inventory_count_openings
       where count_id = ${countId} and superseded_at is null
    `);
    for (const r of manual.rows) settle(String(r.product_id), Number(r.canonical_milli), "MANUAL", String(r.id));
  }

  /* ٢ · فعليُّ آخر جردٍ مقفَل في الفرع نفسه — لا من فرعٍ آخر */
  const previous = await conn.execute<Record<string, unknown>>(sql`
    select distinct on (l.product_id)
           l.product_id, l.actual_milli, c.id as count_id
      from inventory_count_lines l
      join inventory_counts c on c.id = l.count_id
     where c.status = 'FINALISED'
       and c.period_end < ${periodStart}
       and ${branchId ? sql`c.branch_id = ${branchId}` : sql`c.branch_id is null`}
       and l.actual_milli is not null
     order by l.product_id, c.period_end desc
  `);
  for (const r of previous.rows) {
    settle(String(r.product_id), Number(r.actual_milli), "PREVIOUS_COUNT", String(r.count_id));
  }

  /* ٣ · رصيدٌ افتتاحيٌّ مسجَّل حركةً — آخرُه قبل بدء الفترة */
  const written = await conn.execute<Record<string, unknown>>(sql`
    select distinct on (m.product_id)
           m.id, m.product_id, m.quantity_milli, m.unit, m.occurred_on
      from inventory_movements m
     where m.kind = 'OPENING'
       and m.occurred_on <= ${periodStart}
       and ${branchId ? sql`(m.branch_id = ${branchId} or m.branch_id is null)` : sql`true`}
     order by m.product_id, m.occurred_on desc, m.created_at desc
  `);
  for (const r of written.rows) {
    const unit = r.unit;
    if (!isStoredUnit(unit)) continue;
    settle(String(r.product_id), toCanonical(Number(r.quantity_milli), unit), "MOVEMENT", String(r.id));
  }

  return { values, sources };
}

/**
 * استلاماتٌ يدويّة قد تكون هي نفسَ بندِ فاتورة — لم يُحسَم أمرُها.
 *
 * المرشَّحُ: استلامٌ سارٍ في الفترة، **غيرُ مرتبطٍ ولا مؤكَّدٍ انفصالُه**،
 * يشبهه بندٌ في نافذة سبعة أيّام (`receipts.ts`). والبنودُ تُقرأ حول
 * تاريخ الاستلام لا حول الفترة: فاتورةٌ بتاريخ ٢٠ قد تكون شحنةَ ١٨.
 */
export async function loadReceiptDuplicates(
  periodStart: string,
  periodEnd: string,
  branchId: string | null,
  baseUnitOf: ReadonlyMap<string, StoredUnit>,
  conn: Conn = db,
): Promise<DuplicateCandidate[]> {
  const open = await conn.execute<Record<string, unknown>>(sql`
    select r.id, r.product_id, r.received_on, r.canonical_milli
      from inventory_receipts r
     where r.voided_at is null
       and r.invoice_line_id is null
       and not r.confirmed_separate
       and r.received_on between ${periodStart} and ${periodEnd}
       and ${branchId ? sql`(r.branch_id = ${branchId} or r.branch_id is null)` : sql`true`}
  `);
  if (open.rows.length === 0) return [];

  const productIds = [...new Set(open.rows.map((r) => String(r.product_id)))];
  const from = shiftDays(periodStart, -RECEIPT_MATCH_WINDOW_DAYS);
  const until = shiftDays(periodEnd, RECEIPT_MATCH_WINDOW_DAYS);
  const lines = await invoiceLinesForMatch(productIds, from, until, baseUnitOf, conn);
  const linked = await linkedInvoiceLineIds(conn);

  return open.rows.flatMap((r) => duplicateCandidates({
    id: String(r.id),
    productId: String(r.product_id),
    receivedOn: String(r.received_on),
    canonicalMilli: Number(r.canonical_milli),
  }, lines, linked));
}

/** بنودُ الفواتير لأصنافٍ بأعيانها في نافذة — بكمّيّتها المعياريّة أو `null`. */
export async function invoiceLinesForMatch(
  productIds: readonly string[],
  from: string,
  until: string,
  baseUnitOf: ReadonlyMap<string, StoredUnit>,
  conn: Conn = db,
) {
  if (productIds.length === 0) return [];
  const rows = await conn.execute<Record<string, unknown>>(sql`
    select il.id as line_id, il.invoice_id, i.invoice_number, su.name_ar as supplier_name,
           coalesce(i.received_on, to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD')) as effective_date,
           il.description, sp.product_id, il.qty, il.line_total_minor,
           sp.pack_size, sp.content_unit, sp.content_quantity
      from invoice_lines il
      join invoices i on i.id = il.invoice_id
      join suppliers su on su.id = i.supplier_id
      join supplier_products sp on sp.id = il.supplier_product_id
     where sp.product_id in (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})
       and coalesce(i.received_on, to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD')) between ${from} and ${until}
  `);
  return rows.rows.map((r) => {
    const productId = String(r.product_id);
    const base = baseUnitOf.get(productId);
    const line: PurchaseLineInput = {
      lineId: String(r.line_id), invoiceId: String(r.invoice_id), invoiceNumber: String(r.invoice_number),
      supplierName: String(r.supplier_name), invoiceDate: String(r.effective_date),
      description: String(r.description), productId,
      qty: r.qty === null ? null : String(r.qty), lineTotalMinor: Number(r.line_total_minor),
      packSize: r.pack_size === null ? null : String(r.pack_size),
      contentUnit: isStoredUnit(r.content_unit) ? r.content_unit : null,
      contentQuantity: r.content_quantity === null ? null : String(r.content_quantity),
    };
    const q = base ? purchaseQuantity(line, base) : { known: false as const };
    return {
      lineId: line.lineId, invoiceId: line.invoiceId, invoiceNumber: line.invoiceNumber,
      supplierName: line.supplierName, productId, effectiveDate: line.invoiceDate,
      canonicalMilli: q.known ? q.canonicalMilli : null, lineTotalMinor: line.lineTotalMinor,
    };
  });
}

/** بنودٌ يمثّلها استلامٌ سارٍ — لا تُرشَّح ثانيةً. */
export async function linkedInvoiceLineIds(conn: Conn = db): Promise<Set<string>> {
  const rows = await conn.execute<{ invoice_line_id: string }>(sql`
    select invoice_line_id from inventory_receipts
     where invoice_line_id is not null and voided_at is null
  `);
  return new Set(rows.rows.map((r) => String(r.invoice_line_id)));
}

async function loadMovements(
  periodStart: string,
  periodEnd: string,
  branchId: string | null,
  conn: Conn,
): Promise<{ inByProduct: Map<string, number>; outByProduct: Map<string, number> }> {
  const rows = await conn
    .select({
      productId: inventoryMovements.productId,
      kind: inventoryMovements.kind,
      quantityMilli: inventoryMovements.quantityMilli,
      unit: inventoryMovements.unit,
    })
    .from(inventoryMovements)
    .where(and(
      sql`${inventoryMovements.occurredOn} >= ${periodStart}`,
      sql`${inventoryMovements.occurredOn} <= ${periodEnd}`,
      sql`${inventoryMovements.kind} <> 'OPENING'`,
      /* والفارغُ «لم نكن نعرف» لا «فرعٌ آخر» — كما في المبيعات */
      branchId ? sql`(${inventoryMovements.branchId} = ${branchId} or ${inventoryMovements.branchId} is null)` : sql`true`,
    ));

  const inByProduct = new Map<string, number>();
  const outByProduct = new Map<string, number>();
  for (const r of rows) {
    const canonical = toCanonical(Number(r.quantityMilli), r.unit);
    const target = r.kind === "ADJUST_IN" || r.kind === "TRANSFER_IN" ? inByProduct : outByProduct;
    target.set(r.productId, (target.get(r.productId) ?? 0) + canonical);
  }
  return { inByProduct, outByProduct };
}

async function loadWaste(
  periodStart: string,
  periodEnd: string,
  branchId: string | null,
  conn: Conn,
): Promise<Map<string, number>> {
  const rows = await conn
    .select({
      productId: wasteRecords.productId,
      quantityMilli: wasteRecords.quantityMilli,
      unit: wasteRecords.unit,
    })
    .from(wasteRecords)
    .where(and(
      sql`${wasteRecords.occurredOn} >= ${periodStart}`,
      sql`${wasteRecords.occurredOn} <= ${periodEnd}`,
      branchId ? sql`(${wasteRecords.branchId} = ${branchId} or ${wasteRecords.branchId} is null)` : sql`true`,
    ));

  const out = new Map<string, number>();
  for (const r of rows) {
    out.set(r.productId, (out.get(r.productId) ?? 0) + toCanonical(Number(r.quantityMilli), r.unit));
  }
  return out;
}

/** معدَّلُ كلفةِ الوحدة من آخر شراءٍ معروفِ الكمّيّة قبل الفترة — بمِلّي‑الهللة. */
function fallbackCosts(
  lookback: readonly PurchaseLineInput[],
  baseUnitOf: ReadonlyMap<string, StoredUnit>,
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  /* الأحدثُ يغلب، فيُمرّ من الأقدم إلى الأحدث ويُكتَب فوق السابق */
  for (const line of lookback) {
    if (!line.productId) continue;
    const base = baseUnitOf.get(line.productId);
    if (!base) continue;
    const q = purchaseQuantity(line, base);
    if (!q.known || q.canonicalMilli <= 0 || line.lineTotalMinor <= 0) continue;
    const perBaseUnit = toCanonical(1000, base);
    /* بمِلّي‑الهللة: المعدَّلُ قد يكون كسراً، ولا يُقرَّب قبل أن يُضرَب في الكمّيّة */
    out.set(line.productId, Math.round((line.lineTotalMinor * MILLI_MINOR) / (q.canonicalMilli / perBaseUnit)));
  }
  return out;
}

/**
 * كلفةُ الكتالوج المعياريّة — بمِلّي‑الهللة لوحدة الأساس.
 *
 * وهي العبوةُ وكلفتُها كما كتبهما المقهى في نقاط البيع: كرتونٌ فيه
 * ‏٥٠٠ كاسٍ بـ٢١٥ ريالاً. والقسمةُ تقع هنا لا عند الحفظ، فتُحفَظ
 * الثلاثةُ كما هي ولا يُحفَظ خارجُ قسمتها.
 *
 * ولا تُستعمَل إلّا حين لا فاتورةَ: **الفاتورةُ واقعةٌ والكتالوجُ
 * تقدير.**
 */
async function catalogCosts(
  baseUnitOf: ReadonlyMap<string, StoredUnit>,
  conn: Conn,
): Promise<Map<string, number | null>> {
  const rows = await conn
    .select({
      id: products.id,
      packMilli: products.catalogPackMilli,
      packCostMinor: products.catalogPackCostMinor,
    })
    .from(products)
    .where(sql`${products.catalogPackMilli} is not null and ${products.catalogPackCostMinor} is not null`);

  const out = new Map<string, number | null>();
  for (const r of rows) {
    const packMilli = Number(r.packMilli);
    const cost = Number(r.packCostMinor);
    if (!baseUnitOf.has(r.id) || packMilli <= 0 || cost <= 0) continue;
    /* المعامِلُ بوحدة الصرف نفسِها، وهي وحدةُ الأساس — فلا تحويلَ بينهما */
    out.set(r.id, Math.round((MILLI * cost * MILLI_MINOR) / packMilli));
  }
  return out;
}

export interface ActualInput {
  productId: string;
  /** بالمِلّي المعياريّ، و`null` «لم يُعَدّ بعد». */
  actualMilli: number | null;
}

/** يجمع كلَّ ما يحتاجه المحرّك لفترةٍ وفرع. */
export async function buildEngineInput(
  periodStart: string,
  periodEnd: string,
  branchId: string | null,
  actuals: ReadonlyMap<string, number | null>,
  conn: Conn = db,
  /** أصنافُ هذا الجرد — وغيابُها «الكلُّ داخل». */
  inScope?: ReadonlySet<string>,
  /** الجردُ الذي يُحسَب — ومنه الافتتاحيُّ اليدويّ. */
  countId: string | null = null,
): Promise<EngineInput> {
  const countedProducts = await loadCountedProducts(conn);
  const productIds = countedProducts.map((p) => p.id);
  const baseUnitOf = new Map(countedProducts.map((p) => [p.id, p.baseUnit] as const));

  /*
    ── متتابعةٌ لا متوازية حين تكون المعاملةُ جارية ──

    المعاملةُ تحجز اتّصالاً واحداً، فستّةُ استعلاماتٍ متوازية عليه
    تتزاحم. والفرقُ في الزمن لا يُذكَر أمام عطبٍ يقع في الاختبار وحده.
  */
  const soldLines = await loadSoldLines(periodStart, periodEnd, branchId, conn);
  const purchases = await loadPurchaseLines(periodStart, periodEnd, conn, branchId);
  const recipeVersions = await loadRecipeVersions(conn);
  const opening = await resolveOpenings(countId, periodStart, branchId, productIds, conn);
  const duplicates = await loadReceiptDuplicates(periodStart, periodEnd, branchId, baseUnitOf, conn);
  const movements = await loadMovements(periodStart, periodEnd, branchId, conn);
  const waste = await loadWaste(periodStart, periodEnd, branchId, conn);
  const catalog = await catalogCosts(baseUnitOf, conn);

  return {
    periodStart,
    periodEnd,
    products: countedProducts,
    soldLines,
    recipeVersions,
    purchaseLines: purchases.inPeriod,
    ambiguousReceipts: purchases.ambiguous,
    openingByProduct: opening.values,
    openingSourceByProduct: opening.sources,
    receiptDuplicates: duplicates,
    adjustmentsInByProduct: movements.inByProduct,
    adjustmentsOutByProduct: movements.outByProduct,
    wasteByProduct: waste,
    actualByProduct: actuals,
    fallbackCostByProduct: fallbackCosts(purchases.lookback, baseUnitOf),
    catalogCostByProduct: catalog,
    inScopeByProduct: inScope,
  };
}

/* ─────────────────────────── نطاقُ الجرد ─────────────────────────── */

/**
 * أصنافُ هذا الجرد — ومن ليس فيها فخارجَه.
 *
 * ── النطاقُ حالٌ محفوظة لا استنتاج ──
 *
 * كان يُستنتَج «أاختار الإنسانُ؟» من وجود صفٍّ مستبعَد. فمن ورث ‏٢٤
 * صنفاً من ٦٠ ثمّ اختار الستّين كلَّها لم يبقَ صفٌّ مستبعَد — فيُقرأ
 * الجردُ «لم يُختَر له» ويُورَّث ثانيةً، **ويضيع اختيارُه بتحديث
 * الصفحة**. فصار للجرد `scope_source` (`041`):
 *
 *   `EXPLICIT` — حفظه إنسان: يُقرأ من أسطره كما هي، ولا يمسّه التوريث.
 *   `INHERITED` — يُقرأ من **أحدث جردٍ سابق في الفرع نفسه**، بنطاقه
 *   النهائيّ أيّاً كان مصدرُه. وإن لم يوجد سابقٌ فالكلُّ داخل.
 *
 * ولا يُتوارَث من فرعٍ آخر: لكلّ فرعٍ رفُّه.
 */
export async function loadScope(
  countId: string,
  conn: Conn = db,
): Promise<{ excluded: Set<string>; inherited: boolean; explicit: boolean }> {
  const [count] = (await conn.execute<{ scope_source: string }>(sql`
    select scope_source from inventory_counts where id = ${countId}
  `)).rows;

  if (count?.scope_source === "EXPLICIT") {
    const mine = await conn.execute<{ product_id: string }>(sql`
      select product_id from inventory_count_lines
       where count_id = ${countId} and in_scope = false
    `);
    return { excluded: new Set(mine.rows.map((r) => String(r.product_id))), inherited: false, explicit: true };
  }

  const previous = await conn.execute<{ id: string }>(sql`
    select prev.id
      from inventory_counts prev
      join inventory_counts cur on cur.id = ${countId}
     where prev.id <> cur.id
       and coalesce(prev.branch_id, '~') = coalesce(cur.branch_id, '~')
       and prev.period_end < cur.period_start
     order by prev.period_end desc
     limit 1
  `);
  const prevId = previous.rows[0]?.id;
  if (!prevId) return { excluded: new Set(), inherited: false, explicit: false };

  const excluded = await conn.execute<{ product_id: string }>(sql`
    select product_id from inventory_count_lines
     where count_id = ${String(prevId)} and in_scope = false
  `);
  return {
    excluded: new Set(excluded.rows.map((r) => String(r.product_id))),
    /* «موروث» يُقال حين يوجد ما يُورَث — ولو كان «الكلَّ داخل» */
    inherited: true,
    explicit: false,
  };
}

/** معرّفٌ ليس صنفاً في هذا الجرد — يُلغي العمليّةَ كلَّها. */
export class ScopeItemNotInCountError extends Error {
  constructor(readonly productIds: readonly string[]) {
    super(`${productIds.length} صنفاً ليس في هذا الجرد — لم يُحفَظ شيءٌ من النطاق. حدّث الصفحة.`);
    this.name = "ScopeItemNotInCountError";
  }
}

/**
 * يحفظ نطاقَ الجرد — **عمليّةٌ واحدة**.
 *
 * كانت الشاشة ترسل طلبين (الداخل ثمّ الخارج)، فإن سقط الثاني بقي
 * النطاقُ نصفَ مكتوب ولا يعرف أحدٌ أين وقف. فصار:
 *
 *   تحقُّقٌ من كلّ معرّف ← كتابةُ الأسطر ← وسمُ الجرد `EXPLICIT` ← أثر
 *
 * في معاملةٍ واحدة. ومعرّفٌ واحدٌ غريب يُلغي الكلَّ.
 *
 * ولا يُمَسّ العدُّ المكتوب: من استبعد صنفاً عدّه ثمّ أعاده وجد عدَّه.
 * والمقفَلُ يُرَدّ هنا وفي القاعدة معاً.
 */
export async function saveCountScope(
  countId: string,
  change: { included: readonly string[]; excluded: readonly string[] },
  actorId: string,
  conn: Conn = db,
): Promise<{ included: number; excluded: number }> {
  const header = await loadCountHeader(countId, conn);
  if (!header) throw new Error("الجرد غير موجود");
  if (header.status === "FINALISED") throw new CountLockedError();

  const both = new Set([...change.included, ...change.excluded]);
  if (both.size !== change.included.length + change.excluded.length) {
    throw new Error("صنفٌ واحدٌ ذُكر داخلاً وخارجاً معاً — لم يُحفَظ شيء.");
  }

  return conn.transaction(async (tx) => {
    /* الأسطرُ تُهيَّأ داخل المعاملة نفسِها — فلا يُكتَب نطاقٌ على غير موجود */
    await recomputeCount(countId, tx);

    const present = await tx.execute<{ product_id: string }>(sql`
      select product_id from inventory_count_lines where count_id = ${countId}
    `);
    const known = new Set(present.rows.map((r) => String(r.product_id)));
    const strangers = [...both].filter((id) => !known.has(id));
    if (strangers.length > 0) throw new ScopeItemNotInCountError(strangers);

    for (const [ids, inScope] of [[change.included, true], [change.excluded, false]] as const) {
      if (ids.length === 0) continue;
      await tx
        .update(inventoryCountLines)
        .set({ inScope })
        .where(and(eq(inventoryCountLines.countId, countId), inArray(inventoryCountLines.productId, [...ids])));
    }

    /* والصريحُ صريحٌ ولو اختار الكلّ — الأثرُ في الجرد لا في وجود مستبعَد */
    await tx.update(inventoryCounts).set({ scopeSource: "EXPLICIT" }).where(eq(inventoryCounts.id, countId));

    await recordAudit({
      actorId,
      action: "INVENTORY_COUNT_SCOPE_SET",
      entityType: "inventory_count",
      entityId: countId,
      before: { المصدر: header.scopeSource },
      after: { المصدر: "EXPLICIT", داخلة: change.included.length, خارجة: change.excluded.length },
    }, tx);

    return { included: change.included.length, excluded: change.excluded.length };
  });
}

/* ─────────────────────── الرصيدُ الافتتاحيّ اليدويّ ─────────────────────── */

/** الرصيدُ اليدويّ الساري لكلّ صنفٍ في جرد — بوحدته كما كُتب، لمحرّر التعديل. */
export async function loadManualOpenings(
  countId: string,
  conn: Conn = db,
): Promise<Map<string, { enteredMilli: number; unit: StoredUnit }>> {
  const rows = await conn
    .select({
      productId: inventoryCountOpenings.productId,
      enteredMilli: inventoryCountOpenings.enteredMilli,
      unit: inventoryCountOpenings.enteredUnit,
    })
    .from(inventoryCountOpenings)
    .where(and(eq(inventoryCountOpenings.countId, countId), sql`${inventoryCountOpenings.supersededAt} is null`));
  return new Map(rows.map((r) => [r.productId, { enteredMilli: Number(r.enteredMilli), unit: r.unit }]));
}


export interface OpeningEntry {
  productId: string;
  /** بالمِلّي من `unit` كما أُدخل، و`null` = «أفرِغه» فيعود غير معروف. */
  enteredMilli: number | null;
  unit: StoredUnit;
  note?: string | null;
}

/**
 * يكتب الرصيدَ الافتتاحيّ يدوياً — أصنافاً بأعيانها في جردٍ بعينه.
 *
 * **والتعديلُ لا يكتب فوق السابق**: يُغلقه (`superseded_at`) ويُضيف
 * جديداً، فيبقى التاريخُ كلُّه. والإفراغُ يُغلقه بلا بديل — فيعود
 * الافتتاحيُّ إلى ما دونه في الترتيب، أو «غير معروف»، **لا صفراً**.
 *
 * والتحويلُ هنا لا في المتصفّح: «٥٫٢ كجم» تصل نصّاً ووحدة، وتُحوَّل
 * إلى المِلّي المعياريّ بقراءةٍ عشريّة لا تمرّ بفاصلةٍ عائمة.
 */
export async function setOpenings(
  countId: string,
  entries: readonly OpeningEntry[],
  actorId: string,
  conn: Conn = db,
): Promise<{ set: number; cleared: number }> {
  const header = await loadCountHeader(countId, conn);
  if (!header) throw new Error("الجرد غير موجود");
  if (header.status === "FINALISED") throw new CountLockedError();
  if (entries.length === 0) return { set: 0, cleared: 0 };

  return conn.transaction(async (tx) => {
    const ids = [...new Set(entries.map((e) => e.productId))];
    const known = await tx
      .select({ id: products.id, baseUnit: products.baseUnit, name: products.nameAr })
      .from(products)
      .where(and(inArray(products.id, ids), eq(products.isStockItem, true)));
    const byId = new Map(known.map((p) => [p.id, p]));

    let set = 0;
    let cleared = 0;
    for (const e of entries) {
      const product = byId.get(e.productId);
      if (!product) throw new Error("صنفٌ ليس من أصناف المخزون — لم يُحفَظ شيء.");
      if (e.enteredMilli !== null && (!Number.isInteger(e.enteredMilli) || e.enteredMilli < 0)) {
        throw new Error(`رصيدٌ غير مقروء لـ«${product.name}»`);
      }
      if (e.enteredMilli !== null && !sameUnitFamily(e.unit, product.baseUnit)) {
        throw new Error(`وحدةُ «${product.name}» لا تُحوَّل إلى وحدته — وزنٌ لا يصير حجماً`);
      }

      const [previous] = await tx
        .update(inventoryCountOpenings)
        .set({ supersededAt: new Date(), supersededById: actorId })
        .where(and(
          eq(inventoryCountOpenings.countId, countId),
          eq(inventoryCountOpenings.productId, e.productId),
          sql`${inventoryCountOpenings.supersededAt} is null`,
        ))
        .returning({ enteredMilli: inventoryCountOpenings.enteredMilli, enteredUnit: inventoryCountOpenings.enteredUnit });

      if (e.enteredMilli === null) {
        if (!previous) continue;
        cleared++;
        await recordAudit({
          actorId,
          action: "INVENTORY_OPENING_CLEARED",
          entityType: "inventory_count",
          entityId: countId,
          before: { الصنف: product.name, الرصيد: Number(previous.enteredMilli), الوحدة: previous.enteredUnit },
        }, tx);
        continue;
      }

      await tx.insert(inventoryCountOpenings).values({
        countId,
        productId: e.productId,
        enteredMilli: e.enteredMilli,
        enteredUnit: e.unit,
        canonicalMilli: toCanonical(e.enteredMilli, e.unit),
        note: e.note ?? null,
        createdById: actorId,
      });
      set++;

      await recordAudit({
        actorId,
        action: "INVENTORY_OPENING_SET",
        entityType: "inventory_count",
        entityId: countId,
        before: previous
          ? { الصنف: product.name, الرصيد: Number(previous.enteredMilli), الوحدة: previous.enteredUnit }
          : null,
        after: {
          الصنف: product.name,
          الرصيد: e.enteredMilli,
          الوحدة: e.unit,
          الفترة: `${header.periodStart} → ${header.periodEnd}`,
          الفرع: header.branchName ?? "—",
          المصدر: "MANUAL",
        },
      }, tx);
    }

    await recomputeCount(countId, tx);
    return { set, cleared };
  });
}

/* ─────────────────────────── دورةُ الجرد ─────────────────────────── */

export async function loadCountHeader(countId: string, conn: Conn = db): Promise<CountHeader | null> {
  const rows = await conn.execute<Record<string, unknown>>(sql`
    select c.*, b.name_ar as branch_name
      from inventory_counts c
      left join branches b on b.id = c.branch_id
     where c.id = ${countId}
     limit 1
  `);
  const r = rows.rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    branchId: r.branch_id === null ? null : String(r.branch_id),
    branchName: r.branch_name === null ? null : String(r.branch_name),
    periodStart: String(r.period_start),
    periodEnd: String(r.period_end),
    status: r.status as "DRAFT" | "FINALISED",
    readiness: (r.readiness ?? null) as CountHeader["readiness"],
    startedAt: new Date(String(r.started_at)),
    finalisedAt: r.finalised_at === null ? null : new Date(String(r.finalised_at)),
    reopenCount: Number(r.reopen_count),
    note: r.note === null ? null : String(r.note),
    scopeSource: r.scope_source === "EXPLICIT" ? "EXPLICIT" : "INHERITED",
  };
}

/** العدُّ الفعليّ كما أُدخل — من أسطر الجرد نفسِها. */
export async function loadActuals(countId: string, conn: Conn = db): Promise<Map<string, number | null>> {
  const rows = await conn
    .select({ productId: inventoryCountLines.productId, actualMilli: inventoryCountLines.actualMilli })
    .from(inventoryCountLines)
    .where(eq(inventoryCountLines.countId, countId));
  return new Map(rows.map((r) => [r.productId, r.actualMilli === null ? null : Number(r.actualMilli)]));
}

export interface StartCountInput {
  periodStart: string;
  periodEnd: string;
  branchId: string | null;
  actorId: string;
  note?: string | null;
}

/**
 * يبدأ جرداً — أو يُرجع القائم.
 *
 * وجردٌ واحد للفترة الواحدة في الفرع الواحد: يحرسه فهرسٌ فريد في
 * القاعدة. فضغطتان على «ابدأ جرداً» لا تُنشئان جردين نصفُ العدّ في
 * كلٍّ منهما.
 *
 * **ولا تتداخل فترتان** — والتداخلُ أخطرُ من التطابق: يوماً واحداً
 * مشتركاً يعني أنّ شراءَ ذلك اليوم واستهلاكَه يُحسَبان في جردين،
 * وفعليُّ الأوّل افتتاحيُّ الثاني وقد مضى عليه يومٌ لم يُحسَب. فالمنعُ
 * في القاعدة بمؤثِّر (`037`)، ويُقال هنا **قبل أن يصل الطلبُ إليها**
 * بلغةٍ تُقرأ ومعها الفترةُ المتعارضة — فرسالةُ Postgres ليست جواباً
 * لصاحب المقهى.
 */
export async function startCount(input: StartCountInput, conn: Conn = db): Promise<{ countId: string; created: boolean }> {
  if (input.periodEnd < input.periodStart) throw new Error("نهايةُ الفترة قبل بدايتها");
  /*
    ── الأسبوعُ من الأحد إلى السبت، ويُفرَض هنا ──

    لأنّ فعليَّ الأسبوع هو افتتاحيُّ الذي يليه: فترةٌ تبدأ الأربعاء
    تترك يومين خارج كلّ جرد، أو تُدخلهما في جردين. والمؤثِّرُ في
    القاعدة يمنع التداخل، وهذا يمنع الفجوة.
  */
  if (!isInventoryWeek(input.periodStart, input.periodEnd)) {
    throw new NotAWeekError(weekOf(input.periodStart));
  }

  const clash = await conn.execute<{ id: string; period_start: string; period_end: string }>(sql`
    select id, period_start, period_end from inventory_counts
     where coalesce(branch_id, '~') = coalesce(${input.branchId}::text, '~')
       and period_start <= ${input.periodEnd}
       and period_end   >= ${input.periodStart}
     order by period_start
     limit 1
  `);
  const found = clash.rows[0];
  if (found) {
    /* المتطابقةُ هي الجردُ نفسُه — تُفتَح ولا تُنشَأ ثانيةً */
    if (String(found.period_start) === input.periodStart && String(found.period_end) === input.periodEnd) {
      return { countId: String(found.id), created: false };
    }
    throw new OverlappingPeriodError(String(found.period_start), String(found.period_end));
  }

  const [row] = await conn
    .insert(inventoryCounts)
    .values({
      branchId: input.branchId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: "DRAFT",
      note: input.note ?? null,
      startedById: input.actorId,
    })
    .returning({ id: inventoryCounts.id });

  await recordAudit({
    actorId: input.actorId,
    action: "INVENTORY_COUNT_STARTED",
    entityType: "inventory_count",
    entityId: row.id,
    after: { الفترة: `${input.periodStart} → ${input.periodEnd}`, الفرع: input.branchId ?? "الكلّ" },
  }, conn);

  return { countId: row.id, created: true };
}

/**
 * يحسب التقرير كلَّه من الوقائع، ويكتب أسطرَه.
 *
 * ويُعاد كلّما فُتحت الشاشة ما دام الجرد مسوّدةً: المبيعاتُ قد تُستورَد
 * بعد بدء الجرد، والفاتورةُ قد تصل، والوصفةُ قد تُصحَّح. **والمقفَلُ لا
 * يُعاد حسابُه** — يُقرأ من أسطره كما جُمّدت.
 */
export async function recomputeCount(countId: string, conn: Conn = db): Promise<EngineReport> {
  const header = await loadCountHeader(countId, conn);
  if (!header) throw new Error("الجرد غير موجود");
  if (header.status === "FINALISED") return readFrozenReport(header, conn);

  const actuals = await loadActuals(countId, conn);
  /* النطاقُ يُقرأ قبل الحساب — فالخارجُ لا يُحسَب له فرقٌ ولا يدخل مجموعاً */
  const scope = await loadScope(countId, conn);
  const products = await loadCountedProducts(conn);
  const inScope = new Set(products.map((p) => p.id).filter((id) => !scope.excluded.has(id)));

  const input = await buildEngineInput(
    header.periodStart, header.periodEnd, header.branchId, actuals, conn, inScope, countId,
  );
  const report = reconcile(input);

  /*
    والموروثُ يتبع مصدرَه ما دام موروثاً — فتُكتَب أسطرُه بما وُرث.
    والصريحُ **لا تمسّه إعادةُ الحساب**: حفظه إنسان.
  */
  await persistLines(countId, report, conn, !scope.explicit);
  await conn
    .update(inventoryCounts)
    .set({ readiness: report.coverage.readiness, coverage: report.coverage as never })
    .where(eq(inventoryCounts.id, countId));

  return report;
}

async function persistLines(
  countId: string,
  report: EngineReport,
  conn: Conn,
  /** أيُكتَب النطاقُ فوق القائم؟ — للموروث وحده، والصريحُ لا يُمَسّ. */
  mirrorScope = false,
): Promise<void> {
  if (report.lines.length === 0) return;

  await conn.transaction(async (tx) => {
    const values = report.lines.map((l) => ({
      countId,
      productId: l.productId,
      /*
        ويُكتَب النطاقُ عند الإنشاء وحده — لا في `onConflictDoUpdate`
        أدناه. فالسطرُ القائم يحمل اختيارَ إنسان، وإعادةُ الحساب لا
        تدهسه؛ والجديدُ يرث ما ورّثه الجردُ السابق.
      */
      inScope: l.inScope,
      openingSource: l.openingSource,
      openingRef: l.openingRef,
      manualReceiptsMilli: l.manualReceiptsMilli,
      baseUnit: l.baseUnit,
      openingMilli: l.openingMilli,
      purchasesMilli: l.purchasesMilli,
      adjustmentsInMilli: l.adjustmentsInMilli,
      adjustmentsOutMilli: l.adjustmentsOutMilli,
      theoreticalConsumptionMilli: l.theoreticalConsumptionMilli,
      recordedWasteMilli: l.recordedWasteMilli,
      theoreticalClosingMilli: l.theoreticalClosingMilli,
      actualMilli: l.actualMilli,
      varianceMilli: l.varianceMilli,
      varianceConsumptionBp: l.varianceConsumptionBp,
      varianceBp: l.varianceBp,
      unitCostMinor: l.unitCostMinor,
      unitCostMilliMinor: l.unitCostMilliMinor,
      valuationBasis: l.valuationBasis,
      varianceCostMinor: l.varianceCostMinor,
      flags: l.flags as never,
    }));

    for (let i = 0; i < values.length; i += 300) {
      await tx
        .insert(inventoryCountLines)
        .values(values.slice(i, i + 300))
        .onConflictDoUpdate({
          target: [inventoryCountLines.countId, inventoryCountLines.productId],
          set: {
            baseUnit: sql`excluded.base_unit`,
            openingMilli: sql`excluded.opening_milli`,
            purchasesMilli: sql`excluded.purchases_milli`,
            adjustmentsInMilli: sql`excluded.adjustments_in_milli`,
            adjustmentsOutMilli: sql`excluded.adjustments_out_milli`,
            theoreticalConsumptionMilli: sql`excluded.theoretical_consumption_milli`,
            recordedWasteMilli: sql`excluded.recorded_waste_milli`,
            theoreticalClosingMilli: sql`excluded.theoretical_closing_milli`,
            varianceMilli: sql`excluded.variance_milli`,
            varianceConsumptionBp: sql`excluded.variance_consumption_bp`,
            varianceBp: sql`excluded.variance_bp`,
            unitCostMinor: sql`excluded.unit_cost_minor`,
            unitCostMilliMinor: sql`excluded.unit_cost_milli_minor`,
            valuationBasis: sql`excluded.valuation_basis`,
            varianceCostMinor: sql`excluded.variance_cost_minor`,
            flags: sql`excluded.flags`,
            openingSource: sql`excluded.opening_source`,
            openingRef: sql`excluded.opening_ref`,
            manualReceiptsMilli: sql`excluded.manual_receipts_milli`,
            ...(mirrorScope ? { inScope: sql`excluded.in_scope` } : {}),
            /* والعدُّ الفعليّ لا يُمَسّ — كتبه إنسان، ولا يُدهَس بإعادة حساب */
          },
        });
    }
  });
}

/**
 * عدٌّ بوحدته كما كتبها الإنسان ← مِلّي معياريّ، **في الخادم**.
 *
 * وتُفحَص العائلة: «٥ لتر» لصنفٍ يُوزَن بالكيلو كانت تُحوَّل إلى مِلّي
 * المليلتر ثمّ تُقرأ مِلّي‑جرام — رقمٌ صحيحُ الشكل خاطئُ المعنى.
 */
export async function canonicalCounts(
  entries: readonly { productId: string; milli: number | null; unit: StoredUnit }[],
  conn: Conn = db,
): Promise<ActualInput[]> {
  if (entries.length === 0) return [];
  const ids = [...new Set(entries.map((e) => e.productId))];
  const rows = await conn
    .select({ id: products.id, baseUnit: products.baseUnit, name: products.nameAr })
    .from(products)
    .where(inArray(products.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));

  return entries.map((e) => {
    const p = byId.get(e.productId);
    if (!p) throw new Error("صنفٌ غير معروف — حدّث الصفحة");
    if (e.milli === null) return { productId: e.productId, actualMilli: null };
    if (!sameUnitFamily(e.unit, p.baseUnit)) {
      throw new Error(`وحدةُ «${p.name}» لا تُحوَّل إلى وحدته — وزنٌ لا يصير حجماً`);
    }
    return { productId: e.productId, actualMilli: toCanonical(e.milli, e.unit) };
  });
}

/**
 * العدُّ الفعليّ — وهو **كلُّ** ما يؤخذ من المتصفّح.
 *
 * ويُعاد حساب السطر كلِّه في الخادم بعده. ولا يُقبَل على جردٍ مقفَل:
 * يمنعه مؤثِّرُ القاعدة أيضاً، وهذا الفحصُ ليقرأ المستخدمُ سبباً لا
 * خطأً تقنيّاً.
 */
export async function saveActualCounts(
  countId: string,
  entries: readonly ActualInput[],
  actorId: string,
  conn: Conn = db,
): Promise<EngineReport> {
  const header = await loadCountHeader(countId, conn);
  if (!header) throw new Error("الجرد غير موجود");
  if (header.status === "FINALISED") throw new CountLockedError();

  /*
    ── الأسطرُ تُهيَّأ قبل أن يُكتَب فيها ──

    العدُّ يُكتب بـ`update` على سطرٍ موجود. فلو استُدعيت هذه قبل أن
    يُحسَب الجرد مرّةً واحدة لم يُطابِق الشرطُ شيئاً، **فتنجح الكتابةُ
    ولا تكتب** — ويظنّ صاحبُ المقهى أنّه عدّ الرفَّ كلَّه ثمّ يجد
    الشاشة فارغة. والترتيبُ كان مضموناً في الواجهة وحدها، وذلك اتّفاقٌ
    لا حارس.
  */
  await recomputeCount(countId, conn);
  if (entries.length === 0) return recomputeCount(countId, conn);

  await conn.transaction(async (tx) => {
    for (const e of entries) {
      if (e.actualMilli !== null && !Number.isFinite(e.actualMilli)) {
        throw new Error("كمّيّةٌ غير مقروءة");
      }
      /*
        ويُعَدّ أثرُ الكتابة — الشرطُ في `where` بلا فحصِ عدد الصفوف
        لا يمنع شيئاً ولا يُعلن عجزَه. وصنفٌ ليس في هذا الجرد (عُطّل
        بعد بدئه مثلاً) يُقال باسمه لا يُبتلَع.
      */
      const written = await tx
        .update(inventoryCountLines)
        .set({ actualMilli: e.actualMilli, countedById: actorId, countedAt: new Date() })
        .where(and(eq(inventoryCountLines.countId, countId), eq(inventoryCountLines.productId, e.productId)))
        .returning({ id: inventoryCountLines.id });

      if (written.length === 0) {
        throw new Error(`صنفٌ ليس في هذا الجرد — لم يُكتب عدُّه (${e.productId}). حدّث الصفحة.`);
      }
    }

    await recordAudit({
      actorId,
      action: "INVENTORY_COUNT_LINE_EDITED",
      entityType: "inventory_count",
      entityId: countId,
      after: { أصناف: entries.length, أُفرغ: entries.filter((e) => e.actualMilli === null).length },
    }, tx);
  });

  return recomputeCount(countId, conn);
}

/**
 * الإقفال: يُعاد الحساب، ثمّ تُكتَب اللقطة، ثمّ يُقفَل.
 *
 * والترتيبُ ملزِم — بعد الإقفال يرفض مؤثِّرُ القاعدة كتابةَ سطرٍ أو
 * لقطة. وهذا هو الحارسُ الذي يجعل «التقرير التاريخيّ» صادقاً: ليس
 * اتّفاقاً على ألّا نكتب، بل منعاً من أن نكتب.
 */
export async function finaliseCount(countId: string, actorId: string, conn: Conn = db): Promise<EngineReport> {
  const header = await loadCountHeader(countId, conn);
  if (!header) throw new Error("الجرد غير موجود");
  if (header.status === "FINALISED") throw new CountLockedError();

  const report = await recomputeCount(countId, conn);

  const provenance = {
    engineVersion: ENGINE_VERSION,
    recipeVersionIds: [...new Set(report.lines.flatMap((l) => l.recipeVersionIds))].sort(),
    invoiceLineIds: [...new Set(report.lines.flatMap((l) => l.invoiceLineIds))].sort(),
    /* وما أدخله إنسان: الاستلاماتُ ومصادرُ الافتتاحيّ ونطاقُ الجرد */
    receiptIds: [...new Set(report.lines.flatMap((l) => l.receiptIds))].sort(),
    openings: report.lines
      .filter((l) => l.openingSource !== "UNKNOWN")
      .map((l) => ({ productId: l.productId, source: l.openingSource, ref: l.openingRef }))
      .sort((a, b) => a.productId.localeCompare(b.productId)),
    scope: {
      source: header.scopeSource,
      excluded: report.lines.filter((l) => !l.inScope).map((l) => l.productId).sort(),
    },
    salesLineIds: report.consumption.included.lines,
    salesImportIds: await importIdsFor(header.periodStart, header.periodEnd, conn),
    computedAt: new Date().toISOString(),
  };
  const payload = {
    periodStart: header.periodStart,
    periodEnd: header.periodEnd,
    branchId: header.branchId,
    coverage: report.coverage,
    totals: report.totals,
    lines: report.lines,
  };
  const checksum = createHash("sha256").update(JSON.stringify(payload)).digest("hex");

  await conn.transaction(async (tx) => {
    await tx
      .insert(inventoryCountSnapshots)
      .values({
        countId,
        engineVersion: ENGINE_VERSION,
        payload: payload as never,
        provenance: provenance as never,
        checksum,
      })
      .onConflictDoUpdate({
        target: inventoryCountSnapshots.countId,
        set: {
          engineVersion: ENGINE_VERSION,
          payload: payload as never,
          provenance: provenance as never,
          checksum,
          computedAt: new Date(),
        },
      });

    await tx
      .update(inventoryCounts)
      .set({ status: "FINALISED", finalisedById: actorId, finalisedAt: new Date() })
      .where(eq(inventoryCounts.id, countId));

    await recordAudit({
      actorId,
      action: "INVENTORY_COUNT_FINALISED",
      entityType: "inventory_count",
      entityId: countId,
      after: {
        الفترة: `${header.periodStart} → ${header.periodEnd}`,
        الجاهزيّة: report.coverage.readiness,
        أصناف_عُدّت: report.totals.linesCounted,
        كلفة_الفرق: report.totals.varianceCostMinor,
        بصمة_اللقطة: checksum.slice(0, 12),
      },
    }, tx);
  });

  return report;
}

async function importIdsFor(periodStart: string, periodEnd: string, conn: Conn): Promise<string[]> {
  const rows = await conn.execute<{ id: string }>(sql`
    select distinct s.import_id as id
      from sales s
     where s.business_date >= ${periodStart}
       and s.business_date <= ${periodEnd}
       and s.import_id is not null
  `);
  return rows.rows.map((r) => String(r.id)).sort();
}

/**
 * إعادةُ الفتح — فعلٌ صريح بسببٍ مكتوب.
 *
 * ولا تقع بالمصادفة: صلاحيّتُها `month:reopen` (للمالك وحده)، والسببُ
 * إلزاميّ، والعدّادُ يبقى — فمن يقرأ التقرير يرى أنّه أُعيد فتحُه
 * مرّتين.
 */
export async function reopenCount(countId: string, reason: string, actorId: string, conn: Conn = db): Promise<void> {
  const header = await loadCountHeader(countId, conn);
  if (!header) throw new Error("الجرد غير موجود");
  if (header.status !== "FINALISED") throw new Error("هذا الجرد مفتوحٌ أصلاً");
  if (reason.trim().length < 4) throw new Error("اكتب سبب إعادة الفتح — يبقى في سجلّ التدقيق");

  await conn.transaction(async (tx) => {
    await tx
      .update(inventoryCounts)
      .set({
        status: "DRAFT",
        reopenedById: actorId,
        reopenedAt: new Date(),
        reopenReason: reason.trim(),
        reopenCount: header.reopenCount + 1,
      })
      .where(eq(inventoryCounts.id, countId));

    await recordAudit({
      actorId,
      action: "INVENTORY_COUNT_REOPENED",
      entityType: "inventory_count",
      entityId: countId,
      after: { السبب: reason.trim(), مرّة: header.reopenCount + 1 },
    }, tx);
  });
}

/* ─────────────────────── التقريرُ المجمَّد ─────────────────────── */

/**
 * تقريرُ جردٍ مقفَل — يُقرأ من أسطره لا يُعاد حسابُه.
 *
 * وهذا هو الفرقُ العمليّ بين «تقريرٍ تاريخيّ» و«استعلامٍ عن الماضي»:
 * الأوّل يقرأ ما كُتب، والثاني يُعيد الحساب بمعرفةِ اليوم — فيتغيّر
 * كلّما عُدّلت وصفةٌ أو رُبط صنف.
 */
export async function readFrozenReport(header: CountHeader, conn: Conn = db): Promise<EngineReport> {
  const rows = await conn.execute<Record<string, unknown>>(sql`
    select l.*, p.name_ar as product_name, p.category
      from inventory_count_lines l
      join products p on p.id = l.product_id
     where l.count_id = ${header.id}
     order by p.category, p.name_ar
  `);

  const [snapshot] = (await conn
    .select({ payload: inventoryCountSnapshots.payload })
    .from(inventoryCountSnapshots)
    .where(eq(inventoryCountSnapshots.countId, header.id))
    .limit(1));

  const stored = (snapshot?.payload ?? null) as { coverage?: unknown; totals?: unknown } | null;

  const lines = rows.rows.map((r) => ({
    productId: String(r.product_id),
    productName: String(r.product_name),
    category: String(r.category),
    baseUnit: (isStoredUnit(r.base_unit) ? r.base_unit : "PIECE") as StoredUnit,
    openingMilli: num(r.opening_milli),
    purchasesMilli: num(r.purchases_milli),
    adjustmentsInMilli: Number(r.adjustments_in_milli ?? 0),
    adjustmentsOutMilli: Number(r.adjustments_out_milli ?? 0),
    theoreticalConsumptionMilli: num(r.theoretical_consumption_milli),
    recordedWasteMilli: Number(r.recorded_waste_milli ?? 0),
    theoreticalClosingMilli: num(r.theoretical_closing_milli),
    actualMilli: num(r.actual_milli),
    varianceMilli: num(r.variance_milli),
    varianceConsumptionBp: num(r.variance_consumption_bp),
    varianceBp: num(r.variance_bp),
    unitCostMinor: num(r.unit_cost_minor),
    unitCostMilliMinor: num(r.unit_cost_milli_minor),
    valuationBasis: (r.valuation_basis ?? "UNKNOWN") as EngineReport["lines"][number]["valuationBasis"],
    varianceCostMinor: num(r.variance_cost_minor),
    /* والمقفَلُ يحفظ نطاقَه كما كان — لا كما صار اليوم */
    inScope: r.in_scope !== false,
    openingSource: (r.opening_source ?? "UNKNOWN") as OpeningSource,
    openingRef: r.opening_ref === null || r.opening_ref === undefined ? null : String(r.opening_ref),
    manualReceiptsMilli: Number(r.manual_receipts_milli ?? 0),
    receiptIds: [],
    flags: (Array.isArray(r.flags) ? r.flags : []) as EngineReport["lines"][number]["flags"],
    recipeVersionIds: [],
    invoiceLineIds: [],
  }));

  /*
    والنقصُ والزيادةُ يُحسَبان من الأسطر المجمَّدة نفسِها — وهي لا تتغيّر،
    فالحسابُ عليها قراءةٌ لا إعادةُ حساب. ولجرداتٍ أُقفلت قبل أن يُحفَظ
    الملخّصُ في لقطتها يُشتقّ هنا.
  */
  const storedTotals = (stored?.totals ?? null) as Partial<EngineReport["totals"]> | null;
  const summary = storedTotals?.summary ?? summariseVariance(lines);

  return {
    engineVersion: ENGINE_VERSION,
    periodStart: header.periodStart,
    periodEnd: header.periodEnd,
    lines,
    coverage: (stored?.coverage ?? emptyCoverage(header)) as EngineReport["coverage"],
    totals: (storedTotals ? { ...storedTotals, summary } : {
      varianceCostMinor: lines.reduce((s, l) => s + (l.inScope ? l.varianceCostMinor ?? 0 : 0), 0),
      linesWithKnownCost: lines.filter((l) => l.inScope && l.varianceCostMinor !== null).length,
      linesCounted: lines.filter((l) => l.inScope && l.actualMilli !== null).length,
      linesWithVariance: lines.filter((l) => l.inScope && l.varianceMilli !== null).length,
      salesTotalMinor: 0,
      purchasesTotalMinor: 0,
      summary,
    }) as EngineReport["totals"],
    consumption: {
      byIngredient: new Map(),
      included: { lines: 0, unitsMilli: 0, totalMinor: 0 },
      excluded: [],
      excludedTotals: { lines: 0, unitsMilli: 0, totalMinor: 0 },
    },
    purchases: { byProduct: new Map(), gaps: [], gapTotals: { lines: 0, totalMinor: 0 }, totalLines: 0 },
  };
}

function num(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function emptyCoverage(header: CountHeader): EngineReport["coverage"] {
  return {
    readiness: header.readiness ?? "PARTIAL",
    sales: {
      lines: 0, daysWithSales: 0, periodDays: 0, missingDays: [],
      includedLines: 0, includedTotalMinor: 0, excludedLines: 0, excludedTotalMinor: 0,
      coveredBp: null, unitsCoveredBp: null, includedUnitsMilli: 0, excludedUnitsMilli: 0,
    },
    purchases: { lines: 0, includedLines: 0, excludedLines: 0, excludedTotalMinor: 0, coveredBp: null },
    items: { counted: 0, withKnownOpening: 0, withKnownCost: 0 },
    scope: { included: 0, excluded: 0, excludedNames: [] },
    gaps: [],
  };
}

/* ─────────────────────── السجلّ والاتّجاه ─────────────────────── */

export interface CountSummary {
  id: string;
  periodStart: string;
  periodEnd: string;
  branchName: string | null;
  status: "DRAFT" | "FINALISED";
  readiness: "READY" | "PARTIAL" | "BLOCKED" | null;
  salesMinor: number | null;
  /**
   * النقصُ والزيادةُ وحجمُهما ونسبةُ النقص — من الأسطر نفسِها
   * (`variance-summary.ts`). والصافي فيها ثانويّ: نقصٌ بألفٍ وزيادةٌ
   * بألف صافيهما صفر، **وليس ذلك «لا مشكلة»**.
   */
  summary: VarianceSummary;
  /** الصافي — يبقى للمقارنة الثانويّة، ولا يقود. */
  varianceCostMinor: number | null;
  itemsCounted: number;
  itemsInScope: number;
  finalisedAt: Date | null;
}

export async function listCounts(limit = 52, conn: Conn = db): Promise<CountSummary[]> {
  const rows = await conn.execute<Record<string, unknown>>(sql`
    select c.id, c.period_start, c.period_end, c.status, c.readiness, c.finalised_at,
           b.name_ar as branch_name,
           (c.coverage -> 'sales' ->> 'includedTotalMinor')::bigint as sales_minor
      from inventory_counts c
      left join branches b on b.id = c.branch_id
     order by c.period_end desc, c.started_at desc
     limit ${limit}
  `);
  if (rows.rows.length === 0) return [];

  /*
    الأسطرُ تُقرأ وتُجمَع في دالّةٍ واحدة (`summariseVariance`) — لا
    مجموعٌ في SQL وآخرُ في الشاشة. تعريفٌ واحدٌ للنقص في النظام كلِّه.
  */
  const ids = rows.rows.map((r) => String(r.id));
  const lineRows = await conn.execute<Record<string, unknown>>(sql`
    select count_id, in_scope, variance_milli, variance_cost_minor,
           theoretical_consumption_milli, unit_cost_milli_minor, base_unit, actual_milli
      from inventory_count_lines
     where count_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
  `);
  const byCount = new Map<string, SummaryLine[]>();
  const counted = new Map<string, number>();
  const inScope = new Map<string, number>();
  for (const l of lineRows.rows) {
    const id = String(l.count_id);
    const scoped = l.in_scope !== false;
    const list = byCount.get(id) ?? [];
    list.push({
      inScope: scoped,
      varianceMilli: num(l.variance_milli),
      varianceCostMinor: num(l.variance_cost_minor),
      theoreticalConsumptionMilli: num(l.theoretical_consumption_milli),
      unitCostMilliMinor: num(l.unit_cost_milli_minor),
      baseUnit: (isStoredUnit(l.base_unit) ? l.base_unit : "PIECE") as StoredUnit,
    });
    byCount.set(id, list);
    if (scoped) inScope.set(id, (inScope.get(id) ?? 0) + 1);
    if (scoped && l.actual_milli !== null) counted.set(id, (counted.get(id) ?? 0) + 1);
  }

  return rows.rows.map((r) => {
    const id = String(r.id);
    const summary = summariseVariance(byCount.get(id) ?? []);
    return {
      id,
      periodStart: String(r.period_start),
      periodEnd: String(r.period_end),
      branchName: r.branch_name === null ? null : String(r.branch_name),
      status: r.status as "DRAFT" | "FINALISED",
      readiness: (r.readiness ?? null) as CountSummary["readiness"],
      salesMinor: r.sales_minor === null ? null : Number(r.sales_minor),
      summary,
      varianceCostMinor: summary.netCostMinor,
      itemsCounted: counted.get(id) ?? 0,
      itemsInScope: inScope.get(id) ?? 0,
      finalisedAt: r.finalised_at === null ? null : new Date(String(r.finalised_at)),
    };
  });
}

export interface ItemHistoryRow {
  countId: string;
  periodStart: string;
  periodEnd: string;
  status: "DRAFT" | "FINALISED";
  baseUnit: StoredUnit;
  inScope: boolean;
  openingMilli: number | null;
  openingSource: OpeningSource;
  purchasesMilli: number | null;
  manualReceiptsMilli: number;
  theoreticalConsumptionMilli: number | null;
  recordedWasteMilli: number;
  theoreticalClosingMilli: number | null;
  actualMilli: number | null;
  varianceMilli: number | null;
  /** الأساسيّة: الفرق ÷ الاستهلاك المتوقَّع. */
  varianceConsumptionBp: number | null;
  varianceBp: number | null;
  varianceCostMinor: number | null;
}

/**
 * سجلُّ الصنف — أسبوعاً أسبوعاً، بكلّ حدٍّ في معادلته ومصدرِه.
 *
 * والغايةُ أن يُرى **المتكرّر**: نقصٌ في كلّ أسبوعٍ بنسبةٍ متقاربة
 * يُشير إلى وصفةٍ أو جرعة؛ ونقصٌ مرّةً وزيادةٌ مرّة يُشير إلى عدٍّ أو
 * توقيتِ استلام. ولا يُفهَم ذلك من الفرق وحده.
 */
export async function itemHistory(productId: string, limit = 12, conn: Conn = db): Promise<ItemHistoryRow[]> {
  const rows = await conn.execute<Record<string, unknown>>(sql`
    select c.id as count_id, c.period_start, c.period_end, c.status,
           l.base_unit, l.in_scope, l.opening_milli, l.opening_source, l.purchases_milli,
           l.manual_receipts_milli, l.theoretical_consumption_milli, l.recorded_waste_milli,
           l.theoretical_closing_milli, l.actual_milli, l.variance_milli,
           l.variance_consumption_bp, l.variance_bp, l.variance_cost_minor
      from inventory_count_lines l
      join inventory_counts c on c.id = l.count_id
     where l.product_id = ${productId}
     order by c.period_end desc
     limit ${limit}
  `);

  return rows.rows.map((r) => ({
    countId: String(r.count_id),
    periodStart: String(r.period_start),
    periodEnd: String(r.period_end),
    status: r.status as "DRAFT" | "FINALISED",
    baseUnit: (isStoredUnit(r.base_unit) ? r.base_unit : "PIECE") as StoredUnit,
    inScope: r.in_scope !== false,
    openingMilli: num(r.opening_milli),
    openingSource: (r.opening_source ?? "UNKNOWN") as OpeningSource,
    purchasesMilli: num(r.purchases_milli),
    manualReceiptsMilli: Number(r.manual_receipts_milli ?? 0),
    theoreticalConsumptionMilli: num(r.theoretical_consumption_milli),
    recordedWasteMilli: Number(r.recorded_waste_milli ?? 0),
    theoreticalClosingMilli: num(r.theoretical_closing_milli),
    actualMilli: num(r.actual_milli),
    varianceMilli: num(r.variance_milli),
    varianceConsumptionBp: num(r.variance_consumption_bp),
    varianceBp: num(r.variance_bp),
    varianceCostMinor: num(r.variance_cost_minor),
  }));
}

export interface RecurringItem {
  productId: string;
  productName: string;
  baseUnit: StoredUnit;
  category: string;
  periods: number;
  negativePeriods: number;
  /** مقدارُ النقص في المدّة — لا تُطفئه زيادةُ أسبوعٍ آخر. */
  shortageCostMinor: number;
  overageCostMinor: number;
  /** ومقدارُ النقص بالكمّيّة — يُجمَع لأنّه صنفٌ واحدٌ بوحدةٍ واحدة. */
  shortageMilli: number;
  overageMilli: number;
  worstBp: number | null;
}

/**
 * أصنافٌ يتكرّر فيها الفرق — مرتَّبةً بعدد أسابيع النقص ثمّ بمقداره.
 *
 * **والجمعُ على المقادير لا على الصافي**: صنفٌ نقص ألفاً في أسبوعٍ وزاد
 * ألفاً في آخر ليس «صنفاً سليماً»، هو صنفٌ فيه مشكلتان.
 */
export async function recurringVariances(sinceDate: string, limit = 10, conn: Conn = db): Promise<RecurringItem[]> {
  const rows = await conn.execute<Record<string, unknown>>(sql`
    select l.product_id, p.name_ar as product_name, l.base_unit, p.category,
           count(*)::int as periods,
           count(*) filter (where l.variance_milli < 0)::int as negative_periods,
           coalesce(sum(-l.variance_cost_minor) filter (where l.variance_cost_minor < 0), 0)::bigint as shortage_cost,
           coalesce(sum(l.variance_cost_minor) filter (where l.variance_cost_minor > 0), 0)::bigint as overage_cost,
           coalesce(sum(-l.variance_milli) filter (where l.variance_milli < 0), 0)::bigint as shortage_milli,
           coalesce(sum(l.variance_milli) filter (where l.variance_milli > 0), 0)::bigint as overage_milli,
           min(l.variance_consumption_bp) as worst_bp
      from inventory_count_lines l
      join inventory_counts c on c.id = l.count_id
      join products p on p.id = l.product_id
     where c.status = 'FINALISED'
       and c.period_end >= ${sinceDate}
       and l.in_scope
       and l.variance_milli is not null
       and l.variance_milli <> 0
     group by l.product_id, p.name_ar, l.base_unit, p.category
     order by negative_periods desc, shortage_cost desc
     limit ${limit}
  `);

  return rows.rows.map((r) => ({
    productId: String(r.product_id),
    productName: String(r.product_name),
    baseUnit: (isStoredUnit(r.base_unit) ? r.base_unit : "PIECE") as StoredUnit,
    category: String(r.category),
    periods: Number(r.periods),
    negativePeriods: Number(r.negative_periods),
    shortageCostMinor: Number(r.shortage_cost),
    overageCostMinor: Number(r.overage_cost),
    shortageMilli: Number(r.shortage_milli),
    overageMilli: Number(r.overage_milli),
    worstBp: r.worst_bp === null ? null : Number(r.worst_bp),
  }));
}

export async function unmappedPosProducts(conn: Conn = db): Promise<{
  id: string; externalId: string; name: string; category: string | null;
  soldUnits: number; soldMinor: number;
}[]> {
  const rows = await conn.execute<Record<string, unknown>>(sql`
    select pp.id, pp.external_id, pp.name, pp.category,
           coalesce(sum(sl.quantity), 0)::numeric as sold_units,
           coalesce(sum(sl.line_total_minor), 0)::bigint as sold_minor
      from pos_products pp
      left join sale_lines sl on sl.pos_product_id = pp.id
     where pp.product_id is null
       /* خيارُ الإضافة ليس صنفاً يُباع — فلا يُطلَب ربطُه ولا وصفتُه */
       and pp.kind = 'PRODUCT'
     group by pp.id
     order by sold_minor desc
     limit 200
  `);
  return rows.rows.map((r) => ({
    id: String(r.id),
    externalId: String(r.external_id),
    name: String(r.name),
    category: r.category === null ? null : String(r.category),
    soldUnits: Number(r.sold_units),
    soldMinor: Number(r.sold_minor),
  }));
}
