/**
 * «لماذا هذا الرقم؟» — آخرُ القيود التي حرّكت رقماً رئيسيّاً، من سجلّ التدقيق،
 * وما تغيّر منذ لقطة صباح أمس لما تحفظه اللقطة («عليك»). قراءةٌ وحدها، ولمن يرى المبالغ.
 */
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import { isFigureId } from "@/lib/figure-history";
import { loadFigureMovers } from "@/services/figure-history.service";
import { loadDayFigures } from "@/services/daily-figures.service";
import { loadBalanceTotals } from "@/services/supplier-balance.service";
import { sinceYesterday, type SinceYesterday } from "@/lib/since-yesterday";
import { addDays, todayInRiyadh } from "@/lib/riyadh-time";

/** «عليك» الآن ناقصاً لقطة صباح أمس — الرقمُ الوحيد هنا الذي تحفظه اللقطة اليوميّة. */
async function owedSinceYesterday(): Promise<SinceYesterday> {
  const day = addDays(todayInRiyadh(), -1);
  const [snap, balances] = await Promise.all([loadDayFigures(day), loadBalanceTotals()]);
  return sinceYesterday(balances.totals.owedMinor, snap ? snap.owedMinor : undefined, day);
}

export const runtime = "nodejs";

export async function GET(request: Request) {
  /* الطلبُ كلُّه لا الحارسُ وحده: خطأُ عملٍ معروف (شهرٌ مقفل، قيدٌ في القاعدة) يُقال بنصّه لا ٥٠٠ */
  try {
    return await handle(request);
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}

async function handle(request: Request) {
  const user = await guard("figure-history", "amounts:view");
  const figure = new URL(request.url).searchParams.get("figure");
  if (!isFigureId(figure)) {
    return NextResponse.json({ error: "الرقم غير معروف" }, { status: 400 });
  }
  const [movers, since] = await Promise.all([
    loadFigureMovers(figure, user.id),
    figure === "owed" ? owedSinceYesterday() : Promise.resolve(null),
  ]);
  return NextResponse.json({ ok: true, movers, since }, { headers: { "cache-control": "no-store" } });
}
