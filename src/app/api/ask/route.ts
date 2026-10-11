/**
 * «كم دفعتُ للمراعي في سبتمبر؟» — سؤالٌ بالكلمات من لوحة الأوامر.
 * المحلّلُ حتميّ (`lib/ask.ts`) والرقمُ من القاعدة (`ask.service.ts`)؛ قراءةٌ وحدها،
 * ولمن يرى المبالغ. وما ليس سؤالاً يُردّ «ليس سؤالاً» بلا خطأ.
 */
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import { parseQuestion } from "@/lib/ask";
import { currentMonthRiyadh } from "@/lib/riyadh-time";
import { answerQuestion } from "@/services/ask.service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await guard("ask", "amounts:view");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
  const raw = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 200);
  const question = parseQuestion(raw, currentMonthRiyadh());
  if (!question) return NextResponse.json({ ok: true, answer: null });
  return NextResponse.json({ ok: true, answer: await answerQuestion(question) }, { headers: { "cache-control": "no-store" } });
}
