/**
 * «سجّله إشعاراً» — دائنٌ في كشف المورّد بلا إشعار مسجَّل يُقيَّد من سطره.
 *
 * الطلبُ معرّفُ السطر وحده (zod): المبلغُ والتاريخُ والمرجعُ من القاعدة لا من المتصفّح، والخادمُ
 * يعيد المقابلةَ قبل أن يكتب في معاملةٍ واحدة (`statement-credit.service.ts`).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { readJson } from "@/lib/request-body";
import { guard, respondTo } from "@/services/guard";
import { CreditNoteRefused } from "@/services/credit-note.service";
import { recordCreditFromStatementLine } from "@/services/statement-credit.service";
import { MonthClosedError } from "@/services/validation.service";

export const runtime = "nodejs";

const Body = z.object({
  statementLineId: z.string().trim().min(1).max(64),
  /** «إشعارٌ آخر» — بعد ردّ 409 `duplicate`. */
  acknowledgeDuplicate: z.boolean().optional(),
}).strict();

export async function POST(request: Request) {
  try {
    const user = await guard("statement-credit", "payment:approve");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const out = await db.transaction((tx) => recordCreditFromStatementLine(tx, {
      statementLineId: read.body.statementLineId,
      acknowledgeDuplicate: read.body.acknowledgeDuplicate === true,
    }, user.id));
    return NextResponse.json({ ok: true, message: out.message });
  } catch (e) {
    if (e instanceof CreditNoteRefused) {
      return NextResponse.json({ error: e.message, ...(e.duplicate ? { duplicate: true } : {}) }, { status: 409 });
    }
    if (e instanceof MonthClosedError) return NextResponse.json({ error: e.message }, { status: 409 });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
