/**
 * «نسخة مكرّرة — ادمجها في الأخرى» (`invoice-merge.service.ts`).
 * الطلبُ معرّفا الفاتورتين والملفُّ المختار؛ والخادمُ يُبقي الأقدم ويتحقّق أنّهما للمورّد نفسه وبالمبلغ نفسه.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard, respondTo } from "@/services/guard";
import { readJson } from "@/lib/request-body";
import { can } from "@/lib/permissions";
import { formatRiyalsDisplay } from "@/lib/money";
import { MergeRefused, mergeDuplicateInvoice } from "@/services/invoice-merge.service";

export const runtime = "nodejs";

const Body = z.object({
  invoiceId: z.string().trim().min(1).max(64),
  twinId: z.string().trim().min(1).max(64),
  /** أيُّ الفاتورتين يبقى ملفُّها ورقةً للقيد — والقيدُ الباقي الأقدمُ دائماً */
  fileOf: z.string().trim().min(1).max(64),
}).strict();

export async function POST(request: Request) {
  try {
    const user = await guard("invoice-merge", "document:upload");
    if (!can(user.role, "amounts:view")) return NextResponse.json({ error: "دمج الفواتير يحتاج إلى صلاحية عرض المبالغ" }, { status: 403 });
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const out = await db.transaction((tx) => mergeDuplicateInvoice(tx, { ...read.body, actorId: user.id }));
    return NextResponse.json({
      ok: true,
      keptId: out.keptId,
      message: `حُذفت ${out.droppedNumber} وبقيت ${out.keptNumber} بسدادها`
        + (out.fileName ? `، وورقتها ${out.fileName}` : "")
        + (out.releasedMinor > 0 ? `، وعاد ما خُصّص لها (${formatRiyalsDisplay(out.releasedMinor)}) رصيداً للمورّد` : "")
        + (out.reappliedMinor > 0 ? ` ثم وُزّع منه ${formatRiyalsDisplay(out.reappliedMinor)} على أقدم المفتوح` : ""),
    });
  } catch (e) {
    if (e instanceof MergeRefused) return NextResponse.json({ error: e.message }, { status: e.status });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
