/**
 * إقرارُ الضريبة من القاعدة — الحسابُ نفسُه في `lib/vat-return.ts`، وهذا يجمع له مادّتَه.
 *
 * والاختيارُ لا يُغلَق بإقفال الشهر: الإقرارُ الربعيّ يُعَدّ بعد إقفال أشهره، والاختيارُ لا
 * يغيّر حركةً ولا فاتورة — يقول أيُّها يُعدّ في الإقرار وحسب. **ويُغلَق بتقديم الإقرار**
 * (`vat_filings`): ما قُدِّم للهيئة لا يتغيّر بنقرة، والتراجعُ عن اللقطة يفتحه.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bankTransactions, invoices as invoicesTable, vatFilings, vatInvoiceChoices, vatPeriodInputs, vatTxChoices,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { coverageStartFor, monthGapDays } from "@/lib/bank/coverage";
import { categoryLabel } from "@/lib/accountant-pack";
import { recognizePos } from "@/lib/bank/pos";
import { isValidSaudiVat, type InputVatStatus } from "@/lib/validation";
import { companyConfig } from "@/config/drive";
import { TOTAL_ROUNDING_TOLERANCE_MINOR } from "@/lib/money";
import {
  computeVatReturn, includedByDefault, invoiceIncluded, invoiceVat, isIncluded, machineEligible, monthsBefore,
  nextQuarter, parseVatPeriod, periodBounds, periodKey, periodMonths, previousQuarter, quarterOfMonth,
  txBlocked, txCaution, txVat, vatInsideGross, vatOnNet,
  type VatInvoice, type VatPeriod, type VatQuarter, type VatReturn, type VatTx,
} from "@/lib/vat-return";
import { todayInRiyadh } from "@/lib/riyadh-time";
import type { Conn } from "./types";

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
 * الفاتورةُ `i` (واختيارُها `ic`) محسوبةٌ في خصم الإقرار — `invoiceIncluded` بلغة القاعدة:
 * ما أقرّه صاحبُه («احسبها») ولو لم تحكم له الآلة، لا ما أخرجه؛ وإلّا حكمُ الآلة للمستوفية
 * التي رُوجع مستندُها.
 *
 * كان الشرطُ `ELIGIBLE` وحده، فحوالةُ فاتورةٍ «حُسبت بإقرارك» بقيت قابلةً للضمّ من الصادر —
 * تُخصم ضريبتُها من الفاتورة ومن الحوالة معاً.
 */
const INVOICE_COUNTED = sql`(i.tax_status <> 'NOT_APPLICABLE' and (
    (ic.included is true and i.vat_minor is distinct from 0)
    or (ic.included is null and i.input_vat_status = 'ELIGIBLE' and i.vat_minor is not null
        and not exists (select 1 from documents d where d.id = i.document_id and d.status <> 'ARCHIVED'))))`;

/**
 * الحركةُ (`bt`) التي سدّدت فاتورةً ضريبتُها تُخصم — بدفعتها المطابَقة أو بمصروفها المربوط —
 * «مغطّاة»: لا تُضمّ ثانية.
 */
const COVERED_BY_INVOICE = sql`(exists (
    select 1 from payment_allocations pa join invoices i on i.id = pa.invoice_id
    left join vat_invoice_choices ic on ic.invoice_id = i.id
    where pa.payment_id = bt.matched_payment_id and ${INVOICE_COUNTED})
  or exists (
    select 1 from expenses e join invoices i on i.id = e.invoice_id
    left join vat_invoice_choices ic on ic.invoice_id = i.id
    where e.bank_transaction_id = bt.id and ${INVOICE_COUNTED}))`;

/** الحركةُ (`bt`) طرفٌ في زوجٍ حُسم «ارتدّت» (`bank-bounce.service.ts`) — خروجُه أو عودتُه. */
const BOUNCED = sql`exists (
    select 1 from alert_resolutions ar
    where ar.decision = 'BOUNCED' and ar.key like 'bounce:%'
      and (split_part(ar.key, ':', 2) = bt.id or split_part(ar.key, ':', 3) = bt.id))`;

/** كم شهراً قبل الفترة يُبحث فيه عن فاتورةٍ محسوبة لمورّد الحوالة — حوالةُ أكتوبر عن فاتورة سبتمبر. */
const SUPPLIER_LOOKBACK_MONTHS = 3;

