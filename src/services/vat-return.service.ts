/**
 * إقرارُ الضريبة من القاعدة — الحسابُ نفسُه في `lib/vat-return.ts`، وهذا يجمع له مادّتَه.
 *
 * والاختيارُ لا يُغلَق بإقفال الشهر: الإقرارُ الربعيّ يُعَدّ بعد إقفال أشهره، والاختيارُ لا
 * يغيّر حركةً ولا فاتورة — يقول أيُّها يُعدّ في الإقرار وحسب.
 */
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions, invoices as invoicesTable, vatInvoiceChoices, vatTxChoices } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { coverageStartFor, monthGapDays } from "@/lib/bank/coverage";
import { categoryLabel } from "@/lib/accountant-pack";
import { recognizePos } from "@/lib/bank/pos";
import { isValidSaudiVat, type InputVatStatus } from "@/lib/validation";
import { companyConfig } from "@/config/drive";
import {
  computeVatReturn, includedByDefault, invoiceIncluded, invoiceVat, type VatInvoice, isIncluded, periodBounds, periodMonths, txVat,
  type VatPeriod, type VatReturn, type VatTx,
} from "@/lib/vat-return";
import { todayInRiyadh } from "@/lib/riyadh-time";

/** رسومٌ لا ضريبةَ تُستردّ منها بذاتها — ضريبتُها في حركتها المستقلّة، فعرضُها للاختيار يعدّها مرّتين. */
const FEE_ONLY: ReadonlySet<string> = new Set(["POS_FEE", "BANK_FEE"]);

/**
 * بابُ الحركة في الإقرار — والمصنِّفُ نفسُه يُسأل عن «رسم الشبكة».
 *
 * كانت ضريبةُ رسوم الشبكة في صيغة `REFERENCE` تُصنَّف رسماً (أُصلح في `pos.ts`)، وما
 * قُيِّد قبل الإصلاح باقٍ «رسماً» — ومنه أغسطس ٢٠٢٦ المقفل، فلا يُعاد تصنيفُه بالكتابة.
 * فيُقرأ هنا بالمصنِّف ولا يُكتب: ضريبتُه تُخصم، والقيدُ التاريخيّ لا يُمسّ.
 * و`null`: رسمٌ لا يُعرض.
 */
function vatCategory(r: { category: string; description: string | null; direction: "DEBIT" | "CREDIT" }): string | null {
  if (r.category === "POS_FEE") return recognizePos(r.description, r.direction)?.kind === "POS_VAT" ? "POS_VAT" : null;
  return FEE_ONLY.has(r.category) ? null : r.category;
}

/**
 * الحركةُ (`bt`) التي سدّدت فاتورةً ضريبتُها تُخصم — بدفعتها المطابَقة أو بمصروفها المربوط —
 * «مغطّاة»: لا تُضمّ ثانية.
 */
const COVERED_BY_INVOICE = sql`(exists (
    select 1 from payment_allocations pa join invoices i on i.id = pa.invoice_id
    where pa.payment_id = bt.matched_payment_id and i.input_vat_status = 'ELIGIBLE' and i.vat_minor is not null)
  or exists (
    select 1 from expenses e join invoices i on i.id = e.invoice_id
    where e.bank_transaction_id = bt.id and i.input_vat_status = 'ELIGIBLE' and i.vat_minor is not null))`;

export interface VatTxRow extends VatTx {
  day: string;
  /** صادرٌ لمورّدٍ له في الفترة فواتيرُ محسوبة ولم تُطابَق به — ضمُّه قد يعدّ ضريبتَها مرّتين. */
  supplierHasInvoices: boolean;
  label: string;
  categoryLabel: string;
  included: boolean;
  vatMinor: number;
}

export interface VatInvoiceRow extends VatInvoice {
  supplier: string;
  supplierId: string;
  number: string;
  day: string;
  /** لماذا حكمت الآلةُ «لا تُخصم» — بالأركان التي لم تُقرأ. */
  reasons: string[];
  /** رقمُ المورّد في سجلّه — شاهدٌ لمن يُقرّ أنّ الورقة تحمله. */
  supplierVat: string | null;
  included: boolean;
  /** ضريبتُها في الخصم إن حُسبت. */
  vatUsedMinor: number;
  /** الشهرُ مفتوح — فتُصحَّح الفاتورةُ نفسُها، وذلك العلاجُ الدائم. */
  monthOpen: boolean;
}

export interface VatMonthCoverage {
  month: string;
  /** أيّامٌ لا كشفَ لها — `null` لا كشفَ في الشهر أصلاً. */
  gapDays: number | null;
  /** الشهرُ لم ينتهِ بعد. */
  open: boolean;
}

