/**
 * الكوب الذهبي (١١ أكتوبر ٢٠٢٦، بإذن أحمد): تخصيصٌ مقلوب بين ثلاث فواتير.
 *
 *   فاتورةُ مايو INV263287 (‏١٣٬٥٠٦٫٧٥) دفعها أحمد **من حسابه الشخصيّ**، وحوالةُ ‏١٥٢٫٣٧ في ١٨ مايو
 *   تكملةٌ لها. وحوالاتُ البنك بعدها لفاتورتَي يوليو وسبتمبر — مبالغُها تطابقهما بالهللة:
 *     ‏٧٬٥٠٠ + ‏٤٬٥٠٣٫١٣ = ‏١٢٬٠٠٣٫١٣ (يوليو INV264916)
 *     ‏١٬١٥٠ + ‏٢٠١٫٢٥   = ‏١٬٣٥١٫٢٥  (سبتمبر INV266278)
 *
 *   وكان في القيد: الحوالاتُ كلُّها على مايو (بالأقدم أوّلاً — وفاتورةُ سبتمبر لم تكن إلّا
 *   مبدئيّةً في الدرايف فلم تُقيَّد)، والدفعُ الشخصيّ ‏١٢٬٠٠٣٫١٣ على يوليو، وسبتمبر مفتوحة.
 *
 *   فيُلغى الدفعُ الشخصيّ على يوليو (VOID بسببه — لا يُحذف)، وتُنقَل الحوالاتُ الأربع إلى
 *   فاتورتَيها، ويُقيَّد دفعٌ شخصيّ على مايو بما بقي منها (‏١٣٬٣٥٤٫٣٨). ومايو ويوليو وأغسطس
 *   تُفتح ثمّ تُقفل. كلُّه في معاملةٍ واحدة، وإعادتُه لا تغيّر شيئاً.
 *
 *   npx tsx --env-file=.env scripts/repair-2026-10-11.ts [--i-know-this-is-production]
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices, monthCloses, paymentAllocations, payments } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { allocate, createPayment, refreshPaymentStatus, reversePayment } from "@/services/payment.service";
import { writeAllowed } from "./lib/guard-write";

const WRITE = writeAllowed();
const AHMED = "04c5e101-08a2-434e-8817-b6c3f518ad2c";
const SUPPLIER = "2deb73e4-69a3-4a0c-bccb-9fdaa49e4a34";
const MAY = "edceb3c7-18d0-43b1-9832-b52b75c22a8f";
const JULY = "2341c1ea-fe1d-429a-902f-d556694fcd4b";
const SEPTEMBER = "341d44ab-2e40-4f4d-9756-097f656022d4";
const OLD_OWNER_PAYMENT = "66632514-0c30-4bdf-8eb9-5ca65f5af8fe";
const TOP_UP = "c1f48658-0b89-4ce8-8be9-b2641d5bb349";
/** الحوالةُ ← الفاتورةُ التي لها، وشهرُها. */
const MOVES = [
  { paymentId: "243a00c7-e9f1-48b0-8f18-048a4ea1c438", invoiceId: JULY, month: "2026-07", amountMinor: 750_000 },
  { paymentId: "9019fc0a-a182-45da-b199-012e0229862c", invoiceId: JULY, month: "2026-07", amountMinor: 450_313 },
  { paymentId: "21300f11-aaa3-401d-a54c-794c2bc4c8c4", invoiceId: SEPTEMBER, month: "2026-09", amountMinor: 115_000 },
  { paymentId: "37b066ee-b239-4bd5-82df-60627055fb6a", invoiceId: SEPTEMBER, month: "2026-09", amountMinor: 20_125 },
] as const;
const MONTHS = ["2026-05", "2026-07", "2026-08"];
const WHY = "الكوب الذهبي: فاتورةُ مايو دُفعت من الحساب الشخصيّ، وحوالاتُ البنك لفاتورتَي يوليو وسبتمبر — صُحِّح التخصيص بإذن أحمد (١١ أكتوبر ٢٠٢٦)، نفّذه Claude";

async function state(label: string) {
  const rows = (await db.execute<{ number: string; total: number; paid: string; parts: string | null }>(sql`
    select i.invoice_number as number, i.total_minor as total,
           coalesce(sum(pa.amount_minor), 0)::bigint as paid,
           string_agg(p.method::text || ' ' || pa.amount_minor::text, ' + ' order by p.paid_at) as parts
      from invoices i
      left join payment_allocations pa on pa.invoice_id = i.id
      left join payments p on p.id = pa.payment_id
     where i.supplier_id = ${SUPPLIER}
     group by i.id, i.invoice_number, i.total_minor, i.invoice_date
     order by i.invoice_date
  `)).rows;
  console.log(`\n${label}`);
  for (const r of rows) console.log(`  ${r.number}  إجمالي ${Number(r.total) / 100}  مخصَّص ${Number(r.paid) / 100}  ← ${r.parts ?? "لا شيء"}`);
  return rows;
}