/** تاريخُ الفاتورة أبعدُ من هذا عن شهرها المحاسبيّ يُنبَّه عليه — سنةٌ قُرئت خطأً غالباً. */
const FAR_DATE_MONTHS = 12;

export interface VatTxRow extends VatTx {
  day: string;
  /** صادرٌ لمورّدٍ له فواتيرُ محسوبة (في الفترة أو قبلها بقليل) ولم تُطابَق به — ضمُّه قد يعدّ ضريبتَها مرّتين. */
  supplierHasInvoices: boolean;
  label: string;
  categoryLabel: string;
  included: boolean;
  vatMinor: number;
  /** لماذا لا تُضمّ مهما اختير — `null` تُضمّ. */
  blocked: string | null;
  /** بابٌ لا ضريبةَ فيه غالباً — تنبيهٌ لا منع. */
  caution: string | null;
}

export interface VatInvoiceRow extends VatInvoice {
  supplier: string;
  supplierId: string;
  supplierSlug: string;
  number: string;
  day: string;
  /** الشهرُ المحاسبيّ الذي تُخصم فيه. */
  periodMonth: string;
  /** لماذا حكمت الآلةُ «لا تُخصم» — بالأركان التي لم تُقرأ. */
  reasons: string[];
  /** ما يُراجَع قبل التقديم في فاتورةٍ محسوبة — ضريبةٌ فوق النسبة، توأمٌ تحت مورّدٍ آخر، تاريخٌ بعيد. */
  warnings: string[];
  /** رقمُ المورّد في سجلّه — شاهدٌ لمن يُقرّ أنّ الورقة تحمله. */
  supplierVat: string | null;
  /** رقمُ البائع كما قُرئ من الورقة. */
  sellerVat: string | null;
  /** الركنُ الوحيد الذي لم يُقرأ رقمُ المورّد، وهو معلومٌ من سجلّه. */
  knownFromRecord: boolean;
  /** شهرُ تاريخها إن خالف شهرَها المحاسبيّ — مرحَّلةٌ منه. */
  carriedFromMonth: string | null;
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

export interface VatFilingView {
  id: string;
  periodKey: string;
  filedOn: string;
  reference: string | null;
  outputVatMinor: number;
  inputVatMinor: number;
  carriedInMinor: number;
  netMinor: number;
  creditDisposition: "CARRY" | "REFUND" | null;
}

export interface VatMonthSlice {
  month: string;
  outputGrossMinor: number;
  outputVatMinor: number;
  inputVatMinor: number;
  netMinor: number;
}

export interface VatReturnView {
  result: VatReturn;
  txs: VatTxRow[];
  invoices: VatInvoiceRow[];
  coverage: VatMonthCoverage[];
  /** نقدُ كلّ شهرٍ كما كُتب — `null` لم يُكتب. */
  cash: { month: string; grossMinor: number | null }[];
  /** إقرارُ ربعِ هذه الفترة إن قُدِّم — وبه تُغلَق اختياراتُها. */
  filing: VatFilingView | null;
  /** الربعُ الذي رُحِّل منه الرصيدُ الدائن — `null` لا ترحيل. */
  carriedFrom: VatQuarter | null;
  /** أشهرُ الفترة واحداً واحداً — يُري الشهرَ الشاذّ. والتقريبُ لكلّ شهرٍ فقد يخالف المجموعَ بهللة. */
  byMonth: VatMonthSlice[];
  /** إشعاراتٌ دائنة قُيّدت في الفترة — لا تُنقص ضريبةَ المدخلات هنا؛ تُعرض ليراها المحاسب. */
  creditNotes: { count: number; amountMinor: number };
}

function quarterOf(period: VatPeriod): VatQuarter {
  return period.kind === "quarter" ? period : quarterOfMonth(period.month);
}

function filingView(r: typeof vatFilings.$inferSelect): VatFilingView {
  return {
    id: r.id, periodKey: r.periodKey, filedOn: r.filedOn, reference: r.reference,
    outputVatMinor: r.outputVatMinor, inputVatMinor: r.inputVatMinor, carriedInMinor: r.carriedInMinor,
    netMinor: r.netMinor,
    creditDisposition: r.creditDisposition === "CARRY" || r.creditDisposition === "REFUND" ? r.creditDisposition : null,
  };
}

/** الإقرارُ القائم (غير المتراجَع عنه) لربع. */
export async function loadVatFiling(quarter: VatQuarter, conn: Conn = db): Promise<VatFilingView | null> {
  const [row] = await conn.select().from(vatFilings)
    .where(and(eq(vatFilings.periodKey, periodKey(quarter)), isNull(vatFilings.voidedAt)));
  return row ? filingView(row) : null;
}

export async function loadVatReturn(period: VatPeriod, conn: Conn = db): Promise<VatReturnView> {
  const { from, until } = periodBounds(period);
  const months = periodMonths(period);
  const monthList = sql.join(months.map((m) => sql`${m}`), sql`, `);
  const supplierMonths = sql.join(
    [...monthsBefore(months[0], SUPPLIER_LOOKBACK_MONTHS), ...months].map((m) => sql`${m}`), sql`, `,
  );

  const invoices = (await conn.execute<{
    id: string; supplier: string; supplier_id: string; supplier_slug: string; number: string; day: string; date_month: string;
    period_month: string;
    input_vat_status: InputVatStatus; vat_minor: number | null; total_minor: number; subtotal_minor: number | null;
    seller_vat: string | null; buyer_vat: string | null; supplier_vat: string | null;
    choice: boolean | null; closed: boolean; awaiting: boolean; twin_supplier: string | null;
  }>(sql`
    select i.id, s.name_ar as supplier, s.id as supplier_id, s.slug as supplier_slug, i.invoice_number as number,
           to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as day,
           to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM') as date_month,
           i.period_month,
           i.input_vat_status::text as input_vat_status, i.vat_minor, i.total_minor, i.subtotal_minor,
           i.seller_vat, i.buyer_vat, s.vat_number as supplier_vat, c.included as choice,
           month_is_closed(i.period_month) as closed,
           exists (select 1 from documents d where d.id = i.document_id and d.status <> 'ARCHIVED') as awaiting,
           (select s2.name_ar from invoices i2 join suppliers s2 on s2.id = i2.supplier_id
             where i2.id <> i.id and i2.supplier_id <> i.supplier_id
               and i2.invoice_number = i.invoice_number and i.invoice_number <> ''
               and i2.total_minor = i.total_minor and i2.tax_status <> 'NOT_APPLICABLE'
               and i2.invoice_date = i.invoice_date
             limit 1) as twin_supplier
    from invoices i join suppliers s on s.id = i.supplier_id
    left join vat_invoice_choices c on c.invoice_id = i.id
    where i.period_month in (${monthList})
      and i.tax_status <> 'NOT_APPLICABLE'
    order by i.invoice_date, i.invoice_number
  `)).rows;

  const txs = (await conn.execute<{
    id: string; day: string; direction: "DEBIT" | "CREDIT"; category: string; amount_minor: number;
    label: string | null; choice: boolean | null; covered: boolean; supplier_has_invoices: boolean;
    description: string | null; bounced: boolean;
  }>(sql`
    select bt.id,
           to_char(bt.value_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as day,
           bt.direction::text as direction, bt.category::text as category, bt.amount_minor,
           coalesce(s.name_ar, cp.display_name, nullif(bt.beneficiary_raw, ''), nullif(bt.description, ''), bt.transaction_type) as label,
           bt.description,
           c.included as choice,
           (bt.supplier_id is not null and exists (
              select 1 from invoices i left join vat_invoice_choices ic on ic.invoice_id = i.id
              where i.supplier_id = bt.supplier_id
                and i.period_month in (${supplierMonths})
                and ${INVOICE_COUNTED})) as supplier_has_invoices,
           ${COVERED_BY_INVOICE} as covered,
           ${BOUNCED} as bounced
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
      choice: r.choice, coveredByInvoice: r.covered, bounced: r.bounced,
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
      blocked: txBlocked(base),
      caution: txCaution(base),
    }];
  });

  const invoiceRows: VatInvoiceRow[] = invoices.map((i) => {
    const base: VatInvoice = {
      id: i.id, inputVatStatus: i.input_vat_status, vatMinor: i.vat_minor, totalMinor: i.total_minor, choice: i.choice,
      awaitingReview: i.awaiting, subtotalMinor: i.subtotal_minor,
    };
    const reasons = missingPillars(i);
    return {
      ...base,
      supplier: i.supplier, supplierId: i.supplier_id, supplierSlug: i.supplier_slug, number: i.number, day: i.day, periodMonth: i.period_month,
      reasons: i.awaiting && machineEligible({ ...base, awaitingReview: false }) ? ["تنتظر المراجعة — لم يُقرّ أحدٌ قراءتَها"] : reasons,
      warnings: reviewWarnings(i),
      supplierVat: i.supplier_vat,
      sellerVat: i.seller_vat,
      knownFromRecord: reasons.length === 1 && reasons[0] === SELLER_VAT_UNREAD && isValidSaudiVat(i.supplier_vat)
        && i.supplier_vat?.replace(/\D/g, "") !== companyVatDigits(),
      carriedFromMonth: i.date_month !== i.period_month ? i.date_month : null,
      included: invoiceIncluded(base),
      vatUsedMinor: invoiceVat(base),
      monthOpen: !i.closed,
    };
  });

  const cashRows = await conn.select().from(vatPeriodInputs).where(inArray(vatPeriodInputs.month, months));
  const cash = months.map((month) => ({
    month, grossMinor: cashRows.find((c) => c.month === month)?.cashSalesGrossMinor ?? null,
  }));
  const cashTotal = cash.reduce((s, c) => s + (c.grossMinor ?? 0), 0);

  /* الرصيدُ الدائن يُرحَّل من إقرار الربع السابق المقدَّم — وللربع كاملاً، لا لشهرٍ منه */
  const quarter = quarterOf(period);
  const previous = period.kind === "quarter" ? await loadVatFiling(previousQuarter(quarter), conn) : null;
  const carriedIn = previous && previous.creditDisposition === "CARRY" && previous.netMinor < 0 ? -previous.netMinor : 0;

  const result = computeVatReturn({ invoices: invoiceRows, txs: rows, cashSalesGrossMinor: cashTotal, carriedInMinor: carriedIn });

  const byMonth: VatMonthSlice[] = months.length < 2 ? [] : months.map((month) => {
    const r = computeVatReturn({
      invoices: invoiceRows.filter((i) => i.periodMonth === month),
      txs: rows.filter((t) => t.day.startsWith(month)),
      cashSalesGrossMinor: cash.find((c) => c.month === month)?.grossMinor ?? 0,
    });
    return {
      month, outputGrossMinor: r.output.grossMinor + r.output.cashGrossMinor,
      outputVatMinor: r.output.vatMinor, inputVatMinor: r.input.totalMinor, netMinor: r.netMinor,
    };
  });

  const [notes] = (await conn.execute<{ n: number; amount: number }>(sql`
    select count(*)::int as n, coalesce(sum(p.amount_minor), 0)::int as amount
    from payments p
    where p.method = 'CREDIT_NOTE' and p.status not in ('REVERSED', 'VOID')
      and (p.paid_at at time zone 'Asia/Riyadh')::date >= ${from}::date
      and (p.paid_at at time zone 'Asia/Riyadh')::date < ${until}::date
  `)).rows;

  return {
    result,
    txs: rows,
    invoices: invoiceRows,
    coverage: await coverageOf(months, conn),
    cash,
    filing: await loadVatFiling(quarter, conn),
    carriedFrom: carriedIn > 0 ? previousQuarter(quarter) : null,
    byMonth,
    creditNotes: { count: notes?.n ?? 0, amountMinor: notes?.amount ?? 0 },
  };
}

const SELLER_VAT_UNREAD = "رقمُ المورّد الضريبيّ";

/** أركانُ الفاتورة الضريبيّة التي لم تُقرأ — بالفحص نفسه الذي حكم (`validation.ts`). */
function missingPillars(i: { number: string; seller_vat: string | null; buyer_vat: string | null; vat_minor: number | null }): string[] {
  const out: string[] = [];
  const ours = companyVatDigits();
  if (!i.number.trim()) out.push("رقمُ الفاتورة");
  /* رقمُنا في خانة البائع قراءةٌ خاطئة لا رقمُ مورّد */
  if (!isValidSaudiVat(i.seller_vat) || (ours !== "" && (i.seller_vat ?? "").replace(/\D/g, "") === ours)) out.push(SELLER_VAT_UNREAD);
  const buyer = (i.buyer_vat ?? "").replace(/\D/g, "");
  if (buyer !== ours) out.push(buyer ? "رقمُنا الضريبيّ (قُرئ غيرَه)" : "رقمُنا الضريبيّ");
  if (i.vat_minor === null) out.push("مبلغُ الضريبة");
  else if (i.vat_minor === 0) out.push("الضريبةُ صفرٌ مقروء");
  return out;
}

/**
 * ما يُراجَع قبل التقديم — الفاتورةُ تبقى محسوبةً بما طُبع، والتنبيهُ يقول أين يُنظر.
 * ضريبةٌ قُرئت 1,500 والصوابُ 150 تمرّ «مستوفيةً» إن استقام جمعُها مع إجماليٍّ قُرئ خطأً مثلها.
 */
function reviewWarnings(i: {
  vat_minor: number | null; total_minor: number; subtotal_minor: number | null;
  seller_vat: string | null; supplier_vat: string | null; twin_supplier: string | null;
  date_month: string; period_month: string;
}): string[] {
  const out: string[] = [];
  if (i.vat_minor !== null && i.vat_minor > 0) {
    if (i.subtotal_minor !== null && i.vat_minor > vatOnNet(i.subtotal_minor) + TOTAL_ROUNDING_TOLERANCE_MINOR) {
      out.push("الضريبةُ المقروءة فوق 15٪ من الصافي");
    } else if (i.vat_minor > vatInsideGross(i.total_minor) + TOTAL_ROUNDING_TOLERANCE_MINOR) {
      out.push("الضريبةُ المقروءة فوق 15/115 من الإجمالي");
    }
  }
  if (i.twin_supplier) out.push(`الفاتورةُ نفسُها مقيَّدةٌ تحت «${i.twin_supplier}» — قد تُخصم مرّتين`);
  const seller = (i.seller_vat ?? "").replace(/\D/g, "");
  const known = (i.supplier_vat ?? "").replace(/\D/g, "");
  if (isValidSaudiVat(i.seller_vat) && isValidSaudiVat(i.supplier_vat) && seller !== known && seller !== companyVatDigits()) {
    out.push("رقمُ البائع على الورقة غيرُ رقم المورّد في سجلّه");
  }
  if (Math.abs(monthIndex(i.date_month) - monthIndex(i.period_month)) > FAR_DATE_MONTHS) {
    out.push("تاريخُها بعيدٌ عن الفترة بأكثر من سنة — راجع السنة المقروءة");
  }
  return out;
}

function monthIndex(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return y * 12 + m;
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
async function coverageOf(months: readonly string[], conn: Conn): Promise<VatMonthCoverage[]> {
  const periods = (await conn.execute<{ start: string | null; end: string | null }>(sql`
    select to_char(min(value_date at time zone 'Asia/Riyadh'), 'YYYY-MM-DD') as start,
           to_char(max(value_date at time zone 'Asia/Riyadh'), 'YYYY-MM-DD') as end
    from bank_transactions group by bank_import_id
  `)).rows.filter((r): r is { start: string; end: string } => r.start !== null && r.end !== null);
  const [opened] = (await conn.execute<{ d: string | null }>(sql`
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

/** يرفض إن وقع شهرٌ من `months` في ربعٍ قُدِّم إقرارُه — ما قُدِّم لا يتغيّر بنقرة. */
async function assertNotFiled(conn: Conn, months: readonly string[]): Promise<void> {
  const keys = [...new Set(months.map((m) => periodKey(quarterOfMonth(m))))];
  if (keys.length === 0) return;
  const filed = await conn.select({ key: vatFilings.periodKey }).from(vatFilings)
    .where(and(inArray(vatFilings.periodKey, keys), isNull(vatFilings.voidedAt)));
  if (filed.length > 0) {
    throw new VatChoiceRefused(
      `إقرارُ ${filed.map((f) => f.key).join(" و")} قُدِّم — اختياراتُه مقفلة. إن لزم التغيير فتراجع عن تسجيل التقديم أوّلاً.`,
    );
  }
}

/**
 * يضمّ حركاتٍ إلى الإقرار أو يُخرجها، أو يُعيدها إلى الأصل (`null`).
 * ما وافق الأصلَ لا يُحفَظ — فيبقى الجدولُ ما خالفه صاحبُه وحده.
 */
export async function chooseVatTxs(ids: readonly string[], included: boolean | null, actorId: string, conn: Conn = db): Promise<number> {
  const unique = [...new Set(ids)];
  return conn.transaction(async (t) => {
    const found = await t
      .select({
        id: bankTransactions.id, direction: bankTransactions.direction,
        category: bankTransactions.category, description: bankTransactions.description,
        month: sql<string>`to_char(${bankTransactions.valueDate} at time zone 'Asia/Riyadh', 'YYYY-MM')`,
      })
      .from(bankTransactions).where(inArray(bankTransactions.id, unique))
      .then((rows) => rows.map((f) => ({ ...f, category: vatCategory(f) })));
    if (found.length !== unique.length) throw new VatChoiceRefused("حركةٌ لم تعد موجودة — حدّث الصفحة");
    if (found.some((f) => f.category === null)) {
      throw new VatChoiceRefused("الرسمُ لا يُعدّ بذاته — ضريبتُه في حركتها المستقلّة");
    }
    await assertNotFiled(t, found.map((f) => f.month));

    if (included) {
      const idList = sql.join(unique.map((id) => sql`${id}`), sql`, `);
      const covered = (await t.execute<{ id: string }>(sql`
        select bt.id from bank_transactions bt
        where bt.id in (${idList}) and bt.direction = 'DEBIT'
          and ${COVERED_BY_INVOICE}
      `)).rows;
      if (covered.length > 0) {
        throw new VatChoiceRefused("ضريبةُ هذه الحركة محسوبةٌ في فاتورتها — ضمُّها يعدّها مرّتين");
      }
      const bounced = (await t.execute<{ id: string }>(sql`
        select bt.id from bank_transactions bt where bt.id in (${idList}) and ${BOUNCED}
      `)).rows;
      if (bounced.length > 0) {
        throw new VatChoiceRefused("هذه حوالةٌ ارتدّت وعاد مبلغُها — لا شراءَ فيها ولا بيع");
      }
    }

    const before = await t.select({ id: vatTxChoices.bankTransactionId, included: vatTxChoices.included })
      .from(vatTxChoices).where(inArray(vatTxChoices.bankTransactionId, unique));

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
      /* ما كان مختاراً بيدٍ قبل هذا — الصفُّ يُحذف عند الإعادة إلى الأصل، فهنا أثرُه الوحيد */
      before: before.length > 0 ? { "اختيارٌ سابق": Object.fromEntries(before.map((b) => [b.id, b.included ? "تُعدّ" : "لا تُعدّ"])) } : undefined,
      after: {
        القرار: included === null ? "الأصل" : included ? "تُعدّ في الإقرار" : "لا تُعدّ",
        الحركات: unique.length,
        ...(unique.length > 1 ? { المعرّفات: unique } : {}),
      },
    }, t);
    return unique.length;
  });
}

/**
 * يُقرّ أنّ فواتيرَ ضريبيّةٌ على الورقة فتُحسب في الخصم (`true`)، أو يُخرجها (`false`)، أو يعيدها
 * إلى حكم الآلة (`null`). وما وافق حكمَ الآلة لا يُحفَظ.
 */
export async function chooseVatInvoices(ids: readonly string[], included: boolean | null, actorId: string, conn: Conn = db): Promise<number> {
  const unique = [...new Set(ids)];
  return conn.transaction(async (t) => {
    const found = await t
      .select({
        id: invoicesTable.id, number: invoicesTable.invoiceNumber, taxStatus: invoicesTable.taxStatus,
        inputVatStatus: invoicesTable.inputVatStatus, vatMinor: invoicesTable.vatMinor,
        periodMonth: invoicesTable.periodMonth,
        awaitingReview: sql<boolean>`exists (select 1 from documents d where d.id = ${invoicesTable}.document_id and d.status <> 'ARCHIVED')`,
      })
      .from(invoicesTable).where(inArray(invoicesTable.id, unique));
    if (found.length !== unique.length) throw new VatChoiceRefused("فاتورةٌ لم تعد موجودة — حدّث الصفحة");
    if (found.some((f) => f.taxStatus === "NOT_APPLICABLE")) {
      throw new VatChoiceRefused("عرضُ السعر والفاتورةُ المبدئيّة ليسا فاتورةً ضريبيّة — لا تُخصم ضريبتُهما");
    }
    await assertNotFiled(t, found.map((f) => f.periodMonth));
    const zero = found.find((f) => f.vatMinor === 0);
    if (included && zero) {
      throw new VatChoiceRefused(
        `الفاتورة ${zero.number} قُرئت ضريبتُها صفراً — لا شيء فيها يُخصم. إن كانت على الورقة ضريبة فصحّح مبلغها من الفاتورة.`,
      );
    }

    const before = await t.select({ id: vatInvoiceChoices.invoiceId, included: vatInvoiceChoices.included })
      .from(vatInvoiceChoices).where(inArray(vatInvoiceChoices.invoiceId, unique));

    const keep = included === null ? [] : found.filter((f) => machineEligible(f) !== included);
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
      before: before.length > 0 ? { "إقرارٌ سابق": Object.fromEntries(before.map((b) => [b.id, b.included ? "تُحسب" : "لا تُحسب"])) } : undefined,
      after: {
        القرار: included === null ? "حكمُ الآلة" : included ? "ضريبيّةٌ على الورقة — تُحسب في الخصم" : "لا تُحسب في الخصم",
        الفواتير: found.map((f) => f.number),
        ...(unique.length > 1 ? { المعرّفات: unique } : {}),
      },
    }, t);
    return unique.length;
  });
}

