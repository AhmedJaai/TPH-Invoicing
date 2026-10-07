/**
 * إقرارُ ضريبة القيمة المضافة — كم أسدّد للهيئة عن الفترة؟
 *
 *   المستحقّ = ضريبةُ المخرجات (ما حصّلتُه من الزبائن) − ضريبةُ المدخلات (ما دفعتُه للمورّدين)
 *
 * **المخرجات من كشف البنك**: المبيعاتُ لا تدخل النظام إلّا من ملفّ فودكس، والبنكُ يقول ما
 * وصل فعلاً. فتسويةُ الشبكة (`POS_SETTLEMENT`) مبيعاتٌ شاملةُ الضريبة، ضريبتُها ١٥/١١٥ منها
 * — والرسومُ تُخصم في حركاتٍ مستقلّة فالتسويةُ إجماليّة. وأيُّ واردٍ آخر (تطبيقُ توصيل،
 * حوالةُ زبون) يُضمّ باختيار صاحبه.
 *
 * **المدخلات من بابين**:
 *   ١. الفواتيرُ الضريبيّة المستوفية (`ELIGIBLE`) — ضريبتُها كما طُبعت، لا محسوبة.
 *   ٢. حركاتُ البنك: ضريبةُ رسوم الشبكة والبنك (`POS_VAT` · `BANK_VAT`) مبلغُها هو الضريبة،
 *      وما يختاره صاحبُ المقهى من صادرٍ آخر (إيجار · كهرباء · مورّدٌ بلا فاتورةٍ عندنا)
 *      ضريبتُه ١٥/١١٥ منه.
 *
 * والفاتورةُ التي حكمت الآلةُ «لا تُخصم» لركنٍ لم يُقرأ تُحسب إن أقرّ صاحبُ المقهى أنّها ضريبيّةٌ
 * على الورقة، وضريبتُها المقروءة أو 15/115 من إجماليّها — وما قُرئت ضريبتُه صفراً لا يُحسب.
 *
 * والحركةُ التي سدّدت فاتورةً محسوبةً لا تُضمّ: ضريبتُها في الفاتورة، وضمُّها يعدّها مرّتين.
 * والتقريبُ مرّةً على المجموع لا على كلّ حركة.
 *
 * **والافتراضُ مكتوب**: كلُّ ما يبيعه المقهى خاضعٌ للنسبة الأساسيّة (١٥٪) — فضريبةُ المخرجات
 * 15/115 من الوارد كلِّه. صنفٌ بنسبة صفر أو قسيمةٌ تُستحقّ ضريبتُها عند استعمالها يكسره.
 */
import type { InputVatStatus } from "./validation";

/** نسبةُ الضريبة في المملكة: ١٥٪ — فالضريبةُ من المبلغ الشامل ١٥ من ١١٥. */
export const VAT_PERCENT = 15;

/** ضريبةٌ داخل مبلغٍ شاملها، بالهللات وبتقريبٍ واحد. */
export function vatInsideGross(grossMinor: number): number {
  return Math.round((grossMinor * VAT_PERCENT) / (100 + VAT_PERCENT));
}

/** ضريبةُ صافٍ قبلها: ١٥٪ منه، بالهللات وبتقريبٍ واحد — ضربٌ صحيح لا `× 0.15` عائماً. */
export function vatOnNet(netMinor: number): number {
  return Math.round((netMinor * VAT_PERCENT) / 100);
}

/* ───────────── الفترة: شهرٌ أو ربعٌ ميلاديّ ───────────── */

export type VatPeriod = { kind: "month"; month: string } | { kind: "quarter"; year: number; quarter: 1 | 2 | 3 | 4 };

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const QUARTER_RE = /^(\d{4})-Q([1-4])$/;

export function parseVatPeriod(raw: string | undefined | null): VatPeriod | null {
  if (!raw) return null;
  const q = raw.match(QUARTER_RE);
  if (q) return { kind: "quarter", year: Number(q[1]), quarter: Number(q[2]) as 1 | 2 | 3 | 4 };
  if (MONTH_RE.test(raw)) return { kind: "month", month: raw };
  return null;
}

export function periodKey(p: VatPeriod): string {
  return p.kind === "month" ? p.month : `${p.year}-Q${p.quarter}`;
}

/** أشهرُ الفترة بترتيبها. */
export function periodMonths(p: VatPeriod): string[] {
  if (p.kind === "month") return [p.month];
  const first = (p.quarter - 1) * 3 + 1;
  return [0, 1, 2].map((i) => `${p.year}-${String(first + i).padStart(2, "0")}`);
}

