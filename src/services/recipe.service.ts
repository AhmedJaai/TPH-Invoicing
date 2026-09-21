/**
 * الوصفات — إنشاءً وتنسيخاً وتفعيلاً.
 *
 * ── التفعيلُ فعلٌ لا حفظ ──
 *
 * النسخةُ تُكتَب مسوّدةً، ثمّ تُفعَّل بفترتها. والتفعيلُ **يُغلق
 * سابقتَها في اليوم الذي قبله** — فلا تتداخل نسختان ساريتان، ولا
 * تُترَك فجوةٌ بينهما تسقط فيها مبيعاتُ يوم.
 *
 * ومؤثِّرُ `036` يمنع التداخل في القاعدة أيضاً: الكتابةُ تأتي من
 * مسارين (الواجهة ونصُّ تهيئة)، والاتّفاقُ البرمجيّ وحده لا يُعوَّل
 * عليه — درسٌ مكتوبٌ في `CLAUDE.md` عن ثلاث طبقاتٍ لمنع التكرار.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { products, recipeIngredients, recipeVersions, recipes } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { isStoredUnit, type StoredUnit } from "@/lib/unit-conversion";
import type { RecipeVersionInput } from "@/lib/inventory/recipe";
import type { Conn } from "./types";

export interface IngredientDraft {
  productId: string;
  quantityMilli: number;
  unit: StoredUnit;
  prepLossBp?: number | null;
  /** يُملأ حين يزيد خيارٌ بعينه هذا المكوّن — ولا يقع بلا قرار إنسان. */
  modifierExternalId?: string | null;
  note?: string | null;
}

export interface SaveVersionInput {
  menuProductId: string;
  effectiveFrom: string;
  yieldQuantityMilli?: number | null;
  yieldUnit?: StoredUnit | null;
  note?: string | null;
  ingredients: IngredientDraft[];
  activate: boolean;
  actorId: string;
}

