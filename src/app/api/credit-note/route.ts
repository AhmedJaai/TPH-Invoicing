/**
 * يُقيَّد إشعارٌ دائن على فاتورة — مرتجعٌ أو خصمٌ من المورّد.
 *
 * الطلبُ معرّفُ الفاتورة والمبلغُ نصّاً (zod)، والخادمُ يحسب ما بقي عليها ويرفض
 * ما يتجاوزه، ويكتب في معاملةٍ واحدة (`credit-note.service.ts`).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { db } from "@/db";
import { guard, respondTo } from "@/services/guard";
import { CreditNoteRefused, recordCreditNote } from "@/services/credit-note.service";
import { MonthClosedError } from "@/services/validation.service";
import { formatRiyalsDisplay, parseRiyals } from "@/lib/money";

export const runtime = "nodejs";

const Body = z.object({
  invoiceId: z.string().trim().min(1).max(64),
  amount: z.string().trim().min(1).max(20),
  issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ بصيغة YYYY-MM-DD"),
  reference: z.string().trim().max(60).optional(),
  reason: z.string().trim().max(200).optional(),
  /** «إشعارٌ آخر» — بعد ردّ 409 `duplicate`. */
  acknowledgeDuplicate: z.boolean().optional(),
}).strict();

export async function POST(request: Request) {
  try {
    const user = await guard("credit-note", "payment:approve");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const parsed = { data: read.body };
    const amountMinor = parseRiyals(parsed.data.amount);
    if (amountMinor === null || amountMinor <= 0) {
      return NextResponse.json({ error: "مبلغُ الإشعار لم يُفهم — اكتبه رقماً بالريال" }, { status: 400 });
    }

    const out = await db.transaction((tx) => recordCreditNote(tx, {
      invoiceId: parsed.data.invoiceId,
      amountMinor,
      issuedOn: parsed.data.issuedOn,
      reference: parsed.data.reference || null,
      reason: parsed.data.reason || null,
      acknowledgeDuplicate: parsed.data.acknowledgeDuplicate === true,
    }, user.id));
    return NextResponse.json({
      ok: true,
      message: out.remainingMinor > 0
        ? `قُيِّد الإشعار — بقي على الفاتورة ${formatRiyalsDisplay(out.remainingMinor)}`
        : "قُيِّد الإشعار — والفاتورةُ مسوّاةٌ كلُّها",
    });
  } catch (e) {
    if (e instanceof CreditNoteRefused) {
      return NextResponse.json({ error: e.message, ...(e.duplicate ? { duplicate: true } : {}) }, { status: 409 });
    }
    if (e instanceof MonthClosedError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
