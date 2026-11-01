/**
 * دفعةٌ زادت عن فاتورتها فاستُردّت بخصمها من فاتورةٍ لاحقة — قرارُ صاحب المقهى لا الآلة.
 *
 * أفال (أحمد، ١ نوفمبر ٢٠٢٦): دفعةُ ٢٦ أغسطس ٨٬٤٠٢٫٧٧ خُصّص منها ٦٬٤٠٤٫٠٧ وبقي ١٬٩٩٨٫٧٠ «بلا فاتورة»، وطلب
 * صاحبُ المقهى من المورّد ردَّها فخصمها من آخر دفعة. فالحسابُ يطابق على الورق (مدفوعاتُه = فواتيرُه) ويبقى بندٌ في
 * «يحتاج قرارك» بلا زرّ: الخصمُ الآليّ يقتصر على سبعة أيامٍ بعد الدفعة (`SETTLEMENT_FORWARD_DAYS`)، وفواتيرُه المفتوحة
 * أحدث بشهرين. والقرارُ البشريّ (`forwardDays: null`) موجودٌ في الخدمة ولا بابَ له.
 *
 * فهنا الباب: تُخصَّص **هذه الدفعةُ وحدها** على فواتيره المفتوحة بالأقدم أوّلاً، بجملةٍ يكتبها صاحبُها تُحفظ في
 * التدقيق. لا دفعةَ جديدة (فالمالُ لم يخرج مرّتين)، ولا حذف: التخصيصُ يُفكّ بردّ الدفعة كأيّ تخصيص.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { payments } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { classifyCredit } from "@/lib/credit-notes";
import { NotFound, Refused } from "@/lib/domain-error";
import { applySupplierCredit } from "./supplier-credit.service";
import type { Conn, Tx } from "./types";

export const MIN_NOTE_LENGTH = 3;

/** سطرُ إشعارٍ دائن في كشف المورّد بمبلغ الباقي نفسه — الدليلُ الذي يشرح لماذا خُصم. */
export interface CreditNoteEvidence {
  ref: string | null;
  /** يوم السطر في الكشف، `YYYY-MM-DD` */
  dateIso: string;
  amountMinor: number;
}

/**
 * أفال: كشفُه نفسُه فيه `RINV/2026/00016 (Reversal of: INV/2026/00080)` دائناً بمبلغ الباقي بالهللة — فالمورّد عكس
 * الفاتورةَ الخاطئة وخصم أثرَها من آخر دفعة. يُبحث عنه بالمبلغ **المطابق تماماً** وبوصف المورّد وحده (`classifyCredit`):
 * سطرٌ دائنٌ هو سدادٌ منّا بالمبلغ نفسه ليس دليلاً. والدليلُ يُعرض ويُحفظ مع قرار صاحبه، ولا يُسدَّد به شيءٌ وحده.
 */
export async function findCreditNoteEvidence(supplierId: string, amountMinor: number, conn: Conn = db): Promise<CreditNoteEvidence | null> {
  if (amountMinor <= 0) return null;
  const { rows } = await conn.execute<{ ref: string | null; description: string | null; d: string }>(sql`
    select l.ref, l.description, to_char(l.date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as d
    from statement_lines l join statements st on st.id = l.statement_id
    where st.supplier_id = ${supplierId} and l.credit_minor = ${amountMinor}
    order by st.period_end desc, l.date desc`);
  const hit = rows.find((r) => classifyCredit({ id: "", date: new Date(r.d), amountMinor, description: r.description, reference: r.ref }) === "CREDIT_NOTE");
  return hit ? { ref: hit.ref ?? hit.description, dateIso: hit.d, amountMinor } : null;
}

export interface UnbackedCreditOutcome {
  appliedMinor: number;
  invoiceCount: number;
  /** ما بقي من الدفعة بعد الخصم — إن زادت عن مفتوح المورّد. */
  leftMinor: number;
}

export async function applyUnbackedPaymentToOpenInvoices(
  input: { paymentId: string; note: string; actorId: string },
  conn: Conn = db,
): Promise<UnbackedCreditOutcome> {
  const note = input.note.trim();
  if (note.length < MIN_NOTE_LENGTH) throw new Refused("اكتب ما حدث بإيجاز: لِمَ تُسدَّد بها فواتيره؟ (يُحفظ في سجلّ التدقيق)");
  const run = async (t: Tx): Promise<UnbackedCreditOutcome> => {
    const [p] = await t.select({ supplierId: payments.supplierId, status: payments.status, amountMinor: payments.amountMinor, feeMinor: payments.feeMinor })
      .from(payments).where(eq(payments.id, input.paymentId)).for("update");
    if (!p) throw new NotFound("هذه الدفعة لم تعد موجودة. حدّث الصفحة.");
    if (!p.supplierId) throw new Refused("هذه الدفعة بلا مورّد. عرّف جهتها أولاً ثم عُد إليها.");
    if (p.status === "REVERSED" || p.status === "VOID") throw new Refused("هذه الدفعة رُدّت أو أُلغيت، فلا تُسدَّد بها فاتورة.");
    const [row] = (await t.execute<{ allocated: string | number }>(sql`select coalesce(sum(amount_minor), 0)::bigint as allocated from payment_allocations where payment_id = ${input.paymentId}`)).rows;
    const unbacked = p.amountMinor - p.feeMinor - Number(row?.allocated ?? 0);
    if (unbacked <= 0) throw new Refused("لا باقيَ في هذه الدفعة: خُصّصت كلُّها على فواتير. حدّث الصفحة.");

    const out = await applySupplierCredit(t, p.supplierId, { forwardDays: null, paymentIds: [input.paymentId] });
    if (out.appliedMinor <= 0) throw new Refused("لا فواتير مفتوحة لهذا المورّد تستوعب هذا المبلغ، فلا شيء يُسدَّد.");
    /* الدليلُ يقرؤه الخادم لا المتصفّح، ويُحفظ بنصّه مع القرار */
    const evidence = await findCreditNoteEvidence(p.supplierId, unbacked, t);

    await recordAudit({
      actorId: input.actorId, action: "SUPPLIER_CREDIT_APPLIED", entityType: "payment", entityId: input.paymentId,
      before: { "باقي الدفعة بلا فاتورة بالهللات": unbacked },
      after: {
        "سُدّد بها بالهللات": out.appliedMinor,
        "الفواتير": out.allocations.map((a) => ({ الفاتورة: a.invoiceId, بالهللات: a.amountMinor })),
        "ما حدث (بقلم صاحب المقهى)": note,
        "إشعار المورّد الدائن بالمبلغ نفسه": evidence ? { المرجع: evidence.ref, اليوم: evidence.dateIso } : "لا سطرَ دائنًا بمبلغٍ مطابق في كشوفه",
        "القرار": "بيد صاحب المقهى: خُصّصت الدفعةُ على فواتيره المفتوحة بالأقدم أوّلاً",
      },
    }, t);
    return { appliedMinor: out.appliedMinor, invoiceCount: out.allocations.length, leftMinor: Math.max(0, unbacked - out.appliedMinor) };
  };
  return "transaction" in conn ? conn.transaction(run) : run(conn as Tx);
}

/** هل لهذا المورّد رصيدٌ ومفتوحٌ معاً؟ — فيُعرض الزرّ ولا يُردّ بعد الضغط. */
export function canSettleFromCredit(b: { openCount: number; creditMinor: number } | undefined): boolean {
  return b !== undefined && b.openCount > 0 && b.creditMinor > 0;
}
