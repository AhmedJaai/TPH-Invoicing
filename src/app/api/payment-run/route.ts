/** يصدّر دفعة الشهر ملفَّ تحويلات جماعية للبنك. */
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import { toBankTransferCsv } from "@/lib/payment-run";
import { loadPayeeAccounts } from "@/services/payee-account.service";
import { recordAudit } from "@/lib/audit";
import { loadPaymentRun } from "@/services/payment-run.service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  let user;
  try {
    user = await guard("payment-run", "payment:approve");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "شهر غير صالح" }, { status: 400 });
  }

  /*
    الملفّ يطابق الصفحة: البناءُ نفسُه من `payment-run.service` — رصيدٌ لنا
    عند المورّد يُخصم، والمتأخّر يُدرج. كان الاستعلامُ منسوخاً هنا فافترق.
  */
  const full = await loadPaymentRun(month);

  /*
    ما اختاره صاحبُ الدفعة وحده — مورّدون بأعيانهم من الجاهزين. والخادمُ لا
    يأخذ من المتصفّح إلّا المعرّفات: المبالغُ من البناء نفسه، وما ليس في
    «الجاهز» يُتجاهَل فلا يُحوَّل لمحجوزٍ أو مغطّى.
  */
  const picked = new URL(request.url).searchParams.get("suppliers");
  const only = picked ? new Set(picked.split(",").filter((x) => /^[A-Za-z0-9_-]{1,64}$/.test(x))) : null;
  const ready = only ? full.ready.filter((r) => only.has(r.supplierId)) : full.ready;
  if (ready.length === 0) {
    return NextResponse.json({ error: "لا مورّد جاهزاً في ما اخترته — حدّث الصفحة." }, { status: 400 });
  }
  const run = { ...full, ready, readyTotalMinor: ready.reduce((s, r) => s + r.totalMinor, 0) };

  const accounts = await loadPayeeAccounts(run.ready.map((r) => r.supplierId));

  /* ملفٌّ يُرفع إلى البنك فيُحوَّل به مال — تنزيلُه أثرٌ لا يُترك بلا قيد */
  await recordAudit({
    actorId: user.id,
    action: "PAYMENT_RUN_EXPORTED",
    entityType: "payment_run",
    entityId: month,
    after: {
      الشهر: month,
      "جاهز بالهللات": run.readyTotalMinor,
      "محجوز بالهللات": run.heldTotalMinor,
      مورّدون: run.ready.length,
      ...(only ? { "اختيارٌ من الجاهزين": `${run.ready.length} من ${full.ready.length}` } : {}),
    },
  });

  return new NextResponse(toBankTransferCsv(run, accounts), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="payment-run-${month}.csv"`,
    },
  });
}
