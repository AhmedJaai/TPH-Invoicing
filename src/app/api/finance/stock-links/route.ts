import { ITEM, countNoun } from "@/lib/arabic";
/**
 * إقرارُ اقتراحات ربط بنود الفواتير بأصناف المخزون — ما أيّده فودكس بشاهدَين فأكثر.
 *
 * الطلبُ معرّفاتٌ وحدها. الخادمُ يعيد اشتقاقَ كلّ اقتراحٍ الآن ويكتبه بـ`savePurchaseLink`
 * نفسِها (التدقيقُ فيها)، وما لم يعد جاهزاً يُتخطّى ويُعدّ. لا مالَ يُكتب: الربطُ يحدّد
 * أيَّ بنود الفواتير تُحسَب مشترياتٍ لأيّ صنف.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { formatRiyalsDisplay } from "@/lib/money";
import { readJson } from "@/lib/request-body";
import { guard, respondTo } from "@/services/guard";
import { approveReadyLinks } from "@/services/stock-link.service";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ ids: z.array(z.string().trim().min(1).max(64)).min(1).max(100) }).strict();

export async function POST(request: Request) {
  try {
    const user = await guard("finance-stock-links", "inventory:count");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const done = await approveReadyLinks(read.body.ids, user.id);
    if (done.linked === 0) return NextResponse.json({ error: "لم يُربط أي بند، لأن الاقتراحات تغيّرت. حدّث الصفحة." }, { status: 409 });
    return NextResponse.json({
      ok: true,
      message: `رُبط ${countNoun(done.linked, ITEM)} بقيمة ${formatRiyalsDisplay(done.valueMinor)} ريال${done.skipped > 0 ? `، وتُخطّي ${countNoun(done.skipped, ITEM)} لأن اقتراحه تغيّر` : ""}`,
    });
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
