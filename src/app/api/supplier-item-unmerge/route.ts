/**
 * فصلُ صيغةٍ دُمجت خطأً في صنفٍ آخر عند المورّد نفسه — عكسُ `supplier-item-merge`.
 *
 * الطلبُ المورّدُ ومفتاحُ الصيغة (zod)، والخادمُ يجد بنودَها من وصفها المطبوع ويكتب في معاملةٍ واحدة
 * (`unmergeSupplierItem`).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard, respondTo } from "@/services/guard";
import { readJson } from "@/lib/request-body";
import { ItemMergeRefused, unmergeSupplierItem } from "@/services/supplier-item-merge.service";

export const runtime = "nodejs";

const Body = z.object({
  supplierId: z.string().trim().min(1).max(64),
  alias: z.string().trim().min(1).max(500),
}).strict();

export async function POST(request: Request) {
  try {
    const user = await guard("supplier-item-unmerge", "supplier:edit");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const out = await db.transaction((tx) => unmergeSupplierItem(tx, read.body, user.id));
    return NextResponse.json({
      ok: true,
      message: out.linesMoved === 0
        ? `فُصل «${out.displayName}»، ولا بند له الآن`
        : out.linesMoved === 1 ? `فُصل «${out.displayName}»، وعاد إليه بند واحد` : `فُصل «${out.displayName}»، وعادت إليه بنوده (${out.linesMoved})`,
    });
  } catch (e) {
    if (e instanceof ItemMergeRefused) return NextResponse.json({ error: e.message }, { status: e.status });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