/** أوّلُ يومٍ في الفترة وأوّلُ يومٍ بعدها (`YYYY-MM-DD`) — نصفُ مفتوح. */
export function periodBounds(p: VatPeriod): { from: string; until: string } {
  const months = periodMonths(p);
  const last = months[months.length - 1];
  const [y, m] = last.split("-").map(Number);
  const until = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from: `${months[0]}-01`, until };
}

/** الربعُ الذي يقع فيه شهر. */
export type VatQuarter = Extract<VatPeriod, { kind: "quarter" }>;

export function quarterOfMonth(month: string): VatQuarter {
  const [y, m] = month.split("-").map(Number);
  return { kind: "quarter", year: y, quarter: (Math.floor((m - 1) / 3) + 1) as 1 | 2 | 3 | 4 };
}

/** الربعُ السابق لربع. */
export function previousQuarter(p: VatQuarter): VatQuarter {
  return p.quarter === 1 ? { kind: "quarter", year: p.year - 1, quarter: 4 } : { kind: "quarter", year: p.year, quarter: (p.quarter - 1) as 1 | 2 | 3 };
}

/** الربعُ التالي لربع. */
export function nextQuarter(p: VatQuarter): VatQuarter {
  return p.quarter === 4 ? { kind: "quarter", year: p.year + 1, quarter: 1 } : { kind: "quarter", year: p.year, quarter: (p.quarter + 1) as 2 | 3 | 4 };
}

