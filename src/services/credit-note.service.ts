/**
 * الإشعارُ الدائن — مرتجعٌ أو خصمٌ من المورّد على فاتورةٍ بعينها.
 *
 * فاتورةٌ بخمسة آلاف وإشعارٌ بسبعمئة: المستحقّ **٤٬٣٠٠**. ولم يكن للإشعار في
 * القاعدة موضع — يُذكَر في كشف المورّد ولا يُغيّر شيئاً عندنا، فيُطالَب المقهى
 * بما ليس عليه ويبدو الفرقُ «اختلافاً» (`lib/credit-notes.ts`).
 *
 * فصار دفعةً بطريقة `CREDIT_NOTE` (049) تُخصَّص على فاتورتها بالآلة نفسها:
 * حدودُ التخصيص في القاعدة، وقفلُ الشهر، والتراجع. ولا تمرّ ببنك — لا يتبنّاها
 * كشفٌ ولا إيصال، ولا تُعدّ مالاً خرج.
 */
import { eq, sql } from "drizzle-orm";
import { invoices } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { formatRiyalsDisplay } from "@/lib/money";
import { formatDay } from "@/lib/riyadh-time";
import { allocate, createPayment } from "./payment.service";
import type { Tx } from "./types";

export class CreditNoteRefused extends Error {
  /** `duplicate`: يشبه إشعاراً مقيَّداً على الفاتورة — يُسأل ويمضي بإقرار، لا يُمنَع. */
  constructor(message: string, readonly duplicate = false) {
    super(message);
    this.name = "CreditNoteRefused";
  }
}

/** الاسمُ الذي يُحفظ به الإشعار على دفعته — ومنه يُعرف مرجعُه عند السؤال عن تكراره. */
export function creditNoteLabel(reference: string | null): string {
  return reference ? `إشعار دائن ${reference}` : "إشعار دائن";
}

export async function recordCreditNote(
  tx: Tx,
  input: {
    invoiceId: string; amountMinor: number; issuedOn: string; reference: string | null; reason: string | null;
    /** أُقِرّ أنّه إشعارٌ آخر غيرُ المقيَّد الذي يشبهه. */
    acknowledgeDuplicate?: boolean;
  },
  actorId: string,
): Promise<{ paymentId: string; remainingMinor: number }> {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new CreditNoteRefused("مبلغُ الإشعار رقمٌ أكبر من صفر");
  }
  const [inv] = await tx
    .select({
      id: invoices.id, supplierId: invoices.supplierId, number: invoices.invoiceNumber,
      totalMinor: invoices.totalMinor, periodMonth: invoices.periodMonth,
    })
    .from(invoices).where(eq(invoices.id, input.invoiceId)).for("update");
  if (!inv) throw new CreditNoteRefused("الفاتورة غير موجودة — حدّث الصفحة");
  if (!inv.supplierId) throw new CreditNoteRefused("الفاتورة بلا مورّد — لا حسابَ يُخصم منه الإشعار");

  const [{ allocated }] = (await tx.execute<{ allocated: number }>(sql`
    select coalesce(sum(amount_minor), 0)::int as allocated from payment_allocations where invoice_id = ${inv.id}
  `)).rows;
  const outstanding = inv.totalMinor - Number(allocated);
  if (input.amountMinor > outstanding) {
    throw new CreditNoteRefused(
      outstanding <= 0
        ? `فاتورة ${inv.number} مسدَّدةٌ كلُّها — الإشعارُ عليها رصيدٌ للمورّد، فكّ سدادها أوّلاً إن كان الإشعارُ قبله`
        : `الإشعار (${formatRiyalsDisplay(input.amountMinor)}) أكبر ممّا بقي على فاتورة ${inv.number} (${formatRiyalsDisplay(outstanding)})`,
    );
  }

  /*
    ضغطتان تقيّدان الإشعارَ مرّتين ما دام مجموعُهما دون المتبقّي: `findPaymentTwin`
    يستثني الإشعار عمداً (لا يتبنّاه كشف). فيُسأل هنا عن إشعارٍ على **هذه الفاتورة**
    بالمرجع نفسه، أو بالمبلغ واليوم نفسيهما. كشفٌ لا قيد: مرتجعان متساويان في يومٍ
    واحد ممكنان، فيمضي الثاني بإقرار.
  */
  if (!input.acknowledgeDuplicate) {
    const label = creditNoteLabel(input.reference);
    const [same] = (await tx.execute<{ amount_minor: number; day: string; label: string | null }>(sql`
      select p.amount_minor, to_char(p.paid_at at time zone 'UTC', 'YYYY-MM-DD') as day, p.beneficiary_name_raw as label
        from payments p
        join payment_allocations pa on pa.payment_id = p.id
       where pa.invoice_id = ${inv.id}
         and p.method = 'CREDIT_NOTE'
         and p.status not in ('REVERSED', 'VOID')
         and (
           (${input.reference}::text is not null and p.beneficiary_name_raw = ${label})
           or (p.amount_minor = ${input.amountMinor} and p.paid_at = ${`${input.issuedOn}T00:00:00Z`}::timestamptz)
         )
       limit 1
    `)).rows;
    if (same) {
      throw new CreditNoteRefused(
        `على فاتورة ${inv.number} إشعارٌ مقيَّد يشبهه (${formatRiyalsDisplay(Number(same.amount_minor))} بتاريخ ${formatDay(same.day)}`
        + `${same.label && same.label !== "إشعار دائن" ? ` · ${same.label}` : ""}) — إن كان هذا إشعاراً آخر فأقِرّ وقيّده`,
        true,
      );
    }
  }

  const paymentId = await createPayment(tx, {
    supplierId: inv.supplierId,
    paidAt: new Date(`${input.issuedOn}T00:00:00Z`),
    amountMinor: input.amountMinor,
    method: "CREDIT_NOTE",
    beneficiaryNameRaw: creditNoteLabel(input.reference),
    /* يسوّي فاتورتَه — فشهرُه شهرُها، وقفلُه قفلُها */
    appliesToMonth: inv.periodMonth,
    acknowledgeTwin: true,
  });
  const out = await allocate(tx, paymentId, [{ invoiceId: inv.id, amountMinor: input.amountMinor }]);
  if (out.allocatedMinor !== input.amountMinor) {
    throw new CreditNoteRefused("لم يُخصَّص الإشعارُ كلُّه على الفاتورة — لم يُكتب شيء");
  }

  await recordAudit({
    actorId,
    action: "PAYMENT_CREDIT_NOTE_RECORDED",
    entityType: "invoice",
    entityId: inv.id,
    before: { "المتبقّي بالهللات": outstanding },
    after: {
      الفاتورة: inv.number,
      "الإشعار بالهللات": input.amountMinor,
      المرجع: input.reference,
      السبب: input.reason,
      التاريخ: input.issuedOn,
      الدفعة: paymentId,
    },
  }, tx);
  return { paymentId, remainingMinor: outstanding - input.amountMinor };
}