export interface VatReturnView {
  result: VatReturn;
  txs: VatTxRow[];
  invoices: VatInvoiceRow[];
  coverage: VatMonthCoverage[];
}

export async function loadVatReturn(period: VatPeriod): Promise<VatReturnView> {
  const { from, until } = periodBounds(period);
  const months = periodMonths(period);

  const invoices = (await db.execute<{
    id: string; supplier: string; supplier_id: string; number: string; day: string;
    input_vat_status: InputVatStatus; vat_minor: number | null; total_minor: number;
    seller_vat: string | null; buyer_vat: string | null; supplier_vat: string | null;
    choice: boolean | null; closed: boolean;
  }>(sql`
    select i.id, s.name_ar as supplier, s.id as supplier_id, i.invoice_number as number,
           to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as day,
           i.input_vat_status::text as input_vat_status, i.vat_minor, i.total_minor,
           i.seller_vat, i.buyer_vat, s.vat_number as supplier_vat, c.included as choice,
           month_is_closed(i.period_month) as closed
    from invoices i join suppliers s on s.id = i.supplier_id
    left join vat_invoice_choices c on c.invoice_id = i.id
    where i.period_month in (${sql.join(months.map((m) => sql`${m}`), sql`, `)})
      and i.tax_status <> 'NOT_APPLICABLE'
    order by i.invoice_date, i.invoice_number
  `)).rows;

  const txs = (await db.execute<{
    id: string; day: string; direction: "DEBIT" | "CREDIT"; category: string; amount_minor: number;
    label: string | null; choice: boolean | null; covered: boolean; supplier_has_invoices: boolean;
    description: string | null;
  }>(sql`
    select bt.id,
           to_char(bt.value_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as day,
           bt.direction::text as direction, bt.category::text as category, bt.amount_minor,
           coalesce(s.name_ar, cp.display_name, nullif(bt.beneficiary_raw, ''), nullif(bt.description, ''), bt.transaction_type) as label,
           bt.description,
           c.included as choice,
           (bt.supplier_id is not null and exists (
              select 1 from invoices i where i.supplier_id = bt.supplier_id
                and i.period_month in (${sql.join(months.map((m) => sql`${m}`), sql`, `)})
                and i.input_vat_status = 'ELIGIBLE' and i.vat_minor is not null)) as supplier_has_invoices,
           ${COVERED_BY_INVOICE} as covered
    from bank_transactions bt
    left join suppliers s on s.id = bt.supplier_id
    left join counterparties cp on cp.id = bt.counterparty_id
    left join vat_tx_choices c on c.bank_transaction_id = bt.id
    where (bt.value_date at time zone 'Asia/Riyadh')::date >= ${from}::date
      and (bt.value_date at time zone 'Asia/Riyadh')::date < ${until}::date
      and bt.category::text <> 'BANK_FEE'
      and (bt.category::text <> 'POS_FEE' or bt.description like 'REFERENCE%')
    order by bt.value_date, bt.id
  `)).rows;

  const rows: VatTxRow[] = txs.flatMap((r) => {
    const category = vatCategory(r);
    if (category === null) return [];
    const base: VatTx = {
      id: r.id, direction: r.direction, category, amountMinor: r.amount_minor,
      choice: r.choice, coveredByInvoice: r.covered,
    };
    return [{
      ...base,
      day: r.day,
      supplierHasInvoices: r.supplier_has_invoices && !r.covered,
      label: r.category === "POS_SETTLEMENT" ? posLabel("تسوية الشبكة", r.description, r.direction)
        : category === "POS_VAT" ? posLabel("ضريبة رسوم الشبكة", r.description, r.direction)
        : r.label ?? "حركة بلا وصف",
      categoryLabel: categoryLabel(category),
      included: isIncluded(base),
      vatMinor: txVat(base),
    }];
  });

  const invoiceRows: VatInvoiceRow[] = invoices.map((i) => {
    const base: VatInvoice = {
      id: i.id, inputVatStatus: i.input_vat_status, vatMinor: i.vat_minor, totalMinor: i.total_minor, choice: i.choice,
    };
    return {
      ...base,
      supplier: i.supplier, supplierId: i.supplier_id, number: i.number, day: i.day,
      reasons: missingPillars(i),
      supplierVat: i.supplier_vat,
      included: invoiceIncluded(base),
      vatUsedMinor: invoiceVat(base),
      monthOpen: !i.closed,
    };
  });

  const result = computeVatReturn({ invoices: invoiceRows, txs: rows });

  return {
    result,
    txs: rows,
    invoices: invoiceRows,
    coverage: await coverageOf(months),
  };
}

