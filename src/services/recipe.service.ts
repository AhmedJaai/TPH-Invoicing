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
import { RECIPE_EPOCH, type RecipeVersionInput } from "@/lib/inventory/recipe";
import { recipeCost, type CostedIngredient, type RecipeCost } from "@/lib/inventory/recipe-cost";
import { milliToDecimal } from "@/lib/inventory/units";
import { milliMinorToMinor } from "@/lib/money";
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
  /**
   * من أين جاءت هذه النسخة.
   *
   * و`FOODICS_CATALOG` تعني أنّ استيراداً كتبها، فيجوز لاستيرادٍ لاحق
   * أن يُحدّثها. أمّا ما كتبه إنسانٌ (فارغٌ أو `HUMAN`) **فلا يُكتَب
   * فوقه**: من عدّل جرعةً بيده لا يُلغى عملُه لأنّ ملفّاً رُفع.
   */
  source?: string | null;
}

export interface SaveVersionResult {
  recipeId: string;
  versionId: string;
  version: number;
  activated: boolean;
  closedPrevious: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** فحصُ المسوّدة — واحدٌ للحفظ والتصحيح، فلا يفترق الشرطان. */
function validateDraft(ingredients: readonly IngredientDraft[]): void {
  if (ingredients.length === 0) throw new Error("وصفةٌ بلا مكوّنات لا تُحسَب — أضِف مكوّناً واحداً على الأقلّ");
  for (const ing of ingredients) {
    if (!isStoredUnit(ing.unit)) throw new Error("وحدةُ مكوّنٍ غير معروفة");
    if (!Number.isInteger(ing.quantityMilli) || ing.quantityMilli <= 0) {
      throw new Error("كمّيّةُ المكوّن تكون أكبر من صفر");
    }
  }
  /* المكوّنُ يتكرّر بخيارين مختلفين — ولا يتكرّر بالخيار نفسه */
  const seen = new Set<string>();
  for (const ing of ingredients) {
    const key = `${ing.productId}|${ing.modifierExternalId ?? ""}`;
    if (seen.has(key)) throw new Error("المكوّن مذكورٌ مرّتين بالخيار نفسه — اجمعه في سطرٍ واحد");
    seen.add(key);
  }
}

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
  validateDraft(input.ingredients);

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
      ── أوّلُ نسخةٍ سارية منذ البداية ──

      تصف **كيف كان يُصنَع المشروب دائماً**، لا كيف سيُصنَع من الغد.
      فلو بدأت يومَ كتابتها لخرج كلُّ بيعٍ قبلها «بلا نسخةٍ سارية».

      وقد وقع ذلك: رُفع الكتالوج بتاريخ سريانٍ في المستقبل، فقالت
      شاشةُ الجرد «لم يدخل الحسابَ سطرُ بيعٍ واحد» — ١٧٠٦ من ١٧١٧،
      والوصفاتُ كلُّها صحيحة.

      **والتغييرُ اللاحق وحده يُؤرَّخ**، فيبقى تقريرُ ما مضى محسوباً
      بما كان.
    */
    const first = Number(next) === 1;
    const effectiveFrom = first ? RECIPE_EPOCH : input.effectiveFrom;

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
        if (current.effectiveFrom >= effectiveFrom) {
          throw new Error(
            `النسخة السارية تبدأ في ${current.effectiveFrom} — فلا تبدأ الجديدة قبلها أو معها. اختر تاريخاً بعده.`,
          );
        }
        await tx
          .update(recipeVersions)
          .set({ effectiveTo: previousDay(effectiveFrom) })
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
        effectiveFrom,
        effectiveTo: null,
        yieldQuantityMilli: input.yieldQuantityMilli ?? null,
        yieldUnit: input.yieldUnit ?? null,
        note: input.note ?? null,
        source: input.source ?? "HUMAN",
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
        تسري_من: first ? "منذ البداية" : effectiveFrom,
        المكوّنات: input.ingredients.length,
        ...(closedPrevious ? { أُغلقت_السابقة_في: previousDay(effectiveFrom) } : {}),
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
  /** كلفةُ مكوّناتها بالهللات، و`null` إن جُهل مكوّنٌ واحد. */
  costMinor: number | null;
  /** وما جُهلت كلفتُه بأسمائه وأسبابه — «لماذا لا رقمَ هنا». */
  unknownCost: RecipeCost["unknown"];
  /** سعرُ بيعه عند نقاط البيع. */
  priceMinor: number | null;
  /** والكلفةُ التي يعلنها المصدر — تُقارَن ولا تحلّ محلّ الحساب. */
  declaredCostMinor: number | null;
  /** يومُ بدء السريان، و`RECIPE_EPOCH` تعني «منذ البداية». */
  activeFromLabel: string;
  /**
   * أيجوز تصحيحُها في مكانها؟
   *
   * يجوز ما دام **لا جردَ مقفَلٌ تتقاطع فترتُه مع سريانها**. فالتصحيح
   * يقول «كانت دائماً كذا وأخطأنا في كتابتها»، وذلك يسري على ما مضى.
   * أمّا إن قُفل عليها جردٌ فالتصحيحُ يجعل أصلَ تقريرٍ مجمَّدٍ يكذب —
   * فيُطلَب حينئذٍ **تغييرٌ مؤرَّخ** لا تصحيح.
   */
  correctable: boolean;
  /** مكوّناتُ النسخة القائمة، بكلفة كلٍّ — يُفتَح بها اللوحُ بلا طلبٍ ثانٍ. */
  ingredients: RecipeIngredientView[];
}

