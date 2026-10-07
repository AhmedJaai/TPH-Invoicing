/**
 * الهدرُ المسجَّل وحركاتُ المخزون اليدويّة.
 *
 * ── ولماذا الهدرُ هنا لا في مساحةٍ مستقلّة ──
 *
 * سجلُّ الهدر ليس منتجاً قائماً بذاته اليوم: هو **فعلٌ داخل الجرد**
 * — يُفتَح سطرُ صنفٍ نقص، فيُقال «منه كيلو انسكب». ولو صار مساحةً
 * عليا لطُلب من صاحب المقهى أن يزورها، فلا يزورها، فيبقى الجدولُ
 * فارغاً و«الفرق غير المفسَّر» يشمل ما هو مفسَّر.
 *
 * والفصلُ بينهما هو الغاية: **هدرٌ مسجَّل** يُطرَح من المعادلة، و**فرقٌ
 * باقٍ** هو ما لا نعرف سببه. وقبل أن يُسجَّل هدرٌ واحد يكون الفرقُ
 * كلُّه «غير مفسَّر» — وهذا صادق، لا نقص.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { inventoryMovements, products, wasteRecords } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { isStoredUnit, storedUnitLabel, type StoredUnit } from "@/lib/unit-conversion";
import { milliToDecimal, sameUnitFamily } from "@/lib/inventory/units";
import type { Conn } from "./types";

export type WasteReason =
  | "EXPIRED" | "SPILLED" | "FAILED_PREP" | "CALIBRATION" | "STAFF_DRINK" | "DAMAGED" | "OTHER";

export const WASTE_REASON_LABEL: Record<WasteReason, string> = {
  EXPIRED: "انتهت صلاحيّته",
  SPILLED: "انسكب",
  FAILED_PREP: "تحضيرٌ فاشل",
  CALIBRATION: "معايرةُ الماكينة",
  STAFF_DRINK: "مشروبُ موظَّف",
  DAMAGED: "تلف",
  OTHER: "سببٌ آخر",
};

export type MovementKind = "OPENING" | "ADJUST_IN" | "ADJUST_OUT" | "TRANSFER_IN" | "TRANSFER_OUT";

export const MOVEMENT_KIND_LABEL: Record<MovementKind, string> = {
  OPENING: "رصيدٌ افتتاحيّ",
  ADJUST_IN: "تسويةٌ بالزيادة",
  ADJUST_OUT: "تسويةٌ بالنقص",
  TRANSFER_IN: "نقلٌ وارد من فرعٍ آخر",
  TRANSFER_OUT: "نقلٌ صادر إلى فرعٍ آخر",
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** رفضٌ يُقال لصاحبه كما هو — صنفٌ لا يُخزَّن، وحدةٌ من عائلةٍ أخرى، سطرٌ مُبطَل. */
export class MovementRefused extends Error {}

/**
 * الصنفُ يُخزَّن، ووحدةُ الكمّيّة من عائلة وحدته.
 *
 * كان يُفحَص أنّ الوحدة معروفةٌ فقط. فهدرُ «٢ لتر» لصنفٍ بالكيلو يُحفَظ، ثمّ
 * يُحوَّل عند الحساب إلى مِلّي‑الصغرى ويُطرَح من رصيد مِلّي‑جرام **كأنّه
 * كيلوان**. والاستلامُ والافتتاحيُّ يفحصان العائلة منذ `041`؛ وهذا بابُهما.
 */
async function stockItem(productId: string, unit: StoredUnit, tx: Conn): Promise<{ nameAr: string }> {
  const [product] = await tx
    .select({ nameAr: products.nameAr, baseUnit: products.baseUnit, isStockItem: products.isStockItem })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!product) throw new MovementRefused("الصنف غير موجود");
  if (!product.isStockItem) throw new MovementRefused(`«${product.nameAr}» ليس صنفاً يُخزَّن — لا يُسجَّل عليه هدرٌ ولا حركة`);
  if (!sameUnitFamily(unit, product.baseUnit)) {
    throw new MovementRefused(
      `«${product.nameAr}» يُقاس بـ${storedUnitLabel(product.baseUnit)}، و${storedUnitLabel(unit)} لا تُحوَّل إليه — وزنٌ وحجمٌ وعدٌّ لا تتبادل`,
    );
  }
  return { nameAr: product.nameAr };
}

