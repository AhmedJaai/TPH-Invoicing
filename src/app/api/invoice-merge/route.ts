/**
 * «نسخة مكرّرة — ادمجها في الأخرى» (`invoice-merge.service.ts`).
 *
 *   POST { action: "preview", invoiceId, twinId }                       ما سيقع، ومنه السدادُ المكرّر بيد
 *   POST { action: "merge", invoiceId, twinId, fileOf, handPayments }   التنفيذ
 *
 * الطلبُ معرّفا الفاتورتين والملفُّ المختار؛ والخادمُ يُبقي الأقدم ويتحقّق أنّهما للمورّد نفسه وبالمبلغ نفسه.
 * و«ألغِ السداد المكرّر» (`handPayments: "void"`) للمالك وحده (`invoice:remove`): يُلغي مالاً مقيَّداً.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard, respondTo } from "@/services/guard";
import { readJson } from "@/lib/request-body";
import { can } from "@/lib/permissions";
import { formatRiyalsDisplay } from "@/lib/money";
import { MergeRefused, mergeDuplicateInvoice, previewMerge } from "@/services/invoice-merge.service";

export const runtime = "nodejs";

const Id = z.string().trim().min(1).max(64);
/* صفحةٌ فُتحت قبل النشر ترسل بلا `action` — فهي «ادمج» كما كانت */
const withAction = (v: unknown) => (v !== null && typeof v === "object" && !("action" in v) ? { ...v, action: "merge" } : v);
const Body = z.preprocess(withAction, z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), invoiceId: Id, twinId: Id }).strict(),
  z.object({
    action: z.literal("merge"),
    invoiceId: Id,
    twinId: Id,
    /** أيُّ الفاتورتين يبقى ملفُّها ورقةً للقيد — والقيدُ الباقي الأقدمُ دائماً */
    fileOf: Id,
    /** سدادُ الساقطة المكرّر بيد: يُلغى أو يبقى رصيداً — والغائبُ يبقى رصيداً */
    handPayments: z.enum(["void", "keep"]).optional(),
  }).strict(),
]));

export async function POST(request: Request) {
  try {
    const user = await guard("invoice-merge", "document:upload");
    if (!can(user.role, "amounts:view")) return NextResponse.json({ error: "دمج الفواتير يحتاج إلى صلاحية عرض المبالغ" }, { status: 403 });
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const canVoid = can(user.role, "invoice:remove");
    const body = read.body;
    if (body.action === "preview") {
      return NextResponse.json({ ok: true, canVoid, ...(await previewMerge(db, body)) });
    }
    if (body.handPayments === "void" && !canVoid) {
      return NextResponse.json({ error: "إلغاء السداد المكرّر للمالك وحده. ادمجهما وأبقِ السداد رصيداً، ويظهر للمالك في «يحتاج قرارك»" }, { status: 403 });
    }
    const out = await db.transaction((tx) => mergeDuplicateInvoice(tx, {
      invoiceId: body.invoiceId, twinId: body.twinId, fileOf: body.fileOf, handPayments: body.handPayments, actorId: user.id,
    }));
    return NextResponse.json({
      ok: true,
      keptId: out.keptId,
      message: `حُذفت ${out.droppedNumber} وبقيت ${out.keptNumber} بسدادها`
        + (out.fileName ? `، وورقتها ${out.fileName}` : "")
        + (out.voidedMinor > 0 ? `، وأُلغي سدادها المكرّر (${formatRiyalsDisplay(out.voidedMinor)}) فلا رصيد وهمي للمورّد` : "")
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