/** أركانُ الفاتورة الضريبيّة التي لم تُقرأ — بالفحص نفسه الذي حكم (`validation.ts`). */
function missingPillars(i: { number: string; seller_vat: string | null; buyer_vat: string | null; vat_minor: number | null }): string[] {
  const out: string[] = [];
  if (!i.number.trim()) out.push("رقمُ الفاتورة");
  if (!isValidSaudiVat(i.seller_vat)) out.push("رقمُ المورّد الضريبيّ");
  const buyer = (i.buyer_vat ?? "").replace(/\D/g, "");
  if (buyer !== companyVatDigits()) out.push(buyer ? "رقمُنا الضريبيّ (قُرئ غيرَه)" : "رقمُنا الضريبيّ");
  if (i.vat_minor === null) out.push("مبلغُ الضريبة");
  else if (i.vat_minor === 0) out.push("الضريبةُ صفرٌ مقروء");
  return out;
}

function companyVatDigits(): string {
  try {
    return companyConfig.vatNumber.replace(/\D/g, "");
  } catch {
    return "";
  }
}

const SCHEME_NAME: Readonly<Record<string, string>> = {
  SM: "مدى", MD: "مدى", VC: "فيزا", MC: "ماستركارد", AX: "أمريكان إكسبريس", GN: "الشبكة الخليجيّة",
  VS: "مدى", VM: "ماستركارد", VV: "فيزا", AV: "أمريكان إكسبريس",
};

/** «تسوية الشبكة — مدى» لا `81140155-260701-POS SM Se ttlem 855942`. */
function posLabel(what: string, description: string | null, direction: "DEBIT" | "CREDIT"): string {
  const scheme = recognizePos(description, direction)?.scheme;
  const name = scheme ? SCHEME_NAME[scheme] : undefined;
  return name ? `${what} — ${name}` : what;
}

/** أيّامُ كلّ شهرٍ بلا كشف — المبيعاتُ من البنك، فاليومُ الغائب مبيعاتٌ غائبة. */
async function coverageOf(months: readonly string[]): Promise<VatMonthCoverage[]> {
  const periods = (await db.execute<{ start: string | null; end: string | null }>(sql`
    select to_char(min(value_date at time zone 'Asia/Riyadh'), 'YYYY-MM-DD') as start,
           to_char(max(value_date at time zone 'Asia/Riyadh'), 'YYYY-MM-DD') as end
    from bank_transactions group by bank_import_id
  `)).rows.filter((r): r is { start: string; end: string } => r.start !== null && r.end !== null);
  const [opened] = (await db.execute<{ d: string | null }>(sql`
    select min(opened_on) as d from bank_accounts where is_active`)).rows;
  const today = todayInRiyadh();

  return months.map((month) => {
    const start = `${month}-01`;
    const [y, m] = month.split("-").map(Number);
    const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const open = today <= monthEnd;
    const end = open ? today : monthEnd;
    const from = coverageStartFor(start, end, opened?.d);
    if (from === null || start > today) return { month, gapDays: from === null ? 0 : null, open };
    return { month, gapDays: monthGapDays(periods, from, end), open };
  });
}

export class VatChoiceRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VatChoiceRefused";
  }
}

/**
 * يضمّ حركاتٍ إلى الإقرار أو يُخرجها، أو يُعيدها إلى الأصل (`null`).
 * ما وافق الأصلَ لا يُحفَظ — فيبقى الجدولُ ما خالفه صاحبُه وحده.
 */
