/**
 * الكمّيّةُ المستلَمة يدوياً — «دخلت الرفَّ بضاعة».
 *
 * ── وليست فاتورةً ولا ديناً ──
 *
 * لا تُنشأ فاتورة، ولا يُمَسّ جدولٌ ماليّ، ولا ينشأ لمورّدٍ حقّ. الكمّيّةُ
 * هي الواقعة، والكلفةُ معلومةٌ اختياريّة **لا تُشتقّ منها كمّيّة**.
 *
 * ── والاستلامُ الواحد لا يُحسَب مرّتين ──
 *
 * قبل أن يُكتَب يُسأل: أيشبهه بندُ فاتورةٍ للصنف نفسه في سبعة أيّام؟
 * فإن كان، يُردّ الطلبُ بمرشّحيه (`PossibleDuplicateReceiptError`) ولا
 * يُكتَب شيء، حتى يقول صاحبُه: **هو نفسُه** (يُربَط فيخرج البندُ من
 * الحساب) أو **شحنةٌ أخرى** (يُحسَب الاثنان). والاحتمالُ الذي يظهر بعد
 * القيد — فاتورةٌ وصلت بعد الاستلام — يكشفه الحسابُ ويُعلنه.
 *
 * ── ولا حذف ──
 *
 * يُعدَّل فيُكتب أثرُه، ويُلغى بسببه ولا يُمحى. ومؤثِّرُ `041` يرفض
 * الكتابةَ في استلامٍ يقع في أسبوعٍ جردُه مقفَل.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { inventoryReceipts, products } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { sameUnitFamily, toCanonical } from "@/lib/inventory/units";
import { duplicateCandidates, RECEIPT_MATCH_WINDOW_DAYS, type DuplicateCandidate } from "@/lib/inventory/receipts";
import type { StoredUnit } from "@/lib/unit-conversion";
import type { Conn } from "./types";
import { invoiceLinesForMatch, linkedInvoiceLineIds } from "./inventory.service";

export type ReceiptResolution =
  | { kind: "LINK"; invoiceLineId: string }
  | { kind: "SEPARATE" };

export interface ReceiptInput {
  productId: string;
  branchId: string | null;
  /** تاريخُ الاستلام الفعليّ — `YYYY-MM-DD`. */
  receivedOn: string;
  /** بالمِلّي من `unit` كما أُدخل: «٢٠» كجم = ‏٢٠٬٠٠٠. */
  enteredMilli: number;
  unit: StoredUnit;
  supplierId?: string | null;
  documentRef?: string | null;
  costMinor?: number | null;
  note?: string | null;
  /** جوابُ سؤال التكرار — يُشترَط حين يوجد بندٌ يشبهه. */
  resolution?: ReceiptResolution | null;
}

/**
 * يشبهه بندُ فاتورة — ولم يُكتَب شيء.
 *
 * ويحمل المرشّحين كي تسأل الشاشةُ صاحبَها: أهو هو، أم شحنةٌ أخرى؟
 */
export class PossibleDuplicateReceiptError extends Error {
  constructor(
    readonly candidates: readonly DuplicateCandidate[],
    /** استلاماتٌ يدويّةٌ سابقة بالكمّيّة نفسِها في اليوم أو ما يليه — أُدخلت مرّتين؟ */
    readonly earlierReceipts: readonly { id: string; receivedOn: string }[] = [],
  ) {
    super(
      candidates.length > 0
        ? `يشبه هذا الاستلامُ ${candidates.length === 1 ? "بنداً" : `${candidates.length} بنود`} في فاتورةٍ قائمة`
          + ` (${candidates[0].supplierName} · ${candidates[0].invoiceNumber}) — أهو نفسُه أم شحنةٌ أخرى؟`
        : `أدخلتَ الكمّيّةَ نفسَها لهذا الصنف يوم ${earlierReceipts[0].receivedOn} — أهي شحنةٌ أخرى أم أُدخلت مرّتين؟`,
    );
    this.name = "PossibleDuplicateReceiptError";
  }
}

/**
 * استلامٌ يدويٌّ سابق بالكمّيّة نفسِها في يومٍ متجاور.
 *
 * الفاتورةُ ليست المصدرَ الوحيد للتكرار: من نسي أنّه أدخل شحنةَ الأربعاء
 * يُدخلها الخميسَ ثانيةً، فتصير عشرون أربعين. والنافذةُ يومٌ واحد لا
 * أسبوع — فشحنتان متساويتان في أسبوعٍ واحد أمرٌ يقع، وفي يومٍ واحد
 * يُسأل عنه.
 */
