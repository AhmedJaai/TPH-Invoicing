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
import { saveCashCustody, saveCashFloor } from "@/services/app-settings.service";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("setting", [
  z.object({
    setting: z.literal("cash-floor"),
    /** بالريالات نصّاً — وفارغٌ أو غائبٌ يرفع الحدّ */
    amount: z.string().max(30).optional(),
  }),
  /* أين نقدُ الصندوق — جوابُ المالك؛ و`null` «لم يُقَل» */
  z.object({ setting: z.literal("cash-custody"), value: z.enum(["OWNER_HOLDS", "SPENT"]).nullable() }),
]);

export async function POST(request: Request) {
  try {
    return await save(request);
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}

async function save(request: Request) {
  const user = await guard("app-setting", "bank:edit");
  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  const body = read.body;
  if (body.setting === "cash-custody") {
    await saveCashCustody(body.value, user.id);
    return NextResponse.json({ ok: true, message: body.value === "OWNER_HOLDS" ? "حُفظ: النقد عندك ولم يُصرف" : body.value === "SPENT" ? "حُفظ: يُصرف من النقد على المقهى" : "أُزيل الجواب" });
  }
  const raw = body.amount?.trim() ?? "";

  if (raw === "") {
    await saveCashFloor(null, user.id);
    return NextResponse.json({ ok: true, message: "أُزيل الحد، ولن يظهر تنبيه على الرصيد" });
  }
  const minor = parseRiyals(raw);
  if (minor === null || minor <= 0) {
    return NextResponse.json({ error: "اكتب مبلغاً موجباً بالريال، أو اتركه فارغاً لإزالة الحد" }, { status: 400 });
  }
  await saveCashFloor(minor, user.id);
  return NextResponse.json({ ok: true, message: `حُفظ الحد: ${formatRiyalsDisplay(minor)} ريال` });
}
