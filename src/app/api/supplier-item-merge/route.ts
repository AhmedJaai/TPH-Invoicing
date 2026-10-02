/**
 * «هذا البند هو ذاك الصنف» — يُقرّ إنسانٌ أنّ صيغةَ اسمٍ من المورّد هي صنفٌ آخر عنده.
 *
 * الطلبُ المورّدُ والمفتاحان المطبَّعان (zod)، والخادمُ يتحقّق منهما ويكتب في معاملةٍ
 * واحدة (`supplier-item-merge.service.ts`).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard, respondTo } from "@/services/guard";
import { readJson } from "@/lib/request-body";
import { ItemMergeRefused, mergeSupplierItems } from "@/services/supplier-item-merge.service";

export const runtime = "nodejs";

const Body = z.object({
  supplierId: z.string().trim().min(1).max(64),
  from: z.string().trim().min(1).max(500),
  into: z.string().trim().min(1).max(500),
}).strict();

export async function POST(request: Request) {
  try {
    const user = await guard("supplier-item-merge", "supplier:edit");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const out = await db.transaction((tx) => mergeSupplierItems(tx, read.body, user.id));
    return NextResponse.json({
      ok: true,
      message: out.linesMoved === 1 ? "دُمج — ونُقل بندٌ واحد" : `دُمج — ونُقلت بنودُه (${out.linesMoved})`,
    });
  } catch (e) {
    if (e instanceof ItemMergeRefused) return NextResponse.json({ error: e.message }, { status: e.status });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
