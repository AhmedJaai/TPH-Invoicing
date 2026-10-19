/**
 * إقرارُ المالك عمّا لا يراه الكشف — إيجارٌ يغطّي أشهراً، راتبٌ نقداً، أو «لا يوجد».
 *
 * طبقةُ قراءةٍ فوق الدفاتر: لا يُنشأ مصروفٌ ولا دفعة، ولا يُعاد نسبُ مال. ومبلغُ التوزيع
 * يُقرأ من حركة البنك في القاعدة لا من المتصفّح. والسحبُ لا يحذف.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { isTxCategory } from "@/lib/bank/rules";
import { parseRiyals } from "@/lib/money";
import { readJson } from "@/lib/request-body";
import { guard, respondTo } from "@/services/guard";
import { createDeclaration, DeclarationRefused, voidDeclaration } from "@/services/profit.service";

export const runtime = "nodejs";

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "اكتب الشهر بصيغة YYYY-MM، مثل 2026-08");
const Create = z.object({
  action: z.literal("create"),
  kind: z.enum(["SPREAD", "OFF_BOOK", "NONE"]),
  category: z.string().refine(isTxCategory, "فئة غير معروفة"),
  label: z.string().trim().min(2, "اكتب وصفاً قصيراً").max(120),
  /** المبلغُ نصّاً بالريال — يُقرأ هللاتٍ في الخادم. */
  amount: z.string().trim().max(20).optional(),
  fromMonth: Month,
  toMonth: Month,
  bankTransactionId: z.string().trim().min(1).max(64).nullable().optional(),
  note: z.string().trim().max(300).optional(),
}).strict();
const Void = z.object({ action: z.literal("void"), id: z.string().trim().min(1).max(64) }).strict();
const Body = z.discriminatedUnion("action", [Create, Void]);

export async function POST(request: Request) {
  try {
    const user = await guard("finance-declaration", "month:close");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const body = read.body;
    if (body.action === "void") {
      const done = await voidDeclaration(body.id, user.id);
      return NextResponse.json({ ok: true, message: done ? "سُحب ما أضفته، وعاد الشهر إلى ما في كشف البنك" : "سُحب من قبل" });
    }
    if (!isTxCategory(body.category)) return NextResponse.json({ error: "فئة غير معروفة" }, { status: 400 });
    let amountMinor = 0;
    if (body.kind === "OFF_BOOK") {
      const parsed = parseRiyals(body.amount ?? "");
      if (parsed === null || parsed <= 0) return NextResponse.json({ error: "اكتب مبلغ الشهر رقماً أكبر من صفر." }, { status: 400 });
      amountMinor = parsed;
    }
    await createDeclaration({
      kind: body.kind, category: body.category, label: body.label, amountMinor,
      fromMonth: body.fromMonth, toMonth: body.toMonth,
      bankTransactionId: body.bankTransactionId ?? null, note: body.note ?? null,
    }, user.id);
    return NextResponse.json({ ok: true, message: "حُفظ ما أضفته، ويظهر في قائمة الدخل باسمه" });
  } catch (e) {
    if (e instanceof DeclarationRefused) return NextResponse.json({ error: e.message }, { status: 409 });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
