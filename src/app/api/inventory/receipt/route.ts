/**
 * الكمّيّةُ المستلَمة — تُقيَّد · تُعدَّل · تُلغى · يُحسَم تكرارُها.
 *
 * «دخلت الرفَّ بضاعة» — لا فاتورة ولا دين. والطلبُ يُفحَص وقتَ التشغيل
 * (`receipt-request.ts`)، والتكرارُ يُسأل عنه قبل الكتابة: يُردّ بـ409
 * ومعه المرشّحون، فتسأل الشاشةُ صاحبَها أهو نفسُ البند أم شحنةٌ أخرى.
 */
import { NextResponse } from "next/server";
import { guard, pgErrorCode, respondTo } from "@/services/guard";
import {
  PossibleDuplicateReceiptError, createReceipt, resolveReceipt, updateReceipt, voidReceipt,
} from "@/services/inventory-receipt.service";
import { parseReceiptRequest } from "@/lib/inventory/receipt-request";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("inventory-receipt", "inventory:count");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة." }, { status: 400 });
  }

  const parsed = parseReceiptRequest(raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const body = parsed.request;

  try {
    switch (body.action) {
      case "create": {
        const id = await createReceipt({
          productId: body.productId,
          branchId: body.branchId ?? null,
          receivedOn: body.receivedOn,
          enteredMilli: body.quantity,
          unit: body.unit,
          supplierId: body.supplierId ?? null,
          documentRef: body.documentRef,
          costMinor: body.cost ?? null,
          note: body.note,
          resolution: body.resolution ?? null,
        }, user.id);
        return NextResponse.json({ ok: true, receiptId: id, message: "قُيّدت الكمّيّةُ المستلَمة — ودخلت حسابَ الجرد." });
      }
      case "update": {
        await updateReceipt(body.receiptId, {
          receivedOn: body.receivedOn,
          enteredMilli: body.quantity,
          unit: body.unit,
          supplierId: body.supplierId,
          documentRef: body.documentRef,
          costMinor: body.cost,
          note: body.note,
        }, user.id);
        return NextResponse.json({ ok: true, message: "عُدّل الاستلام — وما كان مكتوبٌ في سجلّ التدقيق." });
      }
      case "void": {
        await voidReceipt(body.receiptId, body.reason, user.id);
        return NextResponse.json({ ok: true, message: "أُلغي الاستلام — ويبقى في السجلّ بسببه." });
      }
      case "resolve": {
        await resolveReceipt(body.receiptId, body.resolution, user.id);
        return NextResponse.json({
          ok: true,
          message: body.resolution.kind === "LINK"
            ? "رُبط الاستلامُ ببند الفاتورة — ويُحسَب مرّةً واحدة."
            : "أُكّد أنّهما شحنتان — ويُحسَب الاثنان.",
        });
      }
    }
  } catch (e) {
    if (e instanceof PossibleDuplicateReceiptError) {
      return NextResponse.json(
        { error: e.message, duplicateCandidates: e.candidates, earlierReceipts: e.earlierReceipts },
        { status: 409 },
      );
    }
    /*
      مؤثِّرُ `041`: أسبوعٌ جردُه مقفَل. ورسالتُه عربيّةٌ كتبها المؤثِّر
      نفسُه — وهي أدلُّ من «رفضت القاعدة قيداً ماليّاً» العامّة.
    */
    const code = pgErrorCode(e);
    const lockMessage = lockedWeekMessage(e);
    if (code === "23514" && lockMessage) return NextResponse.json({ error: lockMessage }, { status: 409 });
    if (code === "23505") {
      return NextResponse.json({ error: "هذا البندُ مرتبطٌ باستلامٍ آخر — والبندُ الواحد لا يمثّل شحنتين." }, { status: 409 });
    }
    const mapped = respondTo(e);
    if (mapped) return mapped;
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** رسالةُ مؤثِّر الأسبوع المقفَل إن كانت هي — على الخطأ أو على سببه. */
function lockedWeekMessage(e: unknown): string | null {
  const err = e as { message?: unknown; cause?: { message?: unknown } } | null;
  for (const m of [err?.cause?.message, err?.message]) {
    if (typeof m === "string" && m.includes("جردُه مقفَل")) return m.slice(m.indexOf("هذا"));
  }
  return null;
}
