/**
 * حدُّ الرصيد الأدنى — يكتبه صاحبُ المقهى، فيُنبَّه حين ينزل «النقد القادم» تحته.
 *
 * المبلغُ يصل نصّاً ويحوّله الخادمُ إلى هللات (`parseRiyals`)؛ والفارغُ يرفع الحدّ.
 * إعدادٌ لا مال: لا يغيّر رصيداً ولا دفعة — تحذيرٌ يُحسب به وحده.
 */
import { z } from "zod";
import { NextResponse } from "next/server";
import { readJson } from "@/lib/request-body";
import { guard, respondTo } from "@/services/guard";
import { formatRiyalsDisplay, parseRiyals } from "@/lib/money";
import { saveCashFloor } from "@/services/app-settings.service";

export const runtime = "nodejs";

const Body = z.object({
  setting: z.literal("cash-floor"),
  /** بالريالات نصّاً — وفارغٌ أو غائبٌ يرفع الحدّ */
  amount: z.string().max(30).optional(),
});

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("app-setting", "bank:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  const raw = read.body.amount?.trim() ?? "";

  if (raw === "") {
    await saveCashFloor(null, user.id);
    return NextResponse.json({ ok: true, message: "أُزيل الحد، ولن يظهر تنبيه على الرصيد" });
  }
  const minor = parseRiyals(raw);
  if (minor === null || minor <= 0) {
    return NextResponse.json({ error: "اكتب مبلغاً موجباً بالريال، أو اتركه فارغاً لإزالة الحد" }, { status: 400 });
  }
  await saveCashFloor(minor, user.id);
  return NextResponse.json({ ok: true, message: `تم حفظ الحد: ${formatRiyalsDisplay(minor)} ريال` });
}
