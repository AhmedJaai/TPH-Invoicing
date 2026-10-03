/**
 * «فاتورةٌ مصحَّحة — تحلّ محلّ المقيَّدة» (`invoice-replace.service.ts`).
 * الطلبُ معرّفُ المستند الجديد وحده؛ والخادمُ يقرأ قراءتَه ويجد القديمةَ برقمها.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard, respondTo } from "@/services/guard";
import { readJson } from "@/lib/request-body";
import { can } from "@/lib/permissions";
import { formatRiyalsDisplay } from "@/lib/money";
import { ReplaceRefused, replaceWithCorrectedInvoice } from "@/services/invoice-replace.service";
import { renameArchived } from "@/services/drive-rename.service";
import { refreshTokenFor } from "@/services/drive.service";
import { driveForUser } from "@/lib/drive";
import { driveWritesAllowed } from "@/lib/drive-readonly";

export const runtime = "nodejs";

const Body = z.object({ documentId: z.string().trim().min(1).max(64) }).strict();

export async function POST(request: Request) {
  try {
    const user = await guard("invoice-replace", "document:upload");
    if (!can(user.role, "amounts:view")) return NextResponse.json({ error: "الاستبدالُ يحتاج صلاحية عرض المبالغ" }, { status: 403 });
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const out = await db.transaction((tx) => replaceWithCorrectedInvoice(tx, read.body.documentId, user.id));

    /* الملفُّ الجديد يُسمّى بالصيغة كما يُسمّى ما يُعتمد — وإن تعذّر بقي واقتُرح في شاشة التسمية */
    let renamedTo: string | null = null;
    if (out.driveFileId && driveWritesAllowed(process.env)) {
      try {
        const token = await refreshTokenFor(user.id);
        if (token) renamedTo = (await renameArchived(driveForUser(token), [out.driveFileId], user.id, "فاتورةٌ مصحَّحة")).done[0]?.to ?? null;
      } catch (e) {
        console.warn("[invoice-replace] تعذّرت التسمية:", (e as Error).message);
      }
    }
    return NextResponse.json({
      ok: true,
      invoiceId: out.invoiceId,
      message: `حلّت محلّ ${out.invoiceNumber}: ${formatRiyalsDisplay(out.beforeMinor)} ← ${formatRiyalsDisplay(out.afterMinor)}`
        + (out.releasedMinor > 0 ? ` — وعاد ${formatRiyalsDisplay(out.releasedMinor)} رصيداً للمورّد` : "")
        + (renamedTo ? ` · سُمّي ${renamedTo}` : ""),
    });
  } catch (e) {
    if (e instanceof ReplaceRefused) return NextResponse.json({ error: e.message }, { status: e.status });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