/* ───────────── النقدُ غير المودَع ───────────── */

/**
 * يكتب مبيعاتِ النقد غير المودَع لشهر (شاملةَ الضريبة)، أو يمحوها (`null` — «لم يُكتب»).
 * المبلغُ يصل هللاتٍ صحيحة فحصها المسار؛ ولا يُكتب في ربعٍ قُدِّم إقرارُه.
 */
export async function setVatCashSales(month: string, grossMinor: number | null, actorId: string, conn: Conn = db): Promise<void> {
  if (parseVatPeriod(month)?.kind !== "month") throw new VatChoiceRefused("شهرٌ غير صالح");
  if (grossMinor !== null && (!Number.isSafeInteger(grossMinor) || grossMinor < 0)) {
    throw new VatChoiceRefused("مبلغُ النقد لا يكون سالباً");
  }
  await conn.transaction(async (t) => {
    await assertNotFiled(t, [month]);
    const [before] = await t.select().from(vatPeriodInputs).where(eq(vatPeriodInputs.month, month));
    if (grossMinor === null) {
      await t.delete(vatPeriodInputs).where(eq(vatPeriodInputs.month, month));
    } else {
      await t.insert(vatPeriodInputs)
        .values({ month, cashSalesGrossMinor: grossMinor, updatedById: actorId })
        .onConflictDoUpdate({
          target: vatPeriodInputs.month,
          set: { cashSalesGrossMinor: grossMinor, updatedById: actorId, updatedAt: sql`now()` },
        });
    }
    await recordAudit({
      actorId, action: "VAT_CASH_SALES_SET", entityType: "vat_period", entityId: month,
      before: before ? { "نقدٌ غير مودَع (هللة)": before.cashSalesGrossMinor } : undefined,
      after: { "نقدٌ غير مودَع (هللة)": grossMinor },
    }, t);
  });
}

