/**
 * دفعةٌ بلا مورّد ولا حركة بنك — تُنسَب إلى مورّد أو يُلغى قيدُها.
 *
 * الطلبُ يُفحَص وقتَ التشغيل (`lib/orphan-payment.ts`) ولا يحمل مبلغاً:
 * المالُ مالُ الدفعة المقيَّدة، والخادمُ يقرؤه.
 */
import { NextResponse } from "next/server";
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

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة." }, { status: 400 });
  }

  const parsed = parseOrphanPaymentRequest(raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const r = await db.transaction((t) => resolveOrphanPayment(t, parsed.request, user.id));
    return NextResponse.json({ ok: true, message: r.message });
  } catch (e) {
    if (e instanceof OrphanPaymentError) return NextResponse.json({ error: e.message }, { status: e.status });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
