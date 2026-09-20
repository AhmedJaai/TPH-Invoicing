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
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { inventoryMovements, products, wasteRecords } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { isStoredUnit, type StoredUnit } from "@/lib/unit-conversion";
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

export interface WasteInput {
  productId: string;
  quantityMilli: number;
  unit: StoredUnit;
  occurredOn: string;
  reason: WasteReason;
  note?: string | null;
  branchId?: string | null;
  countId?: string | null;
  actorId: string;
}

export async function recordWaste(input: WasteInput, conn: Conn = db): Promise<string> {
  if (!isStoredUnit(input.unit)) throw new Error("وحدةٌ غير معروفة");
  if (!DATE.test(input.occurredOn)) throw new Error("التاريخ يُكتب YYYY-MM-DD");
  if (!Number.isInteger(input.quantityMilli) || input.quantityMilli <= 0) {
    throw new Error("الكمّيّة تكون أكبر من صفر");
  }

  return conn.transaction(async (tx) => {
    const [product] = await tx
      .select({ nameAr: products.nameAr })
      .from(products)
      .where(eq(products.id, input.productId))
      .limit(1);
    if (!product) throw new Error("الصنف غير موجود");

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
      })
      .returning({ id: wasteRecords.id });

    await recordAudit({
      actorId: input.actorId,
      action: "WASTE_RECORDED",
      entityType: "waste_record",
      entityId: row.id,
      after: {
        الصنف: product.nameAr,
        الكمّيّة: `${input.quantityMilli / 1000} ${input.unit}`,
        السبب: input.reason,
        التاريخ: input.occurredOn,
      },
    }, tx);

    return row.id;
  });
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
    const [product] = await tx
      .select({ nameAr: products.nameAr })
      .from(products)
      .where(eq(products.id, input.productId))
      .limit(1);
    if (!product) throw new Error("الصنف غير موجود");

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
        الكمّيّة: `${input.quantityMilli / 1000} ${input.unit}`,
        التاريخ: input.occurredOn,
      },
    }, tx);

    return row.id;
  });
}