export interface WasteInput {
  productId: string;
  quantityMilli: number;
  unit: StoredUnit;
  occurredOn: string;
  reason: WasteReason;
  note?: string | null;
  branchId?: string | null;
  countId?: string | null;
  /**
   * مفتاحُ الطلب من المتصفّح — يُولَّد مرّةً لكلّ نموذج.
   *
   * ضغطتان على شبكةٍ بطيئة تحملان المفتاحَ نفسه، فتكتب الأولى وتُردّ الثانيةُ
   * إلى سطرها. وبلا مفتاحٍ (نصٌّ، اختبار) يُكتَب كما كان.
   */
  clientRequestId?: string | null;
  actorId: string;
}

export interface WasteResult {
  id: string;
  /** أكان مسجَّلاً بهذا المفتاح قبل هذا الطلب؟ — «سُجّل قبل لحظة». */
  duplicate: boolean;
}

export async function recordWaste(input: WasteInput, conn: Conn = db): Promise<WasteResult> {
  if (!isStoredUnit(input.unit)) throw new Error("وحدةٌ غير معروفة");
  if (!DATE.test(input.occurredOn)) throw new Error("التاريخ يُكتب YYYY-MM-DD");
  if (!Number.isInteger(input.quantityMilli) || input.quantityMilli <= 0) {
    throw new Error("الكمّيّة تكون أكبر من صفر");
  }

  const requestId = input.clientRequestId?.trim() || null;

  return conn.transaction(async (tx) => {
    const product = await stockItem(input.productId, input.unit, tx);

    /*
      الفرادةُ في القاعدة (`waste_records_client_request_uq`) لا في فحصٍ قبل
      الكتابة: الضغطتان متزامنتان، والفحصُ يراهما معاً «لا شيء».
    */
    const [row] = await tx
      .insert(wasteRecords)
      .values({
        productId: input.productId,
        branchId: input.branchId ?? null,
        quantityMilli: input.quantityMilli,
        unit: input.unit,
        occurredOn: input.occurredOn,
        reason: input.reason,
        note: input.note ?? null,
        countId: input.countId ?? null,
        createdById: input.actorId,
        clientRequestId: requestId,
      })
      .onConflictDoNothing()
      .returning({ id: wasteRecords.id });

    if (!row) {
      const [existing] = requestId === null ? [] : await tx
        .select({ id: wasteRecords.id })
        .from(wasteRecords)
        .where(eq(wasteRecords.clientRequestId, requestId))
        .limit(1);
      if (!existing) throw new Error("تعذّر تسجيلُ الهدر — أعد المحاولة");
      return { id: existing.id, duplicate: true };
    }

    await recordAudit({
      actorId: input.actorId,
      action: "WASTE_RECORDED",
      entityType: "waste_record",
      entityId: row.id,
      after: {
        الصنف: product.nameAr,
        الكمّيّة: `${milliToDecimal(input.quantityMilli)} ${input.unit}`,
        السبب: input.reason,
        التاريخ: input.occurredOn,
      },
    }, tx);

    return { id: row.id, duplicate: false };
  });
}

/**
 * يُبطل هدراً مسجَّلاً — بسببه ومن أبطله، **ولا يُمحى**.
 *
 * من كتب «٥٠٠» بدل «٥٠» لم يكن يملك إلّا تسويةً معاكسة تشوّش السجلّ. والمُبطَلُ
 * يخرج من الحساب ويبقى في سجلّ الصنف. وفي أسبوعٍ جردُه مقفَل يرفضه مؤثِّرُ
 * `050` — أعِد فتحَ الجرد أوّلاً.
 */
