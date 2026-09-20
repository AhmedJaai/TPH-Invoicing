/**
 * تجهيزُ اختبارات الجرد — على المخطّط الحقيقيّ، في معاملةٍ تُلغى.
 *
 * ولا يُكتَب شيءٌ باليد ممّا للخدمة أن تكتبه: الوصفةُ تمرّ بخدمتها،
 * والاستيرادُ بخدمته. وما يُكتب هنا هو ما لا خدمةَ له بعد — الصنفُ
 * والفرع — ولو كُتبت الوصفةُ بالإدراج لاختُبر مخطّطٌ لا مسار.
 */
import { notInArray } from "drizzle-orm";
import { branches, products, users } from "@/db/schema";
import { createId } from "@/lib/id";
import type { StoredUnit } from "@/lib/unit-conversion";
import type { Tx } from "@/services/types";
import { toCanonical } from "@/lib/inventory/units";

export const kg = (n: number) => toCanonical(Math.round(n * 1000), "KG");

export async function makeStockProduct(
  tx: Tx,
  nameAr: string,
  baseUnit: StoredUnit,
  category: "COFFEE" | "DAIRY" | "OTHER" = "OTHER",
): Promise<string> {
  const id = createId();
  await tx.insert(products).values({
    id, nameAr: `${nameAr} ${id.slice(0, 5)}`, category, baseUnit,
    isStockItem: true, isMenuItem: false, isActive: true,
  });
  return id;
}

export async function makeMenuProduct(tx: Tx, nameAr: string): Promise<string> {
  const id = createId();
  await tx.insert(products).values({
    id, nameAr: `${nameAr} ${id.slice(0, 5)}`, category: "BEVERAGE", baseUnit: "PIECE",
    isStockItem: false, isMenuItem: true, isActive: true,
  });
  return id;
}

/**
 * فرعٌ باسمه.
 *
 * والاسمُ يُرجَع معه لأنّ الاستيراد يُسنِد البيعةَ إلى فرعها **باسمه
 * كما في الملفّ**. فاختبارٌ ينشئ فرعاً ولا يُمرّر اسمَه إلى الاستيراد
 * يعتمد على ما في القاعدة من فروعٍ أخرى — ويمرّ أو يسقط بحسب ما تركه
 * اختبارٌ آخر.
 */
export async function makeBranch(tx: Tx): Promise<{ id: string; nameAr: string }> {
  const id = createId();
  const nameAr = `فرع اختبار ${id.slice(0, 5)}`;
  await tx.insert(branches).values({ id, nameAr, code: `T-${id.slice(0, 8)}`, isActive: true });
  return { id, nameAr };
}

/**
 * الأصنافُ الأخرى تُخفى عن الجرد.
 *
 * قاعدةُ الاختبار مشتركةٌ بين الملفّات، وفيها أصنافٌ من اختباراتٍ أخرى.
 * والمحرّكُ يعدّ **كلَّ** صنفِ مخزونٍ فعّال، فيدخل الغريبُ التقرير
 * ويُفسد العدّ. فتُعطَّل ما عدا أصنافَ هذا الاختبار داخل المعاملة —
 * وتُلغى مع إلغائها.
 */
export async function isolateProducts(tx: Tx, keep: readonly string[]): Promise<void> {
  await tx
    .update(products)
    .set({ isActive: false })
    .where(keep.length === 0 ? undefined : notInArray(products.id, [...keep]));
}

/** فاعلٌ للقيود — `created_by_id` مقيَّدٌ بمفتاحٍ أجنبيّ، فلا يُخترَع معرّف. */
export async function makeActor(tx: Tx): Promise<string> {
  const id = createId();
  await tx.insert(users).values({
    id, email: `dbtest-${id}@example.test`, name: "فاعل اختبار", role: "OWNER", isActive: true,
  });
  return id;
}
