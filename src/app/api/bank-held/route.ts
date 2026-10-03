/**
 * قرارُ إنسانٍ في صفّ كشفٍ ملتبس أو متضارب — «هي نفسها» · «حركةٌ أخرى» · «تحقّقتُ».
 * (`bank-held.service.ts`)
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard, respondTo } from "@/services/guard";
import { readJson } from "@/lib/request-body";
import { HeldRowRefused, resolveHeldRow } from "@/services/bank-held.service";

export const runtime = "nodejs";

const Body = z.object({
  id: z.string().trim().min(1).max(64),
  decision: z.enum(["SAME", "ADDED", "CHECKED", "REMOVED"]),
});

export async function POST(request: Request) {
  try {
    const user = await guard("bank-held", "bank:edit");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const out = await db.transaction((tx) => resolveHeldRow(tx, read.body.id, read.body.decision, user.id));
    return NextResponse.json({
      ok: true,
      transactionId: out.transactionId,
      message: out.transactionId ? "أُضيفت حركةً — وتنتظر تصنيفها في الطابور"
        : out.removed ? "حُذفت الحركةُ ومصروفُها — ليست في كشف البنك"
        : "حُسم الصفّ — ولن يعود بإعادة الاستيراد",
    });
  } catch (e) {
    if (e instanceof HeldRowRefused) return NextResponse.json({ error: e.message }, { status: 409 });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
