/**
 * القراءةُ الذكيّة لشهر — تُطلَب بزرّ ولا تُولَّد عند فتح الصفحة.
 *
 * النموذجُ (DeepSeek وحده) يُعطى أرقاماً حسبها الخادم ويكتب عنها؛ ثمّ يُتحقَّق أنّ كلَّ
 * رقمٍ ذكره ممّا أُعطي، ويُحفَظ الناتجُ بمدخلاته. والمسارُ يعلن عمرَه: الوقوفُ بمهلةٍ
 * معلَنة خيرٌ من قتلٍ صامت — والصفحةُ كاملةٌ بأرقامها إن فشل.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withDeadline } from "@/lib/ai/deadline";
import { readJson } from "@/lib/request-body";
import { generateReading } from "@/services/finance-reading.service";
import { guard, respondTo } from "@/services/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict();

export async function POST(request: Request) {
  try {
    /* يكتب قراءةً ويصرف من رصيد الذكاء — فبصلاحيّة كتابة لا بصلاحيّة النظر */
    const user = await guard("finance-reading", "month:close");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const month = read.body.month;
    const outcome = await withDeadline(55_000, () => generateReading(month, user.id, 40_000));
    if (!outcome.ok) return NextResponse.json({ error: outcome.reason }, { status: outcome.status });
    const { reading } = outcome.stored;
    return NextResponse.json({
      ok: true,
      message: reading.dropped > 0 ? `كُتبت القراءة، وحُذفت منها ${reading.dropped} جملة فيها رقم لم يحسبه النظام` : "كُتبت القراءة",
    });
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