/** الأشهرُ الـ`count` السابقة لشهر، بترتيبها. */
export function monthsBefore(month: string, count: number): string[] {
  const [y, m] = month.split("-").map(Number);
  const out: string[] = [];
  for (let i = count; i >= 1; i--) {
    const index = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

/**
 * آخرُ يومٍ لتقديم الإقرار وسداده: آخرُ يومٍ من الشهر التالي لنهاية الفترة (هيئة الزكاة
 * والضريبة والجمارك — للإقرار الربعيّ والشهريّ معاً).
 */
export function filingDeadline(p: VatPeriod): string {
  const { until } = periodBounds(p);
  const [y, m] = until.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${until.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
}

const QUARTER_NAME = ["الأول", "الثاني", "الثالث", "الرابع"] as const;

export function quarterLabel(p: VatQuarter): string {
  return `الربع ${QUARTER_NAME[p.quarter - 1]} ${p.year}`;
}

/* ───────────── الحساب ───────────── */

export interface VatInvoice {
  id: string;
  inputVatStatus: InputVatStatus;
  /** `null` لم تُقرأ ضريبتُها — لا صفر. */
  vatMinor: number | null;
  totalMinor: number;
  /** إقرارُ صاحب المقهى: `true` ضريبيّةٌ على الورقة فتُحسب، `false` لا تُحسب، `null` حكمُ الآلة. */
  choice: boolean | null;
  /**
   * مستندُها ما زال ينتظر المراجعة — قراءةُ نموذجٍ لم يُقرّها أحد، فلا يحكم لها حكمُ الآلة.
   * غيابُه «رُوجعت».
   */
  awaitingReview?: boolean;
  /** الصافي قبل الضريبة إن قُرئ — لوعاء المشتريات في نموذج الهيئة. */
  subtotalMinor?: number | null;
}

/** حكمت لها الآلةُ بالخصم: مستوفيةٌ وضريبتُها مقروءة ومستندُها مُراجَع. */
export function machineEligible(i: Pick<VatInvoice, "inputVatStatus" | "vatMinor" | "awaitingReview">): boolean {
  return i.inputVatStatus === "ELIGIBLE" && i.vatMinor !== null && !i.awaitingReview;
}

/** تُحسب في الخصم؟ — إقرارُ الإنسان يغلب حكمَ الآلة، إلّا ضريبةً قُرئت صفراً: لا شيء فيها يُخصم. */
export function invoiceIncluded(i: VatInvoice): boolean {
  if (i.choice === false) return false;
  if (i.choice === true) return i.vatMinor !== 0;
  return machineEligible(i);
}

/** ضريبتُها في الخصم: المقروءة، وإلّا 15/115 من الإجمالي — لما أقرّه إنسانٌ ضريبيّاً بنسبة ١٥٪. */
export function invoiceVat(i: Pick<VatInvoice, "vatMinor" | "totalMinor">): number {
  return i.vatMinor ?? vatInsideGross(i.totalMinor);
}

export type VatTxCategory = string;

export interface VatTx {
  id: string;
  direction: "DEBIT" | "CREDIT";
  category: VatTxCategory;
  amountMinor: number;
  /** اختيارُ صاحب المقهى إن اختار — `null` يعني «الأصل». */
  choice: boolean | null;
  /** سدّدت فاتورةً ضريبتُها محسوبةٌ في باب الفواتير. */
  coveredByInvoice: boolean;
  /** حوالةٌ ارتدّت أو عودتُها (حُسمت «ارتدّت») — لا شراءَ فيها ولا بيع. */
  bounced?: boolean;
}

/**
 * أبوابُ صادرٍ لا ضريبةَ فيها **في الغالب** — راتبٌ وزكاةٌ وتحويلٌ شخصيّ وحركةٌ داخليّة. لا تُضمّ
 * من نفسها ولا بزرٍّ جماعيّ، **لكنّ اختيارَ صاحب المقهى يغلب**: حوالةٌ «شخصيّة» قد تكون شراءً
 * دُفع من الحساب، وهو من رأى الورقة. مُنعت مرّةً منعاً قاطعاً (٧ أكتوبر ٢٠٢٦) فسقط من الخصم
 * ما اختاره بيده وارتفع المستحقّ — فعادت تنبيهاً لا منعاً.
 */
export const NO_VAT_DEBIT_CATEGORIES: ReadonlySet<string> = new Set(["SALARY", "ZAKAT", "PERSONAL", "INTERNAL"]);

/** بابٌ لا ضريبةَ فيه غالباً — يُنبَّه عليه ولا يُمنع. */
export function txCaution(tx: Pick<VatTx, "direction" | "category">): string | null {
  return tx.direction === "DEBIT" && NO_VAT_DEBIT_CATEGORIES.has(tx.category)
    ? "لا ضريبةَ في هذا الباب غالباً — احسبها إن كانت شراءً بفاتورةٍ ضريبيّة"
    : null;
}

/** لماذا لا تُضمّ هذه الحركة مهما اختير — `null` تُضمّ. */
export function txBlocked(tx: Pick<VatTx, "direction" | "category" | "coveredByInvoice" | "bounced">): string | null {
  if (tx.bounced) return "ارتدّت الحوالة — لا شراءَ فيها ولا بيع";
  if (tx.direction !== "DEBIT") return null;
  if (tx.coveredByInvoice) return "ضريبتُها محسوبةٌ في فاتورتها";
  return null;
}

/** ما مبلغُه هو الضريبة نفسُها، لا مبلغٌ شاملُها. */
const VAT_ITSELF: ReadonlySet<string> = new Set(["POS_VAT", "BANK_VAT"]);

export type TxRole =
  /** واردٌ شاملُ الضريبة — مبيعات */
  | "OUTPUT"
  /** صادرٌ مبلغُه الضريبة نفسُها */
  | "INPUT_VAT"
  /** صادرٌ شاملُ الضريبة — ضريبتُه ١٥/١١٥ منه */
  | "INPUT_GROSS";

export function txRole(tx: Pick<VatTx, "direction" | "category">): TxRole {
  if (tx.direction === "CREDIT") return "OUTPUT";
  return VAT_ITSELF.has(tx.category) ? "INPUT_VAT" : "INPUT_GROSS";
}

/** ما يُضمّ بلا اختيار: تسويةُ الشبكة مبيعات، وضريبةُ الرسوم مدخلات. */
export function includedByDefault(tx: Pick<VatTx, "direction" | "category">): boolean {
  if (tx.direction === "CREDIT") return tx.category === "POS_SETTLEMENT";
  return VAT_ITSELF.has(tx.category);
}

/** أتُعدّ هذه الحركة؟ — والمسدِّدةُ فاتورةً محسوبةً والمرتدّةُ لا تُعدّان ولو اختيرتا. */
export function isIncluded(tx: VatTx): boolean {
  if (txBlocked(tx) !== null) return false;
  return tx.choice ?? includedByDefault(tx);
}

/** ضريبةُ الحركة لو ضُمّت — للعرض بجانبها. */
export function txVat(tx: Pick<VatTx, "direction" | "category" | "amountMinor">): number {
  return txRole(tx) === "INPUT_VAT" ? tx.amountMinor : vatInsideGross(tx.amountMinor);
}

export interface VatReturn {
  /** `grossMinor` وارد البنك وحده؛ و`cashGrossMinor` نقدٌ لم يُودَع كتبه صاحبُه — والضريبةُ من مجموعهما. */
  output: { grossMinor: number; vatMinor: number; count: number; cashGrossMinor: number; netMinor: number };
  input: {
    invoices: {
      vatMinor: number;
      count: number;
      /** منها بإقرارك — وما حُسبت ضريبتُه 15/115 من إجماليّه لأنّها لم تُقرأ. */
      confirmed: { count: number; vatMinor: number; derivedCount: number };
    };
    bankVat: { vatMinor: number; count: number };
    selected: { grossMinor: number; vatMinor: number; count: number };
    totalMinor: number;
    /** وعاءُ المشتريات المحسوبة قبل الضريبة — الصافي المقروء، وإلّا الإجماليّ ناقصاً الضريبة. */
    baseMinor: number;
  };
  /** فواتيرُ الفترة التي لا تُخصم ضريبتُها — تُعرض كي لا تضيع بصمت. */
  notDeductible: { count: number; vatKnownMinor: number; vatUnknownCount: number };
  /** مشترياتٌ قُرئت ضريبتُها صفراً — صفريّةٌ أو معفاة، لا «ركنٌ نقص». */
  zeroRated: { count: number; totalMinor: number };
  /** رصيدٌ دائنٌ مرحَّل من الفترة السابقة — موجبٌ يُنقص المستحقّ. */
  carriedInMinor: number;
  /** موجبٌ: يُسدَّد. سالبٌ: رصيدٌ لك يُستردّ أو يُرحَّل. */
  netMinor: number;
}

export interface VatReturnInput {
  invoices: readonly VatInvoice[];
  txs: readonly VatTx[];
  /** مبيعاتٌ نقديّة لم تُودَع، شاملةَ الضريبة — يكتبها صاحبُ المقهى. غيابُها «لم يُكتب شيء». */
  cashSalesGrossMinor?: number;
  /** رصيدٌ دائنٌ رُحِّل من إقرار الفترة السابقة المقدَّم. */
  carriedInMinor?: number;
}

export function computeVatReturn(input: VatReturnInput): VatReturn {
  const eligible = input.invoices.filter(invoiceIncluded);
  const rest = input.invoices.filter((i) => !invoiceIncluded(i));
  const confirmed = eligible.filter((i) => i.choice === true && !machineEligible(i));
  const zero = input.invoices.filter((i) => i.vatMinor === 0);
  const cashGross = input.cashSalesGrossMinor ?? 0;
  const carriedIn = input.carriedInMinor ?? 0;

  let outGross = 0, outCount = 0;
  let bankVat = 0, bankVatCount = 0;
  let selGross = 0, selCount = 0;
  for (const tx of input.txs) {
    if (!isIncluded(tx)) continue;
    const role = txRole(tx);
    if (role === "OUTPUT") { outGross += tx.amountMinor; outCount++; }
    else if (role === "INPUT_VAT") { bankVat += tx.amountMinor; bankVatCount++; }
    else { selGross += tx.amountMinor; selCount++; }
  }

  const invoicesVat = eligible.reduce((s, i) => s + invoiceVat(i), 0);
  const outputVat = vatInsideGross(outGross + cashGross);
  const selectedVat = vatInsideGross(selGross);
  const inputTotal = invoicesVat + bankVat + selectedVat;
  /* ضريبةُ الرسوم مبلغُها الضريبةُ نفسُها: وعاؤها 100/15 منها */
  const invoicesBase = eligible.reduce((s, i) => s + (i.subtotalMinor ?? i.totalMinor - invoiceVat(i)), 0);
  const inputBase = invoicesBase + (selGross - selectedVat) + Math.round((bankVat * 100) / VAT_PERCENT);

  return {
    output: {
      grossMinor: outGross, vatMinor: outputVat, count: outCount,
      cashGrossMinor: cashGross, netMinor: outGross + cashGross - outputVat,
    },
    input: {
      invoices: {
        vatMinor: invoicesVat,
        count: eligible.length,
        confirmed: {
          count: confirmed.length,
          vatMinor: confirmed.reduce((s, i) => s + invoiceVat(i), 0),
          derivedCount: confirmed.filter((i) => i.vatMinor === null).length,
        },
      },
      bankVat: { vatMinor: bankVat, count: bankVatCount },
      selected: { grossMinor: selGross, vatMinor: selectedVat, count: selCount },
      totalMinor: inputTotal,
      baseMinor: inputBase,
    },
    notDeductible: {
      count: rest.length,
      vatKnownMinor: rest.reduce((s, i) => s + (i.vatMinor ?? 0), 0),
      vatUnknownCount: rest.filter((i) => i.vatMinor === null).length,
    },
    zeroRated: { count: zero.length, totalMinor: zero.reduce((s, i) => s + i.totalMinor, 0) },
    carriedInMinor: carriedIn,
    netMinor: outputVat - inputTotal - carriedIn,
  };
}