/** مكوّنٌ كما يُعرَض ويُعدَّل. */
export interface RecipeIngredientView {
  productId: string;
  name: string;
  /** الكمّيّة نصّاً بوحدتها: «0.18» — تُكتب في الحقل كما هي. */
  quantity: string;
  unit: StoredUnit;
  baseUnit: StoredUnit;
  costMinor: number | null;
}

/**
 * قائمةُ الوصفات كما تُعرَض — ومعها كلفتُها محسوبةً من عبوات مكوّناتها.
 *
 * والكلفةُ تُحسَب هنا ولا تُقرأ من عمود: الوصفةُ تتغيّر، والعبوةُ
 * يُعاد استيرادُها، ورقمٌ محفوظٌ بينهما يفترق عن مصدريه. والمجهولُ
 * يُنشر: مكوّنٌ بلا كلفةٍ يجعل مجموعَ وصفته `null` لا ناقصاً.
 */
export async function listRecipes(conn: Conn = db): Promise<RecipeRow[]> {
  const rows = await conn.execute<Record<string, unknown>>(sql`
    select r.id as recipe_id,
           r.product_id,
           p.name_ar as product_name,
           p.catalog_declared_cost_minor as declared_cost,
           (select pp.price_minor from pos_products pp
             where pp.product_id = p.id and pp.kind = 'PRODUCT'
             order by pp.created_at limit 1) as price_minor,
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
     group by r.id, p.name_ar, p.catalog_declared_cost_minor, p.id
     order by p.name_ar
  `);

  /*
    مكوّناتُ النسخة السارية لكلّ وصفةٍ في استعلامٍ واحد — لا استعلامٌ
    لكلّ صفّ. وصفحةٌ فيها ستّون وصفةً تعني ستّين رحلةً إلى القاعدة،
    وهي على فيرسل في المجمَّع طابورٌ على اتّصالٍ واحد.
  */
  const ings = await conn.execute<Record<string, unknown>>(sql`
    select r.id as recipe_id, i.product_id, p.name_ar, i.quantity_milli, i.unit,
           p.base_unit, p.catalog_pack_milli, p.catalog_pack_cost_minor
      from recipes r
      join recipe_versions v on v.recipe_id = r.id
       and v.id = (select v2.id from recipe_versions v2
                    where v2.recipe_id = r.id and v2.status = 'ACTIVE'
                    order by v2.effective_from desc limit 1)
      join recipe_ingredients i on i.recipe_version_id = v.id
      join products p on p.id = i.product_id
  `);

  /*
    ── أيُّ النسخ يجوز تصحيحُها ──

    التصحيحُ يسري على ما مضى، فلا يقع على نسخةٍ قُفل عليها جرد:
    أرقامُ المقفَل مجمَّدةٌ ولن تتغيّر، لكنّ **أصلَها سيكذب**. ويُقرأ
    الجوابُ لكلّ الوصفات في استعلامٍ واحد لا استعلامٍ لكلّ صفّ.
  */
  const locked = new Set(
    (await conn.execute<{ recipe_id: string }>(sql`
      select distinct v.recipe_id
        from recipe_versions v
        join inventory_counts c
          on c.status = 'FINALISED'
         and c.period_end >= v.effective_from
         and (v.effective_to is null or c.period_start <= v.effective_to)
       where v.status = 'ACTIVE' and v.effective_to is null
    `)).rows.map((r) => String(r.recipe_id)),
  );

  const byRecipe = new Map<string, CostedIngredient[]>();
  for (const r of ings.rows) {
    const unit = r.unit;
    const base = r.base_unit;
    if (!isStoredUnit(unit) || !isStoredUnit(base)) continue;
    const key = String(r.recipe_id);
    const list = byRecipe.get(key) ?? [];
    list.push({
      productId: String(r.product_id),
      name: String(r.name_ar),
      quantityMilli: Number(r.quantity_milli),
      unit,
      baseUnit: base,
      packMilli: r.catalog_pack_milli === null ? null : Number(r.catalog_pack_milli),
      packCostMinor: r.catalog_pack_cost_minor === null ? null : Number(r.catalog_pack_cost_minor),
    });
    byRecipe.set(key, list);
  }

  return rows.rows.map((r) => {
    const mine = byRecipe.get(String(r.recipe_id)) ?? [];
    const cost = recipeCost(mine);
    const costByProduct = new Map(cost.lines.map((l) => [l.productId, l.costMilliMinor] as const));
    return {
      recipeId: String(r.recipe_id),
      menuProductId: String(r.product_id),
      menuProductName: String(r.product_name),
      versions: Number(r.versions),
      activeVersion: r.active_version === null ? null : Number(r.active_version),
      activeFrom: r.active_from === null ? null : String(r.active_from),
      ingredientCount: Number(r.ingredient_count),
      costMinor: cost.costMinor,
      unknownCost: cost.unknown,
      priceMinor: r.price_minor === null ? null : Number(r.price_minor),
      declaredCostMinor: r.declared_cost === null ? null : Number(r.declared_cost),
      activeFromLabel: r.active_from === null ? "" : String(r.active_from),
      correctable: !locked.has(String(r.recipe_id)),
      ingredients: mine.map((i) => ({
        productId: i.productId,
        name: i.name,
        /* تُعرَض بوحدتها كما كُتبت — لا تُحوَّل إلى وحدة الصنف فتُقرأ «١٨٠ مليلتر» لمن كتب «٠٫١٨ لتر» */
        quantity: milliToDecimalTrimmed(i.quantityMilli),
        unit: i.unit,
        baseUnit: i.baseUnit,
        costMinor: (() => {
          const m = costByProduct.get(i.productId);
          return m === null || m === undefined ? null : milliMinorToMinor(m);
        })(),
      })),
    };
  });
}

