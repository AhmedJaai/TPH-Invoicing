/**
 * ما يُعدّ في إقرار الضريبة — حركاتُ البنك (`tx`) أو الفواتيرُ التي يُقرّ صاحبُها أنّها ضريبيّة
 * (`invoice`): يضمّ أو يُخرج أو يُعيد إلى الأصل.
 *
 * المتصفّحُ يرسل المعرّفات والقرار وحدهما؛ والضريبةُ تُحسب في الخادم عند العرض
 * (`lib/vat-return.ts`)، ولا يُؤخَذ منه مبلغ.
 */
import { z } from "zod";
import { NextResponse } from "next/server";
import { readJson } from "@/lib/request-body";
import { guard, respondTo } from "@/services/guard";
import { chooseVatInvoices, chooseVatTxs, VatChoiceRefused } from "@/services/vat-return.service";

export const runtime = "nodejs";

const Body = z.object({
  kind: z.enum(["tx", "invoice"]).default("tx"),
  ids: z.array(z.string().trim().min(1).max(64)).min(1).max(1000),
  /** `null` يعيدها إلى الأصل */
  included: z.boolean().nullable(),
});

export async function POST(request: Request) {
  let user;
  try {
    /* صلاحيّةُ الصفحة نفسُها: من يصنّف البنك (`bank:edit`) لا يغيّر إقراراً لا يراه */
    user = await guard("vat-choice", "month:close");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const read = await readJson(request, Body);
  if (!read.ok) return read.response;

  try {
    const { kind, ids, included } = read.body;
    const n = kind === "invoice"
      ? await chooseVatInvoices(ids, included, user.id)
      : await chooseVatTxs(ids, included, user.id);
    return NextResponse.json({ ok: true, count: n });
  } catch (e) {
    if (e instanceof VatChoiceRefused) return NextResponse.json({ error: e.message }, { status: 409 });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