export async function voidWaste(id: string, reason: string, actorId: string, conn: Conn = db): Promise<void> {
  const why = reason.trim();
  if (why.length < 3) throw new MovementRefused("اكتب سببَ الإبطال — الإبطالُ بلا سببٍ لا يُفهَم بعد شهر");

  await conn.transaction(async (tx) => {
    /* الشرطُ في التحديث نفسِه: ضغطتان على «أبطِل» تُبطل الأولى وتُردّ الثانية */
    const [row] = await tx
      .update(wasteRecords)
      .set({ voidedAt: new Date(), voidedById: actorId, voidReason: why })
      .where(and(eq(wasteRecords.id, id), isNull(wasteRecords.voidedAt)))
      .returning({
        productId: wasteRecords.productId, quantityMilli: wasteRecords.quantityMilli,
        unit: wasteRecords.unit, occurredOn: wasteRecords.occurredOn, reason: wasteRecords.reason,
      });
    if (!row) throw new MovementRefused("هذا الهدرُ غير موجودٍ أو أُبطل من قبل");

    await recordAudit({
      actorId,
      action: "WASTE_VOIDED",
      entityType: "waste_record",
      entityId: id,
      before: {
        الكمّيّة: `${milliToDecimal(Number(row.quantityMilli))} ${row.unit}`,
        السبب: row.reason,
        التاريخ: row.occurredOn,
      },
      after: { سبب_الإبطال: why },
    }, tx);
  });
}

export interface WasteView {
  id: string;
  productId: string;
  productName: string;
  occurredOn: string;
  quantityMilli: number;
  unit: StoredUnit;
  reason: WasteReason;
  note: string | null;
}

/** هدرُ فترةٍ وفرع غيرُ المُبطَل — لما يُعرَض داخل الجرد وبجانبه «أبطِل». */
export async function listWaste(
  periodStart: string,
  periodEnd: string,
  branchId: string | null,
  conn: Conn = db,
): Promise<WasteView[]> {
  const rows = await conn
    .select({
      id: wasteRecords.id, productId: wasteRecords.productId, productName: products.nameAr,
      occurredOn: wasteRecords.occurredOn, quantityMilli: wasteRecords.quantityMilli,
      unit: wasteRecords.unit, reason: wasteRecords.reason, note: wasteRecords.note,
    })
    .from(wasteRecords)
    .innerJoin(products, eq(products.id, wasteRecords.productId))
    .where(and(
      isNull(wasteRecords.voidedAt),
      sql`${wasteRecords.occurredOn} >= ${periodStart}`,
      sql`${wasteRecords.occurredOn} <= ${periodEnd}`,
      branchId ? sql`(${wasteRecords.branchId} = ${branchId} or ${wasteRecords.branchId} is null)` : sql`true`,
    ))
    .orderBy(wasteRecords.occurredOn, wasteRecords.createdAt);
  return rows.map((r) => ({ ...r, quantityMilli: Number(r.quantityMilli) }));
}

export interface MovementInput {
  productId: string;
  kind: MovementKind;
  quantityMilli: number;
  unit: StoredUnit;
  occurredOn: string;
  note?: string | null;
  branchId?: string | null;
  countId?: string | null;
  actorId: string;
}

export async function recordMovement(input: MovementInput, conn: Conn = db): Promise<string> {
  if (!isStoredUnit(input.unit)) throw new Error("وحدةٌ غير معروفة");
  if (!DATE.test(input.occurredOn)) throw new Error("التاريخ يُكتب YYYY-MM-DD");
  if (!Number.isInteger(input.quantityMilli) || input.quantityMilli <= 0) {
    throw new Error("الكمّيّة تكون أكبر من صفر");
  }

  return conn.transaction(async (tx) => {
    const product = await stockItem(input.productId, input.unit, tx);

    const [row] = await tx
      .insert(inventoryMovements)
      .values({
        productId: input.productId,
        branchId: input.branchId ?? null,
        kind: input.kind,
        quantityMilli: input.quantityMilli,
        unit: input.unit,
        occurredOn: input.occurredOn,
        note: input.note ?? null,
        countId: input.countId ?? null,
        createdById: input.actorId,
      })
      .returning({ id: inventoryMovements.id });

    await recordAudit({
      actorId: input.actorId,
      action: "INVENTORY_MOVEMENT_RECORDED",
      entityType: "inventory_movement",
      entityId: row.id,
      after: {
        الصنف: product.nameAr,
        الباب: input.kind,
        الكمّيّة: `${milliToDecimal(input.quantityMilli)} ${input.unit}`,
        التاريخ: input.occurredOn,
      },
    }, tx);

    return row.id;
  });
}
