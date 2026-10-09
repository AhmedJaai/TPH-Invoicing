/**
 * دفعةٌ بلا مورّد ولا حركة بنك — تُنسَب إلى مورّد أو يُلغى قيدُها.
 *
 * الطلبُ يُفحَص وقتَ التشغيل (`lib/orphan-payment.ts`) ولا يحمل مبلغاً:
 * المالُ مالُ الدفعة المقيَّدة، والخادمُ يقرؤه.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { db } from "@/db";
import { guard, respondTo } from "@/services/guard";
import { parseOrphanPaymentRequest } from "@/lib/orphan-payment";
import { OrphanPaymentError, resolveOrphanPayment } from "@/services/orphan-payment.service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("payment-orphan", "payment:approve");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  /* القراءةُ بـ`readJson` كبقيّة المسارات؛ والفحصُ الدقيق برسائله في `parseOrphanPaymentRequest` */
  const read = await readJson(request, z.unknown());
  if (!read.ok) return read.response;
  const parsed = parseOrphanPaymentRequest(read.body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const r = await db.transaction((t) => resolveOrphanPayment(t, parsed.request, user.id));
    return NextResponse.json({ ok: true, message: r.message });
  } catch (e) {
    if (e instanceof OrphanPaymentError) {
      return NextResponse.json({ error: e.message, ...(e.twin ? { twin: true } : {}) }, { status: e.status });
    }
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
