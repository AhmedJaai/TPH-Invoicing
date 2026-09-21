import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { caught, withRollback } from "@/test/db";
import { isolateProducts, makeActor, makeBranch, makeMenuProduct, makeStockProduct } from "@/test/inventory";
import {
  ItemInUseError, RecipeLockedError, correctRecipeVersion, deleteRecipe,
  listRecipes, retireStockItem, saveRecipeVersion,
} from "./recipe.service";
import { finaliseCount, startCount } from "./inventory.service";
import { RECIPE_EPOCH } from "@/lib/inventory/recipe";
import type { Tx } from "./types";

/**
 * تصحيحُ الوصفة وحذفُها وإخراجُ صنفٍ — على المخطّط الحقيقيّ.
 *
 * والسؤالُ الذي تجيبه هذه الملفّات ليس «أتكتب الخدمةُ صفّاً؟» بل **متى
 * تمتنع**: التصحيحُ يسري على ما مضى، فلا يقع على فترةٍ قُفل جردُها.
 */
async function setup(tx: Tx) {
  const actorId = await makeActor(tx);
  const branch = await makeBranch(tx);
  const coffee = await makeStockProduct(tx, "بنّ", "G", "COFFEE");
  const cup = await makeStockProduct(tx, "كوب", "PIECE");
  const latte = await makeMenuProduct(tx, "لاتيه");
  await isolateProducts(tx, [coffee, cup]);

  await saveRecipeVersion({
    menuProductId: latte, effectiveFrom: "2026-09-13", activate: true, actorId,
    ingredients: [
      { productId: coffee, quantityMilli: 20_000, unit: "G" },
      { productId: cup, quantityMilli: 1_000, unit: "PIECE" },
    ],
  }, tx);

  return { actorId, branch, coffee, cup, latte };
}

async function rowFor(tx: Tx, menuProductId: string) {
  const rows = await listRecipes(tx);
  return rows.find((r) => r.menuProductId === menuProductId)!;
}

describe("تصحيحُ الوصفة", () => {
  it("أوّلُ نسخةٍ تسري منذ البداية ولو كُتب لها تاريخٌ متأخّر", () =>
    withRollback(async (tx) => {
      const { latte } = await setup(tx);
      const row = await rowFor(tx, latte);

      /* كُتب «١٣ سبتمبر» وسرت من `RECIPE_EPOCH` — وإلّا خرج كلُّ بيعٍ قبلها بلا وصفة */
      expect(row.activeFromLabel).toBe(RECIPE_EPOCH);
      expect(row.versions).toBe(1);
    }));

  it("يُصحَّح في مكانه فلا نسخةَ ثانية — والتصحيحُ يسري على الأسابيع كلِّها", () =>
    withRollback(async (tx) => {
      const { actorId, coffee, cup, latte } = await setup(tx);

      await correctRecipeVersion({
        menuProductId: latte, actorId,
        ingredients: [
          { productId: coffee, quantityMilli: 18_000, unit: "G" },
          { productId: cup, quantityMilli: 1_000, unit: "PIECE" },
        ],
      }, tx);

      const row = await rowFor(tx, latte);
      expect(row.versions).toBe(1);
      expect(row.activeVersion).toBe(1);
      expect(row.ingredients.find((i) => i.productId === coffee)!.quantity).toBe("18");
    }));

  it("ومكوّنٌ يُحذَف من الوصفة بالتصحيح", () =>
    withRollback(async (tx) => {
      const { actorId, coffee, latte } = await setup(tx);

      await correctRecipeVersion({
        menuProductId: latte, actorId,
        ingredients: [{ productId: coffee, quantityMilli: 20_000, unit: "G" }],
      }, tx);

      const row = await rowFor(tx, latte);
      expect(row.ingredientCount).toBe(1);
    }));

  it("ولا يقع على ما حُسب به جردٌ مقفَل — يُطلَب تغييرٌ مؤرَّخ", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee, latte } = await setup(tx);

      const { countId } = await startCount({
        periodStart: "2026-09-13", periodEnd: "2026-09-19", branchId: branch.id, actorId,
      }, tx);
      await finaliseCount(countId, actorId, tx);

      const e = await caught(correctRecipeVersion({
        menuProductId: latte, actorId,
        ingredients: [{ productId: coffee, quantityMilli: 18_000, unit: "G" }],
      }, tx));

      expect(e).toBeInstanceOf(RecipeLockedError);
      /* والرسالةُ تحمل الفترة التي منعت — لا «تعذّر الحفظ» */
      expect((e as Error).message).toContain("2026-09-13");

      const row = await rowFor(tx, latte);
      expect(row.correctable).toBe(false);
    }));

  it("والتغييرُ المؤرَّخ يمرّ فوق الجرد المقفَل — لأنّه لا يمسّ ما مضى", () =>
    withRollback(async (tx) => {
      const { actorId, branch, coffee, latte } = await setup(tx);

      const { countId } = await startCount({
        periodStart: "2026-09-13", periodEnd: "2026-09-19", branchId: branch.id, actorId,
      }, tx);
      await finaliseCount(countId, actorId, tx);

      await saveRecipeVersion({
        menuProductId: latte, effectiveFrom: "2026-09-20", activate: true, actorId,
        ingredients: [{ productId: coffee, quantityMilli: 18_000, unit: "G" }],
      }, tx);

      const row = await rowFor(tx, latte);
      expect(row.versions).toBe(2);
      expect(row.activeVersion).toBe(2);
      expect(row.activeFromLabel).toBe("2026-09-20");
    }));
});

describe("حذفُ الوصفة", () => {
  it("تُحذَف بنسخها كلِّها", () =>
    withRollback(async (tx) => {
      const { actorId, latte } = await setup(tx);

      const gone = await deleteRecipe(latte, actorId, tx);
      expect(gone.deletedVersions).toBe(1);

      const rows = await listRecipes(tx);
      expect(rows.some((r) => r.menuProductId === latte)).toBe(false);
    }));

  it("ولا تُحذَف وقد حُسب بها جردٌ مقفَل", () =>
    withRollback(async (tx) => {
      const { actorId, branch, latte } = await setup(tx);

      const { countId } = await startCount({
        periodStart: "2026-09-13", periodEnd: "2026-09-19", branchId: branch.id, actorId,
      }, tx);
      await finaliseCount(countId, actorId, tx);

      expect(await caught(deleteRecipe(latte, actorId, tx))).toBeInstanceOf(RecipeLockedError);
    }));
});

describe("إخراجُ صنفٍ من الجرد", () => {
  it("يمتنع ما دام مكوّناً في وصفةٍ سارية — ويسمّيها", () =>
    withRollback(async (tx) => {
      const { actorId, coffee } = await setup(tx);

      const e = await caught(retireStockItem(coffee, actorId, tx));
      expect(e).toBeInstanceOf(ItemInUseError);
      expect((e as Error).message).toContain("لاتيه");
    }));

  it("ويقع بعد حذفه من وصفاتها — تعطيلاً لا حذفاً، فيبقى تاريخُه", () =>
    withRollback(async (tx) => {
      const { actorId, coffee, cup, latte } = await setup(tx);

      await correctRecipeVersion({
        menuProductId: latte, actorId,
        ingredients: [{ productId: cup, quantityMilli: 1_000, unit: "PIECE" }],
      }, tx);

      await retireStockItem(coffee, actorId, tx);

      const [row] = (await tx.execute<{ is_active: boolean }>(sql`
        select is_active from products where id = ${coffee}
      `)).rows;
      expect(row.is_active).toBe(false);
    }));
});
