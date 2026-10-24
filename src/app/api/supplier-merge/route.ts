/**
 * دمجُ مورّدٍ في آخر وتراجعُه، وحذفُ مورّدٍ بلا مال — للمالك وحده (`supplier:merge`).
 *
 *   POST { action: "preview-merge", sourceId, targetId }   ما ينتقل وما يتعارض و«عليك» قبل وبعد
 *   POST { action: "merge", sourceId, targetId, acceptConflicts }
 *   POST { action: "undo", sourceId }
 *   POST { action: "preview-delete", supplierId }
 *   POST { action: "delete", supplierId }
 *
 * المتصفّحُ يرسل المعرّفات وحدها، والخادمُ يعيد الحساب كلَّه داخل المعاملة
 * (`supplier-merge.service.ts`). والتعارضُ (رقمان ضريبيّان · آيبانان) لا يمنع، لكنّه
 * يلزمه إقرارٌ صريح: من لم يرَه لا يدمج عليه.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { guard, respondTo } from "@/services/guard";
import { readJson } from "@/lib/request-body";
import {
  deleteSupplier, mergeSuppliers, previewDelete, previewMerge, SupplierMergeRefused, undoMerge,
} from "@/services/supplier-merge.service";

export const runtime = "nodejs";

const Id = z.string().trim().min(1).max(64);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview-merge"), sourceId: Id, targetId: Id }).strict(),
  z.object({ action: z.literal("merge"), sourceId: Id, targetId: Id, acceptConflicts: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("undo"), sourceId: Id }).strict(),
  z.object({ action: z.literal("preview-delete"), supplierId: Id }).strict(),
  z.object({ action: z.literal("delete"), supplierId: Id }).strict(),
]);

export async function POST(request: Request) {
  try {
    const user = await guard("supplier-merge", "supplier:merge");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const b = read.body;
    switch (b.action) {
      case "preview-merge":
        return NextResponse.json({ ok: true, preview: await previewMerge(b.sourceId, b.targetId) });
      case "merge": {
        const p = await previewMerge(b.sourceId, b.targetId);
        if (p.conflicts.length > 0 && b.acceptConflicts !== true) {
          return NextResponse.json({ error: "بين المورّدين تعارض لم تُقرّه. راجع المعاينة ثم أكّد.", preview: p }, { status: 409 });
        }
        const out = await mergeSuppliers(b.sourceId, b.targetId, user.id);
        return NextResponse.json({ ok: true, mergeId: out.mergeId, moved: out.moved, targetSlug: p.target.slug, message: `دُمج «${p.source.name}» في «${p.target.name}».` });
      }
      case "undo": {
        const out = await undoMerge(b.sourceId, user.id);
        return NextResponse.json({ ok: true, restored: out.restored, message: "أُعيد المورّد كما كان قبل الدمج." });
      }
      case "preview-delete":
        return NextResponse.json({ ok: true, preview: await previewDelete(b.supplierId) });
      case "delete": {
        const out = await deleteSupplier(b.supplierId, user.id);
        return NextResponse.json({ ok: true, detached: out, message: "حُذف المورّد." });
      }
    }
  } catch (e) {
    if (e instanceof SupplierMergeRefused) return NextResponse.json({ error: e.message, months: e.months }, { status: 409 });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
