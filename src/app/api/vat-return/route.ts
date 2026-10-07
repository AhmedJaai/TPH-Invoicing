/**
 * ما يكتبه صاحبُ المقهى في إقرار الضريبة غيرَ الاختيار: مبيعاتُ النقد غير المودَع (`cash`)،
 * وتسجيلُ أنّ الإقرار قُدِّم (`file`)، والتراجعُ عن التسجيل (`void`).
 *
 * المتصفّحُ يرسل الفترة وما كُتب بيد؛ وأرقامُ الإقرار تُحسب في الخادم لحظةَ الحفظ
 * (`fileVatReturn`)، ولا يُؤخَذ منه رقمٌ محسوب. والنقدُ يصل نصّاً ويُحوَّل هللاتٍ هنا.
 */
import { z } from "zod";
import { NextResponse } from "next/server";
import { readJson } from "@/lib/request-body";
import { parseRiyals } from "@/lib/money";
import { guard, respondTo } from "@/services/guard";
import { fileVatReturn, setVatCashSales, VatChoiceRefused, voidVatFiling } from "@/services/vat-return.service";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("cash"),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    /** المبلغُ شاملَ الضريبة نصّاً — `null` أو فارغٌ يمحوه («لم يُكتب») */
    amount: z.string().trim().max(32).nullable(),
  }),
  z.object({
    action: z.literal("file"),
    period: z.string().regex(/^\d{4}-Q[1-4]$/),
    filedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reference: z.string().trim().max(64).nullable(),
    creditDisposition: z.enum(["CARRY", "REFUND"]).nullable(),
  }),
  z.object({
    action: z.literal("void"),
    period: z.string().regex(/^\d{4}-Q[1-4]$/),
    reason: z.string().trim().min(3, "اكتب سببَ التراجع").max(300),
  }),
]);

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("vat-return", "month:close");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  const body = read.body;

  try {
    if (body.action === "cash") {
      const raw = body.amount ?? "";
      const minor = raw === "" ? null : parseRiyals(raw);
      if (raw !== "" && (minor === null || minor < 0)) {
        return NextResponse.json({ error: "مبلغُ النقد لم يُقرأ — اكتبه رقماً مثل 1250.50" }, { status: 400 });
      }
      await setVatCashSales(body.month, minor, user.id);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "file") {
      const filing = await fileVatReturn({
        periodKey: body.period, filedOn: body.filedOn, reference: body.reference || null,
        creditDisposition: body.creditDisposition,
      }, user.id);
      return NextResponse.json({ ok: true, filing });
    }
    await voidVatFiling(body.period, body.reason, user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof VatChoiceRefused) return NextResponse.json({ error: e.message }, { status: 409 });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
