/**
 * تجميدُ قائمة دخل شهرٍ مقفل كما تُحسَب الآن — التقريرُ يُقرأ بعدها من لقطته.
 * وإعادةُ التجميد قرارٌ يُكتب في سجلّ التدقيق بالرقمين.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { guard, respondTo } from "@/services/guard";
import { freezePnl, FreezeRefused } from "@/services/profit.service";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict();

export async function POST(request: Request) {
  try {
    const user = await guard("finance-freeze", "month:close");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    await freezePnl(read.body.month, user.id);
    return NextResponse.json({ ok: true, message: "جمّد تقرير الشهر كما هو الآن" });
  } catch (e) {
    if (e instanceof FreezeRefused) return NextResponse.json({ error: e.message }, { status: 409 });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
