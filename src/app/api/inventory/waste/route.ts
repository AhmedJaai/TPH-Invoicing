/**
 * الهدرُ المسجَّل وحركاتُ المخزون.
 *
 * وتسجيلُ الهدر **ينقل** كمّيّةً من «فرقٍ غير مفسَّر» إلى «هدرٍ
 * مسجَّل» — لا يزيد شيئاً ولا ينقصه من الرفّ. وهذا هو معنى الفصل
 * بينهما: الأوّلُ سؤالٌ مفتوح، والثاني جوابٌ مكتوب.
 */
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import {
  recordMovement, recordWaste,
  WASTE_REASON_LABEL, MOVEMENT_KIND_LABEL,
  type MovementKind, type WasteReason,
} from "@/services/inventory-movement.service";
import { recomputeCount } from "@/services/inventory.service";
import { decimalToMilli } from "@/lib/inventory/units";
import { isStoredUnit } from "@/lib/unit-conversion";

export const runtime = "nodejs";

interface Body {
  action?: "waste" | "movement";
  productId?: string;
  quantity?: string | number;
  unit?: string;
  occurredOn?: string;
  reason?: string;
  kind?: string;
  note?: string | null;
  branchId?: string | null;
  countId?: string | null;
}

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("inventory-waste", "inventory:count");
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

  if (!body.productId) return NextResponse.json({ error: "لم يُحدَّد الصنف" }, { status: 400 });
  if (!isStoredUnit(body.unit)) return NextResponse.json({ error: "وحدةٌ غير معروفة" }, { status: 400 });

  const quantityMilli = decimalToMilli(typeof body.quantity === "number" ? body.quantity : String(body.quantity ?? "").trim());
  if (quantityMilli === null || quantityMilli <= 0) {
    return NextResponse.json({ error: "اكتب كمّيّةً أكبر من صفر" }, { status: 400 });
  }

  try {
    if (body.action === "movement") {
      const kind = body.kind as MovementKind;
      if (!(kind in MOVEMENT_KIND_LABEL)) {
        return NextResponse.json({ error: "بابُ الحركة غير معروف" }, { status: 400 });
      }
      await recordMovement({
        productId: body.productId, kind, quantityMilli, unit: body.unit,
        occurredOn: body.occurredOn ?? "", note: body.note ?? null,
        branchId: body.branchId ?? null, countId: body.countId ?? null, actorId: user.id,
      });
    } else {
      const reason = body.reason as WasteReason;
      if (!(reason in WASTE_REASON_LABEL)) {
        return NextResponse.json({ error: "سببُ الهدر غير معروف" }, { status: 400 });
      }
      await recordWaste({
        productId: body.productId, quantityMilli, unit: body.unit,
        occurredOn: body.occurredOn ?? "", reason, note: body.note ?? null,
        branchId: body.branchId ?? null, countId: body.countId ?? null, actorId: user.id,
      });
    }

    /* الجردُ المفتوح يُعاد حسابُه فوراً — فالرقمُ الذي على الشاشة يتبع ما كُتب */
    if (body.countId) await recomputeCount(body.countId).catch(() => undefined);

    return NextResponse.json({
      ok: true,
      message: body.action === "movement" ? "قُيّدت الحركة." : "سُجّل الهدر — وخرج من «الفرق غير المفسَّر».",
    });
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
