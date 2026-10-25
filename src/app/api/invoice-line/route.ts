import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard, respondTo } from "@/services/guard";
import { correctInvoiceLine, InvoiceCorrectionRefused } from "@/services/invoice-correction.service";
import { MonthClosedError } from "@/services/validation.service";

/**
 * تصحيحُ كمّيّة بندٍ في فاتورةٍ مقيَّدة — والكمّيّةُ وحدها تأتي من المتصفّح، نصّاً.
 * سعرُ الوحدة يشتقّه الخادم من مجموع البند، والمجموعُ لا يتغيّر (`correctInvoiceLine`).
 */
export const runtime = "nodejs";

const Body = z.object({
  lineId: z.string().trim().min(1).max(64),
  /** الفراغُ أو `null` «غير معروفة» */
  quantity: z.string().max(40).nullable(),
}).strict();

export async function POST(request: Request) {
  try {
    const user = await guard("invoice-line", "document:upload");
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة." }, { status: 400 });
    }
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "الطلب غير مفهوم" }, { status: 400 });

    const out = await db.transaction((tx) => correctInvoiceLine(tx, parsed.data, user.id));
    return NextResponse.json({ ok: true, changed: out.changed, qty: out.qty, unitPriceMinor: out.unitPriceMinor });
  } catch (e) {
    if (e instanceof InvoiceCorrectionRefused) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof MonthClosedError) return NextResponse.json({ error: e.message }, { status: 409 });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