export interface SaveVersionResult {
  recipeId: string;
  versionId: string;
  version: number;
  activated: boolean;
  closedPrevious: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** اليومُ السابق — نصّاً، بلا `Date` محلّيّة تجرّ منطقةَ الجلسة. */
export function previousDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * يحفظ نسخةً جديدة، ويفعّلها إن طُلب.
 *
 * ولا تُعدَّل نسخةٌ سارية في مكانها أبداً: التعديلُ نسخةٌ جديدة
 * بفترةٍ جديدة. فلو عُدّلت في مكانها لتغيّر بأثرٍ رجعيّ كلُّ تقريرٍ
 * حُسب بها — وهو ما تمنعه هذه الطبقةُ كلُّها.
 */
export async function saveRecipeVersion(input: SaveVersionInput, conn: Conn = db): Promise<SaveVersionResult> {
  if (!DATE.test(input.effectiveFrom)) throw new Error("تاريخُ بدء السريان يُكتب YYYY-MM-DD");
  if (input.ingredients.length === 0) throw new Error("وصفةٌ بلا مكوّنات لا تُحسَب — أضِف مكوّناً واحداً على الأقلّ");
  for (const ing of input.ingredients) {
    if (!isStoredUnit(ing.unit)) throw new Error("وحدةُ مكوّنٍ غير معروفة");
    if (!Number.isInteger(ing.quantityMilli) || ing.quantityMilli <= 0) {
      throw new Error("كمّيّةُ المكوّن تكون أكبر من صفر");
    }
  }
  /* المكوّنُ يتكرّر بخيارين مختلفين — ولا يتكرّر بالخيار نفسه */
  const seen = new Set<string>();
  for (const ing of input.ingredients) {
    const key = `${ing.productId}|${ing.modifierExternalId ?? ""}`;
    if (seen.has(key)) throw new Error("المكوّن مذكورٌ مرّتين بالخيار نفسه — اجمعه في سطرٍ واحد");
    seen.add(key);
  }

  return conn.transaction(async (tx) => {
    const [menu] = await tx
      .select({ id: products.id, nameAr: products.nameAr })
      .from(products)
      .where(eq(products.id, input.menuProductId))
      .limit(1);
    if (!menu) throw new Error("الصنف المباع غير موجود");

    /* الصنفُ الذي له وصفةٌ صنفُ قائمة — يُوسَم صراحةً لا يُستنتَج */
    await tx.update(products).set({ isMenuItem: true, updatedAt: new Date() }).where(eq(products.id, menu.id));

    let [recipe] = await tx
      .select({ id: recipes.id })
      .from(recipes)
      .where(eq(recipes.productId, menu.id))
      .limit(1);

    let created = false;
    if (!recipe) {
      const [row] = await tx
        .insert(recipes)
        .values({ productId: menu.id, createdById: input.actorId })
        .returning({ id: recipes.id });
      recipe = row;
      created = true;
    }

    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${recipeVersions.version}), 0) + 1` })
      .from(recipeVersions)
      .where(eq(recipeVersions.recipeId, recipe.id));

    /*
      ── تُغلَق السابقةُ قبل أن تُكتَب اللاحقة ──

      ومؤثِّرُ القاعدة يرفض التداخل، فلو عُكس الترتيب سقطت الكتابةُ
      كلُّها. والإغلاقُ في اليومِ الذي قبل بدءِ الجديدة: فلا يوم
      بلا وصفة، ولا يومٌ بوصفتين.
    */
    let closedPrevious: string | null = null;
    if (input.activate) {
      const [current] = await tx
        .select({ id: recipeVersions.id, effectiveFrom: recipeVersions.effectiveFrom })
        .from(recipeVersions)
        .where(and(eq(recipeVersions.recipeId, recipe.id), eq(recipeVersions.status, "ACTIVE")))
        .orderBy(desc(recipeVersions.effectiveFrom))
        .limit(1);

      if (current) {
        if (current.effectiveFrom >= input.effectiveFrom) {
          throw new Error(
            `النسخة السارية تبدأ في ${current.effectiveFrom} — فلا تبدأ الجديدة قبلها أو معها. اختر تاريخاً بعده.`,
          );
        }
        await tx
          .update(recipeVersions)
          .set({ effectiveTo: previousDay(input.effectiveFrom) })
          .where(eq(recipeVersions.id, current.id));
        closedPrevious = current.id;
      }
    }

    const [version] = await tx
      .insert(recipeVersions)
      .values({
        recipeId: recipe.id,
        version: Number(next),
        status: input.activate ? "ACTIVE" : "DRAFT",
        effectiveFrom: input.effectiveFrom,
        effectiveTo: null,
        yieldQuantityMilli: input.yieldQuantityMilli ?? null,
        yieldUnit: input.yieldUnit ?? null,
        note: input.note ?? null,
        createdById: input.actorId,
        activatedById: input.activate ? input.actorId : null,
        activatedAt: input.activate ? new Date() : null,
      })
      .returning({ id: recipeVersions.id, version: recipeVersions.version });

    await tx.insert(recipeIngredients).values(
      input.ingredients.map((ing) => ({
        recipeVersionId: version.id,
        productId: ing.productId,
        quantityMilli: ing.quantityMilli,
        unit: ing.unit,
        prepLossBp: ing.prepLossBp ?? null,
        modifierExternalId: ing.modifierExternalId ?? null,
        note: ing.note ?? null,
      })),
    );

    if (created) {
      await recordAudit({
        actorId: input.actorId,
        action: "RECIPE_CREATED",
        entityType: "recipe",
        entityId: recipe.id,
        after: { الصنف: menu.nameAr },
      }, tx);
    }
    await recordAudit({
      actorId: input.actorId,
      action: input.activate ? "RECIPE_VERSION_ACTIVATED" : "RECIPE_VERSION_SAVED",
      entityType: "recipe_version",
      entityId: version.id,
      after: {
        الصنف: menu.nameAr,
        النسخة: version.version,
        تسري_من: input.effectiveFrom,
        المكوّنات: input.ingredients.length,
        ...(closedPrevious ? { أُغلقت_السابقة_في: previousDay(input.effectiveFrom) } : {}),
      },
    }, tx);

    return {
      recipeId: recipe.id,
      versionId: version.id,
      version: version.version,
      activated: input.activate,
      closedPrevious,
    };
  });
}

/** يفعّل مسوّدةً قائمة بالمنطق نفسه: تُغلَق السابقةُ ثمّ تُفتَح هذه. */
export async function activateRecipeVersion(versionId: string, actorId: string, conn: Conn = db): Promise<void> {
  await conn.transaction(async (tx) => {
    const [v] = await tx
      .select({
        id: recipeVersions.id, recipeId: recipeVersions.recipeId,
        status: recipeVersions.status, effectiveFrom: recipeVersions.effectiveFrom,
        version: recipeVersions.version,
      })
      .from(recipeVersions)
      .where(eq(recipeVersions.id, versionId))
      .limit(1);
    if (!v) throw new Error("نسخةُ الوصفة غير موجودة");
    if (v.status === "ACTIVE") return;

    const [current] = await tx
      .select({ id: recipeVersions.id, effectiveFrom: recipeVersions.effectiveFrom })
      .from(recipeVersions)
      .where(and(eq(recipeVersions.recipeId, v.recipeId), eq(recipeVersions.status, "ACTIVE")))
      .orderBy(desc(recipeVersions.effectiveFrom))
      .limit(1);

    if (current) {
      if (current.effectiveFrom >= v.effectiveFrom) {
        throw new Error(`النسخة السارية تبدأ في ${current.effectiveFrom} — عدِّل تاريخ هذه لتبدأ بعده.`);
      }
      await tx
        .update(recipeVersions)
        .set({ effectiveTo: previousDay(v.effectiveFrom) })
        .where(eq(recipeVersions.id, current.id));
    }

    await tx
      .update(recipeVersions)
      .set({ status: "ACTIVE", activatedById: actorId, activatedAt: new Date() })
      .where(eq(recipeVersions.id, versionId));

    await recordAudit({
      actorId,
      action: "RECIPE_VERSION_ACTIVATED",
      entityType: "recipe_version",
      entityId: versionId,
      after: { النسخة: v.version, تسري_من: v.effectiveFrom },
    }, tx);
  });
}

/**
 * نسخُ الوصفات بمكوّناتها — مدخلُ المحرّك.
 *
 * وتُحمَّل كلُّها لا الساريةُ اليوم فحسب: الجردُ قد يكون عن فترةٍ ماضية،
 * وحسابُها بالنسخة السارية **الآن** هو بالضبط ما تمنعه هذه الطبقة.
 */
export async function loadRecipeVersions(conn: Conn = db): Promise<RecipeVersionInput[]> {
  const rows = await conn
    .select({
      id: recipeVersions.id,
      recipeId: recipeVersions.recipeId,
      menuProductId: recipes.productId,
      version: recipeVersions.version,
      status: recipeVersions.status,
      effectiveFrom: recipeVersions.effectiveFrom,
      effectiveTo: recipeVersions.effectiveTo,
      yieldQuantityMilli: recipeVersions.yieldQuantityMilli,
      yieldUnit: recipeVersions.yieldUnit,
    })
    .from(recipeVersions)
    .innerJoin(recipes, eq(recipes.id, recipeVersions.recipeId))
    .orderBy(asc(recipes.productId), asc(recipeVersions.effectiveFrom));

  const ingredients = await conn
    .select({
      recipeVersionId: recipeIngredients.recipeVersionId,
      productId: recipeIngredients.productId,
      quantityMilli: recipeIngredients.quantityMilli,
      unit: recipeIngredients.unit,
      prepLossBp: recipeIngredients.prepLossBp,
      modifierExternalId: recipeIngredients.modifierExternalId,
    })
    .from(recipeIngredients);

  const byVersion = new Map<string, RecipeVersionInput["ingredients"][number][]>();
  for (const ing of ingredients) {
    const list = byVersion.get(ing.recipeVersionId);
    const value = {
      productId: ing.productId,
      quantityMilli: Number(ing.quantityMilli),
      unit: ing.unit,
      prepLossBp: ing.prepLossBp,
      modifierExternalId: ing.modifierExternalId,
    };
    if (list) list.push(value);
    else byVersion.set(ing.recipeVersionId, [value]);
  }

  return rows.map((r) => ({
    id: r.id,
    recipeId: r.recipeId,
    menuProductId: r.menuProductId,
    version: r.version,
    status: r.status,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    yieldQuantityMilli: r.yieldQuantityMilli === null ? null : Number(r.yieldQuantityMilli),
    yieldUnit: r.yieldUnit,
    ingredients: byVersion.get(r.id) ?? [],
  }));
}

export interface RecipeRow {
  recipeId: string;
  menuProductId: string;
  menuProductName: string;
  versions: number;
  activeVersion: number | null;
  activeFrom: string | null;
  ingredientCount: number;
}

/** قائمةُ الوصفات كما تُعرَض — ومعها ما بِيع بلا وصفة يُحسَب في مكانٍ آخر. */
export async function listRecipes(conn: Conn = db): Promise<RecipeRow[]> {
  const rows = await conn.execute<Record<string, unknown>>(sql`
    select r.id as recipe_id,
           r.product_id,
           p.name_ar as product_name,
           count(v.id)::int as versions,
           max(v.version) filter (where v.status = 'ACTIVE') as active_version,
           max(v.effective_from) filter (where v.status = 'ACTIVE') as active_from,
           coalesce((
             select count(*)::int from recipe_ingredients ri
              where ri.recipe_version_id = (
                select v2.id from recipe_versions v2
                 where v2.recipe_id = r.id and v2.status = 'ACTIVE'
                 order by v2.effective_from desc limit 1
              )
           ), 0) as ingredient_count
      from recipes r
      join products p on p.id = r.product_id
      left join recipe_versions v on v.recipe_id = r.id
     group by r.id, p.name_ar
     order by p.name_ar
  `);

  return rows.rows.map((r) => ({
    recipeId: String(r.recipe_id),
    menuProductId: String(r.product_id),
    menuProductName: String(r.product_name),
    versions: Number(r.versions),
    activeVersion: r.active_version === null ? null : Number(r.active_version),
    activeFrom: r.active_from === null ? null : String(r.active_from),
    ingredientCount: Number(r.ingredient_count),
  }));
}
