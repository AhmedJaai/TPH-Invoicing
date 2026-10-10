/**
 * قرارُ المالك في محجوزات الدفعة: «أدخلها في الدفعة» أو «أعِدها إلى الحجز».
 *
 * الحجزُ تنبيهٌ لا منع. والخادمُ لا يأخذ إلّا المعرّفاتِ والسببَ المكتوب: حالُ
 * كلّ فاتورةٍ ومبلغُها وضريبتُها المعرّضة تُحسب في `payment-hold.service` داخل
 * المعاملة، والأثرُ يُكتب في سجلّ التدقيق باسم صاحب القرار.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { guard, respondTo } from "@/services/guard";
import { HoldDecisionError, overrideHolds, restoreHolds } from "@/services/payment-hold.service";
import { INVOICE, countNoun } from "@/lib/arabic";
import { formatRiyalsDisplay } from "@/lib/money";

export const runtime = "nodejs";

const Body = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "شهر غير صالح"),
  invoiceIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).min(1, "حدّد الفواتير").max(50),
  action: z.enum(["include", "restore"]),
  /** لِمَ تُدفَع وهي محجوزة — يُحفَظ مع القرار ويُعرَض بجانبه. */
  note: z.string().trim().max(300).optional(),
}).strict();

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("payment-run-hold", "payment:approve");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  const { month, invoiceIds, action } = read.body;

  try {
    if (action === "restore") {
      const numbers = await restoreHolds({ invoiceIds, actorId: user.id, month });
      return NextResponse.json({
        ok: true,
        restored: numbers.length,
        message: numbers.length === 0 ? "لم تكن في الدفعة بقرار — لا شيء تغيّر" : `أُعيدت ${countNoun(numbers.length, INVOICE)} إلى الحجز`,
      });
    }

    const note = read.body.note ?? "";
    if (note.length < 3) {
      return NextResponse.json({ error: "اكتب سبباً — يُحفَظ مع قرارك ويُعرَض بجانبه" }, { status: 400 });
    }
    const out = await overrideHolds({ invoiceIds, note, actorId: user.id, month });
    return NextResponse.json({
      ok: true,
      included: out.invoiceNumbers.length,
      openMinor: out.openMinor,
      vatAtRiskMinor: out.vatAtRiskMinor,
      vatAtRiskUnknown: out.vatAtRiskUnknown,
      message: `دخلت ${countNoun(out.invoiceNumbers.length, INVOICE)} الدفعةَ بقرارك — ${formatRiyalsDisplay(out.openMinor)} ريال`,
    });
  } catch (e) {
    if (e instanceof HoldDecisionError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
