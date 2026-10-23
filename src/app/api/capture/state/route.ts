/**
 * أيُّ صور الفريق هذه ما زالت تنتظر؟ — تسأله شاشةُ الرفع قبل أن تستعيد مسوّداتها.
 *
 * المسوّدةُ في متصفّح صاحبها (`review-drafts.ts`) لا تعلم أنّ صورتَها اعتُمدت من صفحة صور
 * الفريق («اعتمد المحدَّد») أو من جهازٍ آخر — فكانت تعود «تنتظر مراجعتك» سبعَ عشرةَ بطاقةً
 * لفواتير مؤرشفة، وصورتُها لا تظهر لأنّ بايتاتها تُفرَّغ عند الاعتماد (٢٣ أكتوبر ٢٠٢٦).
 *
 *   POST { ids } → { waiting: [...] } — وما ليس فيها حُسم أو لم يعد موجوداً.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { captures } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { readJson } from "@/lib/request-body";

export const runtime = "nodejs";

const Body = z.object({ ids: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(200) }).strict();

export async function POST(request: Request) {
  try {
    await guard("capture-state", "document:upload");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const ids = [...new Set(read.body.ids)];
    const waiting = ids.length === 0 ? [] : await db.select({ id: captures.id }).from(captures)
      .where(and(inArray(captures.id, ids), eq(captures.status, "PENDING")));
    return NextResponse.json({ waiting: waiting.map((w) => w.id) });
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