async function main() {
  console.log(WRITE ? "— كتابة —" : "— معاينة (لا تُكتب) —");
  await state("قبل:");

  const [old] = await db.select({ status: payments.status }).from(payments).where(eq(payments.id, OLD_OWNER_PAYMENT));
  const [may] = await db.select({ total: invoices.totalMinor, date: invoices.invoiceDate }).from(invoices).where(eq(invoices.id, MAY));
  const [topUp] = await db.select({ amount: paymentAllocations.amountMinor }).from(paymentAllocations)
    .where(and(eq(paymentAllocations.paymentId, TOP_UP), eq(paymentAllocations.invoiceId, MAY)));
  if (!old || !may || !topUp) throw new Error("لم تُوجد الدفعةُ أو الفاتورةُ أو التكملة — لا يُكتب شيء");
  const ownerMinor = may.total - topUp.amount;

  if (old.status === "VOID") {
    console.log("\nصُحِّح من قبل — لا شيء يُفعل.");
    process.exit(0);
  }
  console.log(`\nالخطّة: يُلغى الدفعُ الشخصيّ على يوليو · تُنقَل ${MOVES.length} حوالات · يُقيَّد دفعٌ شخصيّ على مايو ${ownerMinor / 100}`);
  if (!WRITE) process.exit(0);

  const closed = await db.select().from(monthCloses).where(and(inArray(monthCloses.month, MONTHS), eq(monthCloses.status, "CLOSED")));
  for (const c of closed) {
    await db.update(monthCloses).set({ status: "OPEN", closedAt: null, closedById: null }).where(eq(monthCloses.id, c.id));
    await recordAudit({ actorId: AHMED, action: "MONTH_REOPENED", entityType: "month_close", entityId: c.month, before: { الحالة: "CLOSED" }, after: { الحالة: "OPEN", السبب: WHY } });
  }

  try {
    await db.transaction(async (t) => {
      /* ١. الدفعُ الشخصيّ على يوليو: يُلغى بسببه ويبقى أثراً */
      const voided = await reversePayment(t, { paymentId: OLD_OWNER_PAYMENT, kind: "VOID", reason: WHY, userId: AHMED });
      await recordAudit({ actorId: AHMED, action: "PAYMENT_VOIDED", entityType: "payment", entityId: OLD_OWNER_PAYMENT,
        before: { الحال: old.status, "كان مخصَّصاً على": voided.previousAllocations }, after: { الحال: "VOID", السبب: WHY } }, t);

      /* ٢. الحوالاتُ الأربع: تُفَكّ عن مايو وتُخصَّص على فاتورتها */
      for (const m of MOVES) {
        const removed = await t.delete(paymentAllocations)
          .where(and(eq(paymentAllocations.paymentId, m.paymentId), eq(paymentAllocations.invoiceId, MAY)))
          .returning({ amountMinor: paymentAllocations.amountMinor });
        if (removed.length !== 1 || removed[0].amountMinor !== m.amountMinor) {
          throw new Error(`الحوالة ${m.paymentId}: تخصيصُها على مايو ليس ${m.amountMinor} كما في الخطّة — تُلغى المعاملةُ كلُّها`);
        }
        await t.update(payments).set({ appliesToMonth: m.month }).where(eq(payments.id, m.paymentId));
        const out = await allocate(t, m.paymentId, [{ invoiceId: m.invoiceId, amountMinor: m.amountMinor }]);
        if (out.allocatedMinor !== m.amountMinor) throw new Error(`الحوالة ${m.paymentId}: خُصِّص ${out.allocatedMinor} لا ${m.amountMinor} — تُلغى المعاملةُ كلُّها`);
        await refreshPaymentStatus(t, m.paymentId);
        await recordAudit({ actorId: AHMED, action: "PAYMENT_REALLOCATED", entityType: "payment", entityId: m.paymentId,
          before: { الفاتورة: MAY, المبلغ: m.amountMinor }, after: { الفاتورة: m.invoiceId, المبلغ: m.amountMinor, السبب: WHY } }, t);
      }

      /* ٣. مايو: ما بقي منها بعد التكملة دُفع من الحساب الشخصيّ */
      const ownerPaymentId = await createPayment(t, {
        supplierId: SUPPLIER, paidAt: new Date(may.date), amountMinor: ownerMinor,
        method: "OWNER_ACCOUNT", appliesToMonth: "2026-05", acknowledgeTwin: true,
      });
      const applied = await allocate(t, ownerPaymentId, [{ invoiceId: MAY, amountMinor: ownerMinor }]);
      if (applied.allocatedMinor !== ownerMinor) throw new Error(`دفعُ المالك: خُصِّص ${applied.allocatedMinor} لا ${ownerMinor} — تُلغى المعاملةُ كلُّها`);
      await recordAudit({ actorId: AHMED, action: "INVOICE_PAID_BY_OWNER", entityType: "invoice", entityId: MAY,
        after: { الدفعة: ownerPaymentId, المبلغ: ownerMinor, السبب: WHY } }, t);

      /* ٤. الفحص قبل الإيداع: كلُّ فاتورةٍ مخصَّصٌ عليها إجماليُّها بالهللة */
      const check = (await t.execute<{ number: string; total: number; paid: string }>(sql`
        select i.invoice_number as number, i.total_minor as total, coalesce(sum(pa.amount_minor), 0)::bigint as paid
          from invoices i left join payment_allocations pa on pa.invoice_id = i.id
         where i.id in (${MAY}, ${JULY}, ${SEPTEMBER}) group by i.id, i.invoice_number, i.total_minor
      `)).rows;
      for (const c of check) {
        if (Number(c.paid) !== Number(c.total)) throw new Error(`${c.number}: المخصَّص ${c.paid} لا يساوي الإجماليّ ${c.total} — تُلغى المعاملةُ كلُّها`);
      }
    });
    console.log("\nصُحِّح.");
  } finally {
    for (const c of closed) {
      const checklist = { ...(c.checklist as Record<string, unknown>), أُعيد_إقفاله: WHY };
      await db.update(monthCloses).set({ status: "CLOSED", checklist: checklist as never, closedById: AHMED, closedAt: new Date() }).where(eq(monthCloses.id, c.id));
      await recordAudit({ actorId: AHMED, action: "MONTH_CLOSED", entityType: "month_close", entityId: c.month, after: { السبب: WHY } });
    }
  }
  await state("بعد:");
  process.exit(0);
}

main().catch((e) => { console.error("✕", e); process.exit(1); });
