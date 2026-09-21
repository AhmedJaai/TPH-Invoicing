/**
 * الوصفات — حفظُ نسخةٍ وتفعيلُها.
 *
 * ولا تُعدَّل نسخةٌ في مكانها أبداً: التعديلُ نسخةٌ جديدة بتاريخٍ
 * جديد. فتقريرُ الأسبوع الماضي يبقى محسوباً بالوصفة التي كانت عاملةً
 * فيه — وهذا هو الشرطُ الذي بلا وفائه يصير كلُّ تقريرٍ تاريخيّ كاذباً.
 */
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import {
  RecipeLockedError, activateRecipeVersion, correctRecipeVersion, deleteRecipe,
  saveRecipeVersion, type IngredientDraft,
} from "@/services/recipe.service";
import { decimalToMilli } from "@/lib/inventory/units";
import { isStoredUnit } from "@/lib/unit-conversion";

export const runtime = "nodejs";

interface IngredientBody {
  productId?: string;
  /** الكمّيّة كما كتبها الإنسان: «18». */
  quantity?: string | number;
  unit?: string;
  /** فاقدُ التجهيز نسبةً مئويّة: «2.5». */
  prepLossPercent?: string | number | null;
  note?: string | null;
}

interface Body {
  action?: "save" | "activate" | "correct" | "delete";
  versionId?: string;
  menuProductId?: string;
  effectiveFrom?: string;
  yieldQuantity?: string | number | null;
  yieldUnit?: string | null;
  note?: string | null;
  activate?: boolean;
  ingredients?: IngredientBody[];
}

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("inventory-recipe", "recipe:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة." }, { status: 400 });
  }

  try {
    if (body.action === "activate") {
      if (!body.versionId) return NextResponse.json({ error: "لم تُحدَّد النسخة" }, { status: 400 });
      await activateRecipeVersion(body.versionId, user.id);
      return NextResponse.json({ ok: true, message: "فُعّلت النسخة — وأُغلقت السابقةُ في اليوم الذي قبلها." });
    }

    if (!body.menuProductId) return NextResponse.json({ error: "لم يُحدَّد الصنف المباع" }, { status: 400 });

    if (body.action === "delete") {
      const gone = await deleteRecipe(body.menuProductId, user.id);
      return NextResponse.json({
        ok: true,
        message: `حُذفت وصفةُ «${gone.name}» بنسخها (${gone.deletedVersions}).`,
      });
    }

    const ingredients: IngredientDraft[] = [];
    for (const raw of body.ingredients ?? []) {
      if (!raw.productId) continue;
      if (!isStoredUnit(raw.unit)) {
        return NextResponse.json({ error: "وحدةُ مكوّنٍ غير معروفة" }, { status: 400 });
      }
      const quantityMilli = decimalToMilli(typeof raw.quantity === "number" ? raw.quantity : String(raw.quantity ?? "").trim());
      if (quantityMilli === null || quantityMilli <= 0) {
        return NextResponse.json({ error: `كمّيّةُ مكوّنٍ غير مقروءة: «${String(raw.quantity ?? "")}»` }, { status: 400 });
      }

      /* النسبةُ تُكتب مئويّةً وتُخزَّن نقاطَ أساسٍ صحيحة — لا كسرَ عائم */
      let prepLossBp: number | null = null;
      if (raw.prepLossPercent !== null && raw.prepLossPercent !== undefined && String(raw.prepLossPercent).trim() !== "") {
        const milli = decimalToMilli(String(raw.prepLossPercent).trim());
        if (milli === null) return NextResponse.json({ error: "نسبةُ فاقد التجهيز غير مقروءة" }, { status: 400 });
        prepLossBp = Math.round(milli / 10);
        if (prepLossBp < 0 || prepLossBp >= 10_000) {
          return NextResponse.json({ error: "فاقدُ التجهيز بين صفرٍ ومئة بالمئة (غير شاملٍ للمئة)" }, { status: 400 });
        }
      }

      ingredients.push({ productId: raw.productId, quantityMilli, unit: raw.unit, prepLossBp, note: raw.note ?? null });
    }

    const yieldUnit = body.yieldUnit ?? null;
    if (yieldUnit !== null && !isStoredUnit(yieldUnit)) {
      return NextResponse.json({ error: "وحدةُ ناتج الوصفة غير معروفة" }, { status: 400 });
    }
    const yieldQuantityMilli = body.yieldQuantity === null || body.yieldQuantity === undefined || String(body.yieldQuantity).trim() === ""
      ? null
      : decimalToMilli(String(body.yieldQuantity).trim());
    if (yieldQuantityMilli !== null && (yieldQuantityMilli <= 0 || yieldUnit === null)) {
      return NextResponse.json({ error: "ناتجُ الوصفة يُذكَر بكمّيّته ووحدته معاً" }, { status: 400 });
    }

    /*
      ── التصحيحُ غيرُ التغيير ──

      التصحيحُ يقول «كانت دائماً كذا وأخطأنا في كتابتها»، فيسري على ما
      مضى ولا يُنشئ نسخة. والتغييرُ يقول «من هنا صار كذا»، فيُؤرَّخ.
    */
    if (body.action === "correct") {
      const fixed = await correctRecipeVersion({
        menuProductId: body.menuProductId, ingredients, actorId: user.id,
      });
      return NextResponse.json({
        ok: true, ...fixed,
        message: `صُحِّحت النسخة ${fixed.version} — والتصحيحُ يسري على الأسابيع كلِّها.`,
      });
    }

    const result = await saveRecipeVersion({
      menuProductId: body.menuProductId,
      effectiveFrom: body.effectiveFrom ?? "",
      yieldQuantityMilli,
      yieldUnit,
      note: body.note ?? null,
      ingredients,
      activate: body.activate !== false,
      actorId: user.id,
    });

    return NextResponse.json({
      ok: true, ...result,
      message: result.activated
        ? `حُفظت النسخة ${result.version} وسرت من ${body.effectiveFrom}.`
        : `حُفظت النسخة ${result.version} مسوّدةً — لا تدخل الحساب حتى تُفعَّل.`,
    });
  } catch (e) {
    /* «حُسب بها جردٌ مقفَل» خبرٌ عن الحال لا عطبٌ في الطلب */
    if (e instanceof RecipeLockedError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    const mapped = respondTo(e);
    if (mapped) return mapped;
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