export async function chooseVatTxs(ids: readonly string[], included: boolean | null, actorId: string): Promise<number> {
  const unique = [...new Set(ids)];
  return db.transaction(async (t) => {
    const found = await t
      .select({
        id: bankTransactions.id, direction: bankTransactions.direction,
        category: bankTransactions.category, description: bankTransactions.description,
      })
      .from(bankTransactions).where(inArray(bankTransactions.id, unique))
      .then((rows) => rows.map((f) => ({ ...f, category: vatCategory(f) })));
    if (found.length !== unique.length) throw new VatChoiceRefused("حركةٌ لم تعد موجودة — حدّث الصفحة");
    if (found.some((f) => f.category === null)) {
      throw new VatChoiceRefused("الرسمُ لا يُعدّ بذاته — ضريبتُه في حركتها المستقلّة");
    }

    if (included) {
      const covered = (await t.execute<{ id: string }>(sql`
        select bt.id from bank_transactions bt
        where bt.id in (${sql.join(unique.map((id) => sql`${id}`), sql`, `)}) and bt.direction = 'DEBIT'
          and ${COVERED_BY_INVOICE}
      `)).rows;
      if (covered.length > 0) {
        throw new VatChoiceRefused("ضريبةُ هذه الحركة محسوبةٌ في فاتورتها — ضمُّها يعدّها مرّتين");
      }
    }

    const keep = included === null ? [] : found.filter((f) => includedByDefault({ direction: f.direction, category: f.category ?? "" }) !== included);
    const reset = found.filter((f) => !keep.includes(f)).map((f) => f.id);
    if (reset.length > 0) await t.delete(vatTxChoices).where(inArray(vatTxChoices.bankTransactionId, reset));
    if (keep.length > 0 && included !== null) {
      await t.insert(vatTxChoices)
        .values(keep.map((f) => ({ bankTransactionId: f.id, included, decidedById: actorId })))
        .onConflictDoUpdate({
          target: vatTxChoices.bankTransactionId,
          set: { included, decidedById: actorId, decidedAt: sql`now()` },
        });
    }

    await recordAudit({
      actorId, action: "VAT_TX_CHOSEN", entityType: "bank_transaction",
      entityId: unique.length === 1 ? unique[0] : `${unique.length} حركة`,
      after: {
        القرار: included === null ? "الأصل" : included ? "تُعدّ في الإقرار" : "لا تُعدّ",
        الحركات: unique.length,
        ...(unique.length > 1 ? { المعرّفات: unique.slice(0, 50) } : {}),
      },
    }, t);
    return unique.length;
  });
}

/**
 * يُقرّ أنّ فواتيرَ ضريبيّةٌ على الورقة فتُحسب في الخصم (`true`)، أو يُخرجها (`false`)، أو يعيدها
 * إلى حكم الآلة (`null`). وما وافق حكمَ الآلة لا يُحفَظ.
 */
export async function chooseVatInvoices(ids: readonly string[], included: boolean | null, actorId: string): Promise<number> {
  const unique = [...new Set(ids)];
  return db.transaction(async (t) => {
    const found = await t
      .select({
        id: invoicesTable.id, number: invoicesTable.invoiceNumber, taxStatus: invoicesTable.taxStatus,
        inputVatStatus: invoicesTable.inputVatStatus, vatMinor: invoicesTable.vatMinor,
      })
      .from(invoicesTable).where(inArray(invoicesTable.id, unique));
    if (found.length !== unique.length) throw new VatChoiceRefused("فاتورةٌ لم تعد موجودة — حدّث الصفحة");
    if (found.some((f) => f.taxStatus === "NOT_APPLICABLE")) {
      throw new VatChoiceRefused("عرضُ السعر والفاتورةُ المبدئيّة ليسا فاتورةً ضريبيّة — لا تُخصم ضريبتُهما");
    }
    const zero = found.find((f) => f.vatMinor === 0);
    if (included && zero) {
      throw new VatChoiceRefused(
        `الفاتورة ${zero.number} قُرئت ضريبتُها صفراً — لا شيء فيها يُخصم. إن كانت على الورقة ضريبة فصحّح مبلغها من الفاتورة.`,
      );
    }

    const machine = (f: (typeof found)[number]) => f.inputVatStatus === "ELIGIBLE" && f.vatMinor !== null;
    const keep = included === null ? [] : found.filter((f) => machine(f) !== included);
    const reset = found.filter((f) => !keep.includes(f)).map((f) => f.id);
    if (reset.length > 0) await t.delete(vatInvoiceChoices).where(inArray(vatInvoiceChoices.invoiceId, reset));
    if (keep.length > 0 && included !== null) {
      await t.insert(vatInvoiceChoices)
        .values(keep.map((f) => ({ invoiceId: f.id, included, decidedById: actorId })))
        .onConflictDoUpdate({
          target: vatInvoiceChoices.invoiceId,
          set: { included, decidedById: actorId, decidedAt: sql`now()` },
        });
    }

    await recordAudit({
      actorId, action: "VAT_INVOICE_CHOSEN", entityType: "invoice",
      entityId: unique.length === 1 ? unique[0] : `${unique.length} فاتورة`,
      after: {
        القرار: included === null ? "حكمُ الآلة" : included ? "ضريبيّةٌ على الورقة — تُحسب في الخصم" : "لا تُحسب في الخصم",
        الفواتير: found.map((f) => f.number).slice(0, 50),
      },
    }, t);
    return unique.length;
  });
}
