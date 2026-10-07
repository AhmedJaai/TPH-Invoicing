/**
 * الهدرُ المسجَّل وحركاتُ المخزون.
 *
 * وتسجيلُ الهدر **ينقل** كمّيّةً من «فرقٍ غير مفسَّر» إلى «هدرٍ
 * مسجَّل» — لا يزيد شيئاً ولا ينقصه من الرفّ. وهذا هو معنى الفصل
 * بينهما: الأوّلُ سؤالٌ مفتوح، والثاني جوابٌ مكتوب.
 */
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import {
  MovementRefused, recordMovement, recordWaste, voidWaste,
  WASTE_REASON_LABEL, MOVEMENT_KIND_LABEL,
  type MovementKind, type WasteReason,
} from "@/services/inventory-movement.service";
import { recomputeCount } from "@/services/inventory.service";
import { ambiguousThousandsMessage, decimalToMilli, isAmbiguousThousands } from "@/lib/inventory/units";
import { isStoredUnit } from "@/lib/unit-conversion";

export const runtime = "nodejs";

const Body = z.object({
  action: z.enum(["waste", "movement", "void"]).optional(),
  /** للإبطال: معرّفُ سطر الهدر. */
  wasteId: z.string().trim().min(1).max(64).optional(),
  /** مفتاحُ الطلب من المتصفّح — ضغطتان سطرٌ واحد. */
  clientRequestId: z.string().trim().min(8).max(64).optional(),
  productId: z.string().trim().min(1).max(64).optional(),
  quantity: z.union([z.string().max(30), z.number()]).optional(),
  unit: z.string().max(10).optional(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ بصيغة YYYY-MM-DD").optional(),
  reason: z.string().max(40).optional(),
  kind: z.string().max(40).optional(),
  note: z.string().max(500).nullable().optional(),
  branchId: z.string().trim().min(1).max(64).nullable().optional(),
  countId: z.string().trim().min(1).max(64).nullable().optional(),
});
type Body = z.infer<typeof Body>;

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("inventory-waste", "inventory:count");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  const body: Body = read.body;

  /*
    ── الإبطال: السطرُ يبقى بسببه ويخرج من الحساب ──

    وفي أسبوعٍ جردُه مقفَل يرفضه مؤثِّرُ `050`، و`respondTo` تقول سببَه.
  */
  if (body.action === "void") {
    if (!body.wasteId) return NextResponse.json({ error: "لم يُحدَّد سطرُ الهدر" }, { status: 400 });
    try {
      await voidWaste(body.wasteId, body.reason ?? "", user.id);
      if (body.countId) await recomputeCount(body.countId).catch(() => undefined);
      return NextResponse.json({ ok: true, message: "أُبطل الهدر — وعاد مقدارُه إلى «الفرق غير المفسَّر»." });
    } catch (e) {
      if (e instanceof MovementRefused) return NextResponse.json({ error: e.message }, { status: 409 });
      const mapped = respondTo(e);
      if (mapped) return mapped;
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }

  if (!body.productId) return NextResponse.json({ error: "لم يُحدَّد الصنف" }, { status: 400 });
  if (!isStoredUnit(body.unit)) return NextResponse.json({ error: "وحدةٌ غير معروفة" }, { status: 400 });

  /* «5,200» لا تُخمَّن — فرقٌ بألف ضعف في هدرٍ يُطرَح من الفرق */
  if (typeof body.quantity === "string" && isAmbiguousThousands(body.quantity)) {
    return NextResponse.json({ error: ambiguousThousandsMessage(body.quantity) }, { status: 400 });
  }
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
      const r = await recordWaste({
        productId: body.productId, quantityMilli, unit: body.unit,
        occurredOn: body.occurredOn ?? "", reason, note: body.note ?? null,
        branchId: body.branchId ?? null, countId: body.countId ?? null,
        clientRequestId: body.clientRequestId ?? null, actorId: user.id,
      });
      /* الضغطةُ الثانية لا تكتب — ويُقال ذلك، فلا يُظنّ أنّ الهدرَ سُجّل مرّتين */
      if (r.duplicate) {
        return NextResponse.json({ ok: true, duplicate: true, message: "سُجّل هذا الهدرُ قبل لحظة — لم يُكتَب مرّةً ثانية." });
      }
    }

    /* الجردُ المفتوح يُعاد حسابُه فوراً — فالرقمُ الذي على الشاشة يتبع ما كُتب */
    if (body.countId) await recomputeCount(body.countId).catch(() => undefined);

    return NextResponse.json({
      ok: true,
      message: body.action === "movement" ? "قُيّدت الحركة." : "سُجّل الهدر — وخرج من «الفرق غير المفسَّر».",
    });
  } catch (e) {
    if (e instanceof MovementRefused) return NextResponse.json({ error: e.message }, { status: 409 });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
