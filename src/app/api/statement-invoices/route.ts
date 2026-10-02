/**
 * «قيّد الناقصة من الكشف» — فواتيرُ يذكرها كشفُ المورّد ولا ملفَّ لها.
 * الطلبُ معرّفُ الكشف وحده (zod)، والخادمُ يقرأ أسطرَه ويقيّد في معاملةٍ واحدة.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard, respondTo } from "@/services/guard";
import { readJson } from "@/lib/request-body";
import { formatRiyalsDisplay } from "@/lib/money";
import { recordStatementOnlyInvoices, StatementInvoicesRefused } from "@/services/statement-invoices.service";
import { MonthClosedError } from "@/services/validation.service";

export const runtime = "nodejs";

const Body = z.object({ statementId: z.string().trim().min(1).max(64) }).strict();

export async function POST(request: Request) {
  try {
    const user = await guard("statement-invoices", "payment:approve");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const out = await db.transaction((tx) => recordStatementOnlyInvoices(tx, read.body.statementId, user.id));
    const total = out.created.reduce((s, c) => s + c.amountMinor, 0);
    const parts = [
      out.created.length > 0 ? `قُيِّدت ${out.created.length} فاتورة من الكشف بـ${formatRiyalsDisplay(total)} — لا تُخصم ضريبتُها حتى يصل ملفُّها` : "لا فاتورةَ ناقصة تُقيَّد",
      out.closedMonth.length > 0 ? `و${out.closedMonth.length} في شهرٍ مقفل لم تُقيَّد (${[...new Set(out.closedMonth.map((c) => c.month))].join("، ")}) — افتحه أوّلاً` : null,
    ].filter(Boolean);
    return NextResponse.json({ ok: true, created: out.created.length, message: parts.join(". ") });
  } catch (e) {
    if (e instanceof StatementInvoicesRefused) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof MonthClosedError) return NextResponse.json({ error: e.message }, { status: 409 });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