/* ───────────── لقطةُ التقديم ───────────── */

export interface FileVatReturnInput {
  /** `2026-Q3` — الإقرارُ ربعيّ. */
  periodKey: string;
  /** يومُ التقديم `YYYY-MM-DD`. */
  filedOn: string;
  reference: string | null;
  /** ما فُعل بالرصيد الدائن — يلزم حين يكون الصافي سالباً. */
  creditDisposition: "CARRY" | "REFUND" | null;
}

/**
 * «قدّمتُه»: يحفظ ما قُدِّم للهيئة عن الربع — الأرقامُ تُحسب هنا لحظةَ الكتابة، لا من المتصفّح —
 * وبعده تُقفل اختياراتُ الربع. والربعُ الذي لم ينتهِ لا يُقدَّم.
 */
export async function fileVatReturn(input: FileVatReturnInput, actorId: string, conn: Conn = db): Promise<VatFilingView> {
  const period = parseVatPeriod(input.periodKey);
  if (!period || period.kind !== "quarter") throw new VatChoiceRefused("الإقرارُ يُسجَّل للربع كاملاً");
  const today = todayInRiyadh();
  if (today < periodBounds(period).until) throw new VatChoiceRefused("الربعُ لم ينتهِ بعد — لا يُقدَّم إقرارُه");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.filedOn) || input.filedOn > today || input.filedOn < periodBounds(period).until) {
    throw new VatChoiceRefused("يومُ التقديم يقع بعد نهاية الربع ولا يسبق اليوم");
  }

  return conn.transaction(async (t) => {
    if (await loadVatFiling(period, t)) throw new VatChoiceRefused("سُجّل تقديمُ هذا الإقرار من قبل — حدّث الصفحة");
    const view = await loadVatReturn(period, t);
    const r = view.result;
    if (r.netMinor < 0 && input.creditDisposition === null) {
      throw new VatChoiceRefused("الصافي رصيدٌ لك — اختر: يُرحَّل للربع التالي أم طُلب استردادُه");
    }
    const [row] = await t.insert(vatFilings).values({
      periodKey: periodKey(period),
      filedOn: input.filedOn,
      reference: input.reference,
      outputVatMinor: r.output.vatMinor,
      inputVatMinor: r.input.totalMinor,
      carriedInMinor: r.carriedInMinor,
      netMinor: r.netMinor,
      creditDisposition: r.netMinor < 0 ? input.creditDisposition : null,
      snapshot: {
        result: r,
        cash: view.cash,
        invoices: view.invoices.filter((i) => i.included).map((i) => ({ id: i.id, vatMinor: i.vatUsedMinor, by: i.choice === true ? "إقرار" : "آلة" })),
        txs: view.txs.filter((x) => x.included).map((x) => ({ id: x.id, vatMinor: x.vatMinor, direction: x.direction })),
      },
      filedById: actorId,
    }).returning();
    await recordAudit({
      actorId, action: "VAT_RETURN_FILED", entityType: "vat_filing", entityId: row.id,
      after: {
        الفترة: row.periodKey, "يوم التقديم": row.filedOn, المرجع: row.reference,
        "ضريبة المخرجات (هللة)": row.outputVatMinor, "ضريبة المدخلات (هللة)": row.inputVatMinor,
        "رصيدٌ مرحَّل (هللة)": row.carriedInMinor, "الصافي (هللة)": row.netMinor,
        "الرصيد الدائن": row.creditDisposition,
      },
    }, t);
    return filingView(row);
  });
}

