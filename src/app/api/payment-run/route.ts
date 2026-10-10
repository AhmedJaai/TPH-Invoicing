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
import { applyPartialAmounts, suppliersMissingAccount, toBankTransferCsv } from "@/lib/payment-run";
import { parseRiyals } from "@/lib/money";
import { loadPayeeAccounts } from "@/services/payee-account.service";
import { recordAudit } from "@/lib/audit";
import { loadPaymentRun } from "@/services/payment-run.service";

export const runtime = "nodejs";

const Body = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "شهر غير صالح"),
  /** مورّدون بأعيانهم من الجاهزين — وغيابُه «الكلّ». */
  suppliers: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(500).optional(),
  /** فواتيرُ جاهزةٌ تُستثنى هذه المرّة — معرّفاتٌ وحدها. */
  excludeInvoices: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(500).optional(),
  /** «ادفع كذا فقط» لمورّدٍ بعينه — المبلغُ بالريال نصّاً، ويُفحَص على ما يبنيه الخادم. */
  partial: z.array(z.object({
    supplierId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    amount: z.string().trim().min(1).max(20),
  }).strict()).max(500).optional(),
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
  const full = await loadPaymentRun(month, {
    excludeInvoiceIds: read.body.excludeInvoices ? new Set(read.body.excludeInvoices) : undefined,
  });

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
  const chosen = { ...full, ready, readyTotalMinor: ready.reduce((s, r) => s + r.totalMinor, 0) };

  /*
    المبلغُ الجزئيّ هو الرقمُ الوحيد الذي يأتي من المتصفّح — فيُفهَم هللاتٍ صحيحة
    ويُفحَص على ما بناه الخادمُ للمورّد نفسه. وما لا يصحّ يردّ الطلبَ كلَّه: ملفٌّ
    يُرفع إلى البنك لا يخرج بمبلغٍ قُصّ أو بُدّل بصمت.
  */
  const partialBySupplier = new Map<string, number>();
  for (const p of read.body.partial ?? []) {
    if (only && !only.has(p.supplierId)) continue;
    const minor = parseRiyals(p.amount);
    if (minor === null) {
      return NextResponse.json({ error: "مبلغٌ جزئيّ لا يُقرأ — اكتبه بالريال مثل 1500.00" }, { status: 400 });
    }
    partialBySupplier.set(p.supplierId, minor);
  }
  const applied = applyPartialAmounts(chosen, partialBySupplier);
  if (applied.errors.length > 0) {
    return NextResponse.json({ error: `${applied.errors.join(" · ")} — لم يُنزَّل ملفّ.` }, { status: 409 });
  }
  const run = applied.run;
  const partials = run.ready.filter((s) => s.fullMinor !== undefined);
  const byOwner = run.overridden.filter((o) => run.ready.some((s) => s.invoices.some((i) => i.invoiceId === o.invoice.invoiceId)));

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
      ...(read.body.excludeInvoices?.length ? { "فواتير مستثناة": read.body.excludeInvoices.length } : {}),
      ...(partials.length > 0
        ? { "دفعٌ جزئيّ": partials.map((s) => ({ المورّد: s.supplierName, يُحوَّل_بالهللات: s.totalMinor, من_بالهللات: s.fullMinor })) }
        : {}),
      ...(byOwner.length > 0
        ? { "بقرار المالك وهي محجوزة": byOwner.map((o) => ({ الفاتورة: o.invoice.invoiceNumber, سبب_الحجز: o.reason, سبب_القرار: o.override?.note ?? null })) }
        : {}),
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