/** «0.180» ← «0.18»، و«18.000» ← «18» — للعرض في حقلٍ يُكتب فيه. */
function milliToDecimalTrimmed(milliValue: number): string {
  return milliToDecimal(milliValue).replace(/\.?0+$/, "");
}


/* ───────────────────── التصحيحُ والحذف ───────────────────── */

/**
 * يُصحِّح مكوّناتِ النسخة القائمة **في مكانها**.
 *
 * ── ومتى يجوز ──
 *
 * «لا تُعدَّل نسخةٌ في مكانها» قاعدةٌ وُضعت لحماية **تقريرٍ مجمَّد**:
 * لو عُدِّلت وصفةٌ حُسب بها جردٌ مقفَل لصار أصلُ ذلك التقرير يكذب.
 *
 * فالحدُّ هو ذاك بعينه، لا أكثر: ما لم يُقفَل جردٌ تتقاطع فترتُه مع
 * سريان النسخة، فالتصحيح **يسري على ما مضى** — وهو الصواب: من كتب
 * «١٨ جراماً» وهي عشرون لم يُغيّر وصفتَه، بل أخطأ في كتابتها.
 *
 * وما عداه **تغييرٌ مؤرَّخ**: نسخةٌ ثانية تقول «من هنا صار كذا».
 */
