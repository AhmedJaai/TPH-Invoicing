/**
 * يصدّر دفعة الشهر ملفَّ تحويلات جماعية للبنك.
 *
 * **POST لا GET**: التصديرُ يكتب في سجلّ التدقيق، ورابطُ `<a download>` يجلبه
 * المتصفّحُ أو إضافةٌ مسبقاً فيُكتب «صُدّرت الدفعة» ولم يُصدَّر شيء. واسمُ
 * الملفّ يحمل لحظةَ تصديره — نسختان من الشهر نفسه لا تختلطان.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { todayInRiyadh } from "@/lib/riyadh-time";
import { guard, respondTo } from "@/services/guard";
import { suppliersMissingAccount, toBankTransferCsv } from "@/lib/payment-run";
import { loadPayeeAccounts } from "@/services/payee-account.service";
import { recordAudit } from "@/lib/audit";
import { loadPaymentRun } from "@/services/payment-run.service";

export const runtime = "nodejs";

const Body = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "شهر غير صالح"),
  /** مورّدون بأعيانهم من الجاهزين — وغيابُه «الكلّ». */
  suppliers: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(500).optional(),
}).strict();

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("payment-run", "payment:approve");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  const { month } = read.body;

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
  const only = read.body.suppliers ? new Set(read.body.suppliers) : null;
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
      "بلا حسابٍ معروف": suppliersMissingAccount(run, accounts).map((s) => s.supplierName),
      ...(only ? { "اختيارٌ من الجاهزين": `${run.ready.length} من ${full.ready.length}` } : {}),
    },
  });

  /* يومُ التصدير وساعتُه بتوقيت الرياض: «2026-10-07_1432» */
  const now = new Date();
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(now).replace(":", "");
  const stamp = `${todayInRiyadh(now)}_${clock}`;

  return new NextResponse(toBankTransferCsv(run, accounts), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="payment-run-${month}_${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
