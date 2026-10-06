/**
 * أيُّ حركات البنك تُعدّ في إقرار الضريبة — يضمّ أو يُخرج أو يُعيد إلى الأصل.
 *
 * المتصفّحُ يرسل المعرّفات والقرار وحدهما؛ والضريبةُ تُحسب في الخادم عند العرض
 * (`lib/vat-return.ts`)، ولا يُؤخَذ منه مبلغ.
 */
import { z } from "zod";
import { NextResponse } from "next/server";
import { readJson } from "@/lib/request-body";
import { guard, respondTo } from "@/services/guard";
import { chooseVatTxs, VatChoiceRefused } from "@/services/vat-return.service";

export const runtime = "nodejs";

const Body = z.object({
  ids: z.array(z.string().trim().min(1).max(64)).min(1).max(1000),
  /** `null` يعيدها إلى الأصل */
  included: z.boolean().nullable(),
});

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("vat-choice", "bank:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const read = await readJson(request, Body);
  if (!read.ok) return read.response;

  try {
    const n = await chooseVatTxs(read.body.ids, read.body.included, user.id);
    return NextResponse.json({ ok: true, count: n });
  } catch (e) {
    if (e instanceof VatChoiceRefused) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