export async function correctRecipeVersion(
  input: { menuProductId: string; ingredients: IngredientDraft[]; actorId: string },
  conn: Conn = db,
): Promise<{ versionId: string; version: number; ingredients: number }> {
  validateDraft(input.ingredients);

  return conn.transaction(async (tx) => {
    const [current] = (await tx.execute<{ version_id: string; version: number; recipe_id: string; name_ar: string }>(sql`
      select v.id as version_id, v.version, r.id as recipe_id, p.name_ar
        from recipes r
        join products p on p.id = r.product_id
        join recipe_versions v on v.recipe_id = r.id
       where r.product_id = ${input.menuProductId}
         and v.status = 'ACTIVE' and v.effective_to is null
       limit 1
    `)).rows;
    if (!current) throw new Error("لا نسخةَ سارية لهذا الصنف — احفظ وصفةً أوّلاً");

    const [locked] = (await tx.execute<{ period_start: string; period_end: string }>(sql`
      select c.period_start, c.period_end
        from recipe_versions v
        join inventory_counts c
          on c.status = 'FINALISED'
         and c.period_end >= v.effective_from
         and (v.effective_to is null or c.period_start <= v.effective_to)
       where v.id = ${String(current.version_id)}
       limit 1
    `)).rows;
    if (locked) {
      throw new RecipeLockedError(String(locked.period_start), String(locked.period_end));
    }

    /*
      ── والمصحَّحُ صار مكتوباً بيد إنسان ──

      النسخةُ المستورَدة مصدرُها `FOODICS_CATALOG`، والاستيرادُ يكتب
      فوقها بحقّ. فلو بقي مصدرُها كما هو بعد التصحيح لعاد أوّلُ استيرادٍ
      فكتب فوق ما صحّحه صاحبُ المقهى — **وهو بالضبط ما تمنعه القاعدة
      القائمة**: ما كتبه إنسانٌ لا يُكتَب فوقه، ويُعلَن أنّه تُخطّي.
    */
    await tx.execute(sql`update recipe_versions set source = 'HUMAN' where id = ${String(current.version_id)}`);

    await tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeVersionId, String(current.version_id)));
    await tx.insert(recipeIngredients).values(
      input.ingredients.map((ing) => ({
        recipeVersionId: String(current.version_id),
        productId: ing.productId,
        quantityMilli: ing.quantityMilli,
        unit: ing.unit,
        prepLossBp: ing.prepLossBp ?? null,
        modifierExternalId: ing.modifierExternalId ?? null,
        note: ing.note ?? null,
      })),
    );

    await recordAudit({
      actorId: input.actorId,
      action: "RECIPE_VERSION_CORRECTED",
      entityType: "recipe_version",
      entityId: String(current.version_id),
      after: {
        الصنف: String(current.name_ar),
        النسخة: Number(current.version),
        المكوّنات: input.ingredients.length,
        ملاحظة: "تصحيحٌ في مكانه — يسري على ما مضى، ولا جردَ مقفَلٌ عليه",
      },
    }, tx);

    return {
      versionId: String(current.version_id),
      version: Number(current.version),
      ingredients: input.ingredients.length,
    };
  });
}

/** نسخةٌ حُسب بها جردٌ مقفَل — تُغيَّر بنسخةٍ مؤرَّخة لا بتصحيح. */
export class RecipeLockedError extends Error {
  constructor(readonly periodStart: string, readonly periodEnd: string) {
    super(
      `حُسب بهذه الوصفة جردٌ مقفَل (${periodStart} → ${periodEnd})،`
      + ` فتصحيحُها يجعل أصلَ ذلك التقرير يكذب.`
      + ` احفظ **تغييراً بتاريخ** يبدأ بعد الجرد المقفل.`,
    );
    this.name = "RecipeLockedError";
  }
}

/**
 * يحذف وصفةً بنسخها كلِّها.
 *
 * ولا يقع على ما حُسب به جردٌ مقفَل — للسبب نفسه: التقريرُ المجمَّد
 * يحفظ **بم حُسب**، وحذفُ أصله يجعل ذلك الحفظ إشارةً إلى لا شيء.
 */