async function earlierManualReceipts(
  productId: string, receivedOn: string, canonicalMilli: number, baseUnit: StoredUnit, conn: Conn,
): Promise<{ id: string; receivedOn: string }[]> {
  const sameDay = await conn.execute<{ id: string; received_on: string }>(sql`
    select id, received_on from inventory_receipts
     where product_id = ${productId}
       and voided_at is null
       and canonical_milli = ${canonicalMilli}
       and abs(received_on::date - ${receivedOn}::date) <= 1
     order by received_on
  `);

  /*
    ── والفاتورةُ التي سُجّلت شحنتُها من قبل ──

    بندٌ يشبه هذا الإدخال، مرتبطٌ باستلامٍ قائم: شحنتُه على الرفّ في
    قيدنا. فإدخالُها ثانيةً — ولو بتاريخ الفاتورة لا بتاريخ الاستلام
    الأوّل — أرجحُ أن يكون تكراراً من أن يكون شحنةً ثالثة. فيُسأل عنه.
  */
  const linkedMatches = await invoiceLinesForMatch(
    [productId], shift(receivedOn, -RECEIPT_MATCH_WINDOW_DAYS), shift(receivedOn, RECEIPT_MATCH_WINDOW_DAYS),
    new Map([[productId, baseUnit]]), conn,
  );
  const representing = linkedMatches.filter((l) => l.canonicalMilli === null || l.canonicalMilli === canonicalMilli);
  const viaInvoice = representing.length === 0 ? [] : (await conn.execute<{ id: string; received_on: string }>(sql`
    select id, received_on from inventory_receipts
     where voided_at is null
       and invoice_line_id in (${sql.join(representing.map((l) => sql`${l.lineId}`), sql`, `)})
  `)).rows;

  const seen = new Set<string>();
  return [...sameDay.rows, ...viaInvoice]
    .filter((r) => (seen.has(String(r.id)) ? false : (seen.add(String(r.id)), true)))
    .map((r) => ({ id: String(r.id), receivedOn: String(r.received_on) }));
}

function shift(d: string, n: number): string {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
}

async function stockProduct(productId: string, conn: Conn) {
  const [p] = await conn
    .select({ id: products.id, name: products.nameAr, baseUnit: products.baseUnit })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.isStockItem, true)))
    .limit(1);
  if (!p) throw new Error("صنفٌ ليس من أصناف المخزون");
  return p;
}

function checkQuantity(name: string, enteredMilli: number, unit: StoredUnit, baseUnit: StoredUnit): number {
  if (!Number.isInteger(enteredMilli) || enteredMilli <= 0) {
    throw new Error(`كمّيّةٌ غير مقروءة لـ«${name}» — الاستلامُ كمّيّةٌ موجبة`);
  }
  if (!sameUnitFamily(unit, baseUnit)) {
    throw new Error(`وحدةُ «${name}» لا تُحوَّل إلى وحدته — وزنٌ لا يصير حجماً`);
  }
  return toCanonical(enteredMilli, unit);
}

/** مرشّحو التكرار لاستلامٍ قبل أن يُكتَب — حول تاريخه لا حول أسبوعه. */
export async function receiptCandidates(
  productId: string,
  receivedOn: string,
  canonicalMilli: number,
  baseUnit: StoredUnit,
  conn: Conn = db,
): Promise<DuplicateCandidate[]> {
  const lines = await invoiceLinesForMatch(
    [productId], shift(receivedOn, -RECEIPT_MATCH_WINDOW_DAYS), shift(receivedOn, RECEIPT_MATCH_WINDOW_DAYS),
    new Map([[productId, baseUnit]]), conn,
  );
  return duplicateCandidates(
    { id: "(جديد)", productId, receivedOn, canonicalMilli },
    lines,
    await linkedInvoiceLineIds(conn),
  );
}

/** بندُ الفاتورة يصلح أن يمثّله هذا الاستلام؟ — الصنفُ نفسُه، وغيرُ مرتبطٍ بغيره. */
async function checkLink(invoiceLineId: string, productId: string, conn: Conn): Promise<void> {
  const [row] = (await conn.execute<{ product_id: string | null; linked: string | null }>(sql`
    select sp.product_id,
           (select r.id from inventory_receipts r
             where r.invoice_line_id = il.id and r.voided_at is null limit 1) as linked
      from invoice_lines il
      left join supplier_products sp on sp.id = il.supplier_product_id
     where il.id = ${invoiceLineId}
  `)).rows;
  if (!row) throw new Error("بندُ الفاتورة غير موجود");
  if (row.product_id !== null && String(row.product_id) !== productId) {
    throw new Error("بندُ الفاتورة لصنفٍ آخر — لا يُربَط بهذا الاستلام");
  }
  if (row.linked) throw new Error("هذا البندُ مرتبطٌ باستلامٍ آخر — والبندُ الواحد لا يمثّل شحنتين");
}

