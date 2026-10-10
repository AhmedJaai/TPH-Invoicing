/**
 * «لماذا هذا الرقم؟» — آخرُ القيود التي حرّكت رقماً رئيسيّاً، من سجلّ التدقيق.
 * قراءةٌ وحدها، ولمن يرى المبالغ.
 */
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import { isFigureId } from "@/lib/figure-history";
import { loadFigureMovers } from "@/services/figure-history.service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  let user;
  try {
    user = await guard("figure-history", "amounts:view");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
  const figure = new URL(request.url).searchParams.get("figure");
  if (!isFigureId(figure)) {
    return NextResponse.json({ error: "رقمٌ غير معروف" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, movers: await loadFigureMovers(figure, user.id) }, { headers: { "cache-control": "no-store" } });
}
