/**
 * شاهدُ المبيعات — ما يقوله ملفُّ فودكس المستورَد بجانب ما حسبه الإقرار.
 *
 * ضريبةُ المبيعات في الإقرار من وارد البنك ومن النقد الذي يكتبه صاحبُ المقهى بيده.
 * وملفُّ فودكس يحمل ضريبةَ كلّ بيعة. فهو **شاهدٌ** على الرقم المكتوب: يُعرض بجانبه
 * ويُقال الفرق — **ولا يكتب فوقه ولا يدخل الإقرار**. اختيارُ صاحبه يمضي كما كتبه.
 *
 * والشاهدُ الناقص يُقال ناقصاً: «يغطّي ٢٧ يوماً من ٣٠». وما لا ملفَّ له `null`
 * («لا ملفَّ لهذا الشهر») لا صفر — صفرٌ هنا يقول إنّ المقهى لم يبع شيئاً.
 */

export interface WitnessDay {
  /** `YYYY-MM-DD` — يومُ العمل في ملفّ فودكس. */
  day: string;
  /** ما بيع في اليوم كما في الملفّ (بلا الملغى) — قبل الضريبة أو شاملَها بحسب إعداد فودكس. */
  salesMinor: number;
  vatMinor: number;
  refundMinor: number;
}

export interface SalesWitnessInput {
  /** `YYYY-MM` */
  month: string;
  /** اليوم بتوقيت الرياض — الشهرُ الجاري يُقاس حتى أمس. */
  today: string;
  days: readonly WitnessDay[];
  /** ضريبةُ المبيعات التي حسبها الإقرار لهذا الشهر (وارد البنك + النقد المكتوب). */
  returnOutputVatMinor: number;
  /** النقدُ الذي كتبه صاحبُه — `null` لم يُكتب. */
  cashTypedGrossMinor: number | null;
}

export type WitnessVerdict =
  /** لا ملفَّ مبيعات لهذا الشهر — لا شاهد. */
  | "NO_FILE"
  /** الفرقُ داخل السماحة. */
  | "AGREES"
  /** فودكس يقول ضريبةً أكثر ممّا في الإقرار. */
  | "FOODICS_HIGHER"
  /** الإقرارُ أعلى ممّا يقوله فودكس. */
  | "RETURN_HIGHER";

export interface SalesWitness {
  month: string;
  verdict: WitnessVerdict;
  /** أيّامُ الشهر التي يُنتظر لها مبيعات (حتى أمس للشهر الجاري). */
  expectedDays: number;
  /** أيّامٌ فيها مبيعاتٌ مستوردة. */
  coveredDays: number;
  salesMinor: number | null;
  vatMinor: number | null;
  refundMinor: number | null;
  returnOutputVatMinor: number;
  cashTypedGrossMinor: number | null;
  /** ضريبةُ فودكس − ضريبةُ الإقرار. `null` بلا ملفّ. */
  vatGapMinor: number | null;
  /**
   * ما يقابل فرقَ الضريبة مبيعاتٍ شاملةَ الضريبة (×115/15) — «كم ريالاً مبيعاتٍ يفسّره».
   * `null` بلا ملفّ.
   */
  grossGapMinor: number | null;
}

/** فرقٌ دون هذا في ضريبة الشهر تقريبُ هللاتٍ على مئات البيعات — لا يُقال فرقاً. */
export const WITNESS_VAT_TOLERANCE_MINOR = 500;

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** أيّامُ الشهر المنتظَرة: كلُّه إن انقضى، وحتى أمس إن كان جارياً، وصفرٌ إن لم يبدأ. */
export function expectedDaysOf(month: string, today: string): number {
  const total = daysInMonth(month);
  const thisMonth = today.slice(0, 7);
  if (month < thisMonth) return total;
  if (month > thisMonth) return 0;
  return Math.max(0, Math.min(total, Number(today.slice(8, 10)) - 1));
}

export function buildSalesWitness(input: SalesWitnessInput): SalesWitness {
  const inMonth = input.days.filter((d) => d.day.startsWith(`${input.month}-`));
  const expectedDays = expectedDaysOf(input.month, input.today);
  const base = {
    month: input.month,
    expectedDays,
    returnOutputVatMinor: input.returnOutputVatMinor,
    cashTypedGrossMinor: input.cashTypedGrossMinor,
  };
  if (inMonth.length === 0) {
    return {
      ...base, verdict: "NO_FILE", coveredDays: 0,
      salesMinor: null, vatMinor: null, refundMinor: null, vatGapMinor: null, grossGapMinor: null,
    };
  }
  const coveredDays = new Set(inMonth.filter((d) => d.day < input.today || input.month < input.today.slice(0, 7)).map((d) => d.day)).size;
  const salesMinor = inMonth.reduce((s, d) => s + d.salesMinor, 0);
  const vatMinor = inMonth.reduce((s, d) => s + d.vatMinor, 0);
  const refundMinor = inMonth.reduce((s, d) => s + d.refundMinor, 0);
  const vatGapMinor = vatMinor - input.returnOutputVatMinor;
  return {
    ...base,
    verdict: Math.abs(vatGapMinor) <= WITNESS_VAT_TOLERANCE_MINOR ? "AGREES" : vatGapMinor > 0 ? "FOODICS_HIGHER" : "RETURN_HIGHER",
    coveredDays,
    salesMinor, vatMinor, refundMinor,
    vatGapMinor,
    /* 15 من كلّ 115: الضريبةُ × 115 ÷ 15 — عددٌ صحيح بالتقريب إلى الهللة */
    grossGapMinor: Math.sign(vatGapMinor) * Math.round((Math.abs(vatGapMinor) * 115) / 15),
  };
}