/**
 * يقيّد كمّيّةً مستلَمة.
 *
 * ويُسأل عن التكرار **قبل** الكتابة: إن وُجد بندٌ يشبهه ولم يُقَل
 * جوابٌ رُدّ الطلبُ بمرشّحيه ولم يُكتَب شيء.
 */
export async function createReceipt(input: ReceiptInput, actorId: string, conn: Conn = db): Promise<string> {
  return conn.transaction(async (tx) => {
    const product = await stockProduct(input.productId, tx);
    const canonical = checkQuantity(product.name, input.enteredMilli, input.unit, product.baseUnit);
    if (input.costMinor != null && (!Number.isInteger(input.costMinor) || input.costMinor < 0)) {
      throw new Error("الكلفةُ مبلغٌ موجبٌ بالهللات — أو اتركها فارغة");
    }

    const resolution = input.resolution ?? null;
    if (resolution === null) {
      const candidates = await receiptCandidates(input.productId, input.receivedOn, canonical, product.baseUnit, tx);
      const earlier = await earlierManualReceipts(input.productId, input.receivedOn, canonical, product.baseUnit, tx);
      if (candidates.length > 0 || earlier.length > 0) throw new PossibleDuplicateReceiptError(candidates, earlier);
    } else if (resolution.kind === "LINK") {
      await checkLink(resolution.invoiceLineId, input.productId, tx);
    }

    const [row] = await tx.insert(inventoryReceipts).values({
      productId: input.productId,
      branchId: input.branchId,
      receivedOn: input.receivedOn,
      enteredMilli: input.enteredMilli,
      enteredUnit: input.unit,
      canonicalMilli: canonical,
      supplierId: input.supplierId ?? null,
      documentRef: input.documentRef ?? null,
      costMinor: input.costMinor ?? null,
      note: input.note ?? null,
      invoiceLineId: resolution?.kind === "LINK" ? resolution.invoiceLineId : null,
      confirmedSeparate: resolution?.kind === "SEPARATE",
      createdById: actorId,
    }).returning({ id: inventoryReceipts.id });

    await recordAudit({
      actorId,
      action: "INVENTORY_RECEIPT_CREATED",
      entityType: "inventory_receipt",
      entityId: row.id,
      after: {
        الصنف: product.name,
        الكمّيّة: input.enteredMilli,
        الوحدة: input.unit,
        التاريخ: input.receivedOn,
        الكلفة: input.costMinor ?? null,
        المصدر: "MANUAL_RECEIPT",
        العلاقة: resolution === null ? "لا بندَ يشبهه" : resolution.kind === "LINK" ? "مرتبطٌ ببند فاتورة" : "شحنةٌ منفصلة مؤكَّدة",
      },
    }, tx);

    return row.id;
  });
}

async function activeReceipt(id: string, conn: Conn) {
  const [r] = await conn.select().from(inventoryReceipts)
    .where(and(eq(inventoryReceipts.id, id), isNull(inventoryReceipts.voidedAt))).limit(1);
  if (!r) throw new Error("الاستلامُ غير موجود أو أُلغي");
  return r;
}

/** يعدّل استلاماً — ويُكتب ما كان وما صار. */
export async function updateReceipt(
  id: string,
  patch: Partial<Pick<ReceiptInput, "receivedOn" | "enteredMilli" | "unit" | "supplierId" | "documentRef" | "costMinor" | "note">>,
  actorId: string,
  conn: Conn = db,
): Promise<void> {
  await conn.transaction(async (tx) => {
    const before = await activeReceipt(id, tx);
    const product = await stockProduct(before.productId, tx);
    const enteredMilli = patch.enteredMilli ?? Number(before.enteredMilli);
    const unit = patch.unit ?? before.enteredUnit;
    const canonical = checkQuantity(product.name, enteredMilli, unit, product.baseUnit);

    await tx.update(inventoryReceipts).set({
      receivedOn: patch.receivedOn ?? before.receivedOn,
      enteredMilli,
      enteredUnit: unit,
      canonicalMilli: canonical,
      supplierId: patch.supplierId === undefined ? before.supplierId : patch.supplierId,
      documentRef: patch.documentRef === undefined ? before.documentRef : patch.documentRef,
      costMinor: patch.costMinor === undefined ? before.costMinor : patch.costMinor,
      note: patch.note === undefined ? before.note : patch.note,
      updatedById: actorId,
      updatedAt: new Date(),
    }).where(eq(inventoryReceipts.id, id));

    await recordAudit({
      actorId,
      action: "INVENTORY_RECEIPT_UPDATED",
      entityType: "inventory_receipt",
      entityId: id,
      before: {
        الكمّيّة: Number(before.enteredMilli), الوحدة: before.enteredUnit,
        التاريخ: before.receivedOn, الكلفة: before.costMinor,
      },
      after: {
        الكمّيّة: enteredMilli, الوحدة: unit,
        التاريخ: patch.receivedOn ?? before.receivedOn,
        الكلفة: patch.costMinor === undefined ? before.costMinor : patch.costMinor,
      },
    }, tx);
  });
}