export async function deleteRecipe(
  menuProductId: string,
  actorId: string,
  conn: Conn = db,
): Promise<{ deletedVersions: number; name: string }> {
  return conn.transaction(async (tx) => {
    const [row] = (await tx.execute<{ recipe_id: string; name_ar: string; versions: number }>(sql`
      select r.id as recipe_id, p.name_ar,
             (select count(*)::int from recipe_versions v where v.recipe_id = r.id) as versions
        from recipes r
        join products p on p.id = r.product_id
       where r.product_id = ${menuProductId}
       limit 1
    `)).rows;
    if (!row) throw new Error("لا وصفةَ لهذا الصنف");

    const [locked] = (await tx.execute<{ period_start: string; period_end: string }>(sql`
      select c.period_start, c.period_end
        from recipe_versions v
        join inventory_counts c
          on c.status = 'FINALISED'
         and c.period_end >= v.effective_from
         and (v.effective_to is null or c.period_start <= v.effective_to)
       where v.recipe_id = ${String(row.recipe_id)}
       limit 1
    `)).rows;
    if (locked) {
      throw new RecipeLockedError(String(locked.period_start), String(locked.period_end));
    }

    await tx.delete(recipes).where(eq(recipes.id, String(row.recipe_id)));

    await recordAudit({
      actorId,
      action: "RECIPE_DELETED",
      entityType: "recipe",
      entityId: String(row.recipe_id),
      before: { الصنف: String(row.name_ar), النسخ: Number(row.versions) },
    }, tx);

    return { deletedVersions: Number(row.versions), name: String(row.name_ar) };
  });
}

/**
 * صنفُ مخزونٍ لا يخرج من القائمة لأنّه مذكورٌ في وصفةٍ سارية.
 *
 * فإخراجُه يترك وصفاتٍ تشير إلى صنفٍ لا يُعَدّ — فتُحسَب لها كلفةٌ
 * ولا يُقابلها عدٌّ على الرفّ، ويظهر فرقُها الأسبوعيّ بحجم ما اشتُري
 * منه. والوصفةُ تُصحَّح أوّلاً، ثمّ يخرج الصنف.
 */
export class ItemInUseError extends Error {
  constructor(public readonly recipes: readonly string[]) {
    super(
      `هذا الصنف مكوّنٌ في ${recipes.length} وصفةً سارية (${recipes.slice(0, 5).join("، ")}`
      + `${recipes.length > 5 ? "…" : ""}). احذفه من وصفاتها أوّلاً، ثمّ أخرِجه.`,
    );
    this.name = "ItemInUseError";
  }
}

/**
 * يُخرج صنفَ مخزونٍ من القائمة — **ولا يحذف تاريخه**.
 *
 * ── ولماذا إخراجٌ لا حذف ──
 *
 * الصنفُ مذكورٌ في بنود فواتير، وحركات مخزون، وأسطر جردٍ مقفَل. فحذفُه
 * يجعل تلك الأسطر تشير إلى لا شيء — وأسطرُ الجرد المقفَل مجمَّدةٌ
 * عمداً كي يبقى التقريرُ التاريخيّ صادقاً. والقاعدةُ نفسُها في
 * المورّدين منذ اليوم الأوّل: **يُدمَج ويُعطَّل، ولا يُحذف**.
 *
 * فالذي يقع هو `is_active = false`: يختفي من الجرد ومن قوائم اختيار
 * المكوّنات، ويبقى ما مضى كما حُسب.
 */
export async function retireStockItem(
  productId: string,
  actorId: string,
  conn: Conn = db,
): Promise<{ name: string }> {
  return conn.transaction(async (tx) => {
    const [row] = (await tx.execute<{ name_ar: string }>(sql`
      select p.name_ar from products p
       where p.id = ${productId} and p.is_stock_item and p.is_active
       limit 1
    `)).rows;
    if (!row) throw new Error("لا صنفَ مخزونٍ قائمٌ بهذا المعرّف");

    /* الوصفاتُ السارية وحدها تمنع — والمؤرشفةُ ذكرى، لا استعمال */
    const used = (await tx.execute<{ name_ar: string }>(sql`
      select distinct mp.name_ar
        from recipe_ingredients ri
        join recipe_versions v on v.id = ri.recipe_version_id
        join recipes r on r.id = v.recipe_id
        join products mp on mp.id = r.product_id
       where ri.product_id = ${productId}
         and v.status = 'ACTIVE' and v.effective_to is null
       order by mp.name_ar
    `)).rows;
    if (used.length > 0) throw new ItemInUseError(used.map((u) => String(u.name_ar)));

    await tx.execute(sql`update products set is_active = false where id = ${productId}`);

    await recordAudit({
      actorId,
      action: "STOCK_ITEM_RETIRED",
      entityType: "product",
      entityId: productId,
      before: { الصنف: String(row.name_ar), قائم: true },
      after: { قائم: false },
    }, tx);

    return { name: String(row.name_ar) };
  });
}