/**
 * التراجعُ عن تسجيل التقديم — اللقطةُ تبقى بسببها ولا تُحذف، وتُفتح اختياراتُ الربع.
 * وما رُحِّل رصيدُه إلى ربعٍ قُدِّم بعده لا يُتراجَع عنه قبله.
 */
export async function voidVatFiling(periodKeyRaw: string, reason: string, actorId: string, conn: Conn = db): Promise<void> {
  const period = parseVatPeriod(periodKeyRaw);
  if (!period || period.kind !== "quarter") throw new VatChoiceRefused("فترةٌ غير صالحة");
  await conn.transaction(async (t) => {
    const filing = await loadVatFiling(period, t);
    if (!filing) throw new VatChoiceRefused("لا تقديمَ مسجَّلاً لهذا الربع — حدّث الصفحة");
    if (filing.creditDisposition === "CARRY") {
      const next = await loadVatFiling(nextQuarter(period), t);
      if (next) throw new VatChoiceRefused("رصيدُ هذا الإقرار رُحِّل إلى إقرار الربع التالي المقدَّم — تراجع عن ذاك أوّلاً");
    }
    await t.update(vatFilings)
      .set({ voidedAt: sql`now()`, voidedById: actorId, voidReason: reason })
      .where(and(eq(vatFilings.id, filing.id), isNull(vatFilings.voidedAt)));
    await recordAudit({
      actorId, action: "VAT_FILING_VOIDED", entityType: "vat_filing", entityId: filing.id,
      before: { الفترة: filing.periodKey, "الصافي (هللة)": filing.netMinor, "يوم التقديم": filing.filedOn },
      after: { السبب: reason },
    }, t);
  });
}