/** يلغي استلاماً — بسببه ومن ألغاه، ولا يُمحى. */
export async function voidReceipt(id: string, reason: string, actorId: string, conn: Conn = db): Promise<void> {
  if (reason.trim().length < 3) throw new Error("اكتب سببَ الإلغاء — الإلغاءُ بلا سببٍ لا يُفهَم بعد شهر");
  await conn.transaction(async (tx) => {
    const before = await activeReceipt(id, tx);
    await tx.update(inventoryReceipts)
      .set({ voidedAt: new Date(), voidedById: actorId, voidReason: reason.trim() })
      .where(eq(inventoryReceipts.id, id));
    await recordAudit({
      actorId,
      action: "INVENTORY_RECEIPT_VOIDED",
      entityType: "inventory_receipt",
      entityId: id,
      before: { الكمّيّة: Number(before.enteredMilli), الوحدة: before.enteredUnit, التاريخ: before.receivedOn },
      after: { السبب: reason.trim() },
    }, tx);
  });
}

/**
 * يحسم احتمالَ التكرار: **هو نفسُه** (يُربَط) أو **شحنةٌ أخرى**.
 *
 * ويقع حين تصل الفاتورةُ بعد الاستلام — فيُكشَف الاحتمالُ عند الحساب،
 * وتصير مشترياتُ الصنف مجهولةً حتى يُقال هذا.
 */
export async function resolveReceipt(
  id: string,
  resolution: ReceiptResolution,
  actorId: string,
  conn: Conn = db,
): Promise<void> {
  await conn.transaction(async (tx) => {
    const before = await activeReceipt(id, tx);
    if (resolution.kind === "LINK") await checkLink(resolution.invoiceLineId, before.productId, tx);

    await tx.update(inventoryReceipts).set({
      invoiceLineId: resolution.kind === "LINK" ? resolution.invoiceLineId : null,
      confirmedSeparate: resolution.kind === "SEPARATE",
      updatedById: actorId,
      updatedAt: new Date(),
    }).where(eq(inventoryReceipts.id, id));

    await recordAudit({
      actorId,
      action: "INVENTORY_RECEIPT_RESOLVED",
      entityType: "inventory_receipt",
      entityId: id,
      before: { مرتبط: before.invoiceLineId, منفصل: before.confirmedSeparate },
      after: resolution.kind === "LINK"
        ? { مرتبط: resolution.invoiceLineId, منفصل: false }
        : { مرتبط: null, منفصل: true },
    }, tx);
  });
}

export interface ReceiptView {
  id: string;
  productId: string;
  receivedOn: string;
  enteredMilli: number;
  unit: StoredUnit;
  costMinor: number | null;
  documentRef: string | null;
  supplierName: string | null;
  note: string | null;
  linkedInvoiceNumber: string | null;
  confirmedSeparate: boolean;
}

/** استلاماتُ فترةٍ وفرع — لما يُعرَض داخل الجرد. */
export async function listReceipts(
  periodStart: string,
  periodEnd: string,
  branchId: string | null,
  conn: Conn = db,
): Promise<ReceiptView[]> {
  const rows = await conn.execute<Record<string, unknown>>(sql`
    select r.id, r.product_id, r.received_on, r.entered_milli, r.entered_unit, r.cost_minor,
           r.document_ref, r.note, r.confirmed_separate,
           su.name_ar as supplier_name, i.invoice_number as linked_invoice
      from inventory_receipts r
      left join suppliers su on su.id = r.supplier_id
      left join invoice_lines il on il.id = r.invoice_line_id
      left join invoices i on i.id = il.invoice_id
     where r.voided_at is null
       and r.received_on between ${periodStart} and ${periodEnd}
       and ${branchId ? sql`(r.branch_id = ${branchId} or r.branch_id is null)` : sql`true`}
     order by r.received_on, r.created_at
  `);
  return rows.rows.map((r) => ({
    id: String(r.id),
    productId: String(r.product_id),
    receivedOn: String(r.received_on),
    enteredMilli: Number(r.entered_milli),
    unit: r.entered_unit as StoredUnit,
    costMinor: r.cost_minor === null ? null : Number(r.cost_minor),
    documentRef: r.document_ref === null ? null : String(r.document_ref),
    supplierName: r.supplier_name === null ? null : String(r.supplier_name),
    note: r.note === null ? null : String(r.note),
    linkedInvoiceNumber: r.linked_invoice === null ? null : String(r.linked_invoice),
    confirmedSeparate: Boolean(r.confirmed_separate),
  }));
}
