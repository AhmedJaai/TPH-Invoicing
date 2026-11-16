/**
 * فواتيرُ يُحتمل غيابُها — الشهودُ كلُّهم على مورّدٍ واحد في موضعٍ واحد.
 *
 * ── لماذا ──
 *
 * الفاتورةُ الغائبة ليست في أرشيفنا أصلاً، فلا يكشفها إلّا شاهدٌ من خارجه. وكان لكلّ شاهدٍ
 * صفحتُه: كشفُ المورّد في «الكشوف»، وما أُدخل في فودكس في «فودكس والفواتير»، والحوالةُ بلا
 * فاتورة في «يحتاج قرارك». فمن لم يرسل كشفاً — وهم أكثرُ المورّدين — لا يُسأل عنه في موضعٍ
 * يُرى، ولا يُعرف أيُّ مورّدٍ **لا شاهدَ عليه بتاتاً**.
 *
 * ── وما لا تفعله ──
 *
 * قراءةٌ فوق الدفاتر: لا تُنشئ فاتورةً ولا تمسّ مالاً. والسطرُ هنا «يُحتمل» لا «غاب»: الحكمُ
 * لصاحب المقهى أمام المورّد. وشاهدان اتّفقا على المبلغ واليوم أقوى من شاهدٍ واحد — يُدمَجان
 * سطراً واحداً بشاهدَيه، ولا يُعدّ المبلغُ مرّتين.
 */
import { TOTAL_ROUNDING_TOLERANCE_MINOR } from "@/lib/money";
import { addDays, daysBetween } from "@/lib/riyadh-time";

/** نافذةُ اتّفاق شاهدَين على واقعةٍ واحدة — أسبوعٌ كنافذة مطابقة الكشف. */
export const WITNESS_WINDOW_DAYS = 7;
/** كشفٌ انتهى قبل أكثر من هذا لا يشهد على ما بعده. */
export const STALE_STATEMENT_DAYS = 45;
/** المورّدُ «نشِط» إن كانت له فاتورةٌ في هذه المدّة. */
export const ACTIVE_WINDOW_DAYS = 90;
/**
 * «لا شاهد عليه» يُسأل لمن يتكرّر تعاملُه — فاتورتان فأكثر في المدّة. شراءُ معدّاتٍ مرّةً واحدة
 * لا كشفَ يُطلب له ولا فودكس يتابعه، وعدُّه «أعمى» ضجيجٌ يُخفي المورّدَ الأسبوعيّ بجانبه.
 */
export const BLIND_MIN_INVOICES = 2;
/**
 * أقصرُ فجوةٍ بين كشفين تُعرَض. مدّةُ الكشف تُشتقّ من تواريخ أسطره لا من عنوانه، فيومان بين
 * كشف يوليو وكشف أغسطس أيّامٌ بلا توريد لا أيّامٌ بلا كشف (غاناش: أربعُ فجواتٍ من يومٍ إلى أربعة).
 */
export const COVER_GAP_MIN_DAYS = 7;

export type WitnessKind = "STATEMENT" | "FOODICS";

export const WITNESS_LABEL: Record<WitnessKind, string> = {
  STATEMENT: "في كشف المورّد",
  FOODICS: "أُدخلت في فودكس",
};

/** سطرٌ مدينٌ في آخر كشفٍ للمورّد لا فاتورةَ له عندنا. */
export interface StatementWitness {
  supplierId: string;
  ref: string | null;
  day: string;
  amountMinor: number;
  /** مرجعُه لا يُقرأ — قد تكون عندنا برقمٍ آخر. */
  unclear: boolean;
}

/** حركةُ شراءٍ مرحّلة في فودكس لمورّدٍ مربوط، ولا فاتورةَ تقابلها. */
export interface FoodicsWitness {
  supplierId: string;
  purchaseId: string;
  invoiceNumber: string | null;
  day: string;
  amountMinor: number;
}

/** مالٌ خرج للمورّد ولم تفسّره فاتورة. */
export interface PaymentWitness {
  supplierId: string;
  paymentId: string;
  day: string;
  unbackedMinor: number;
}

export interface SupplierFacts {
  id: string;
  name: string;
  slug: string;
  issuesInvoices: boolean;
  issuesStatements: boolean;
  /** أمورّدُ فودكس مربوطٌ به؟ — عندها كلُّ شراءٍ يُدخَل هناك شاهدٌ عليه. */
  foodicsLinked: boolean;
  lastInvoiceDay: string | null;
  /** فواتيرُه في مدّة النشاط: عددُها ومجموعُها. */
  recentInvoices: number;
  recentBilledMinor: number;
  /** مدَدُ كشوفه المؤرشفة — `YYYY-MM-DD`. */
  statements: readonly { from: string; to: string }[];
}

export interface MissingInvoice {
  /** مفتاحٌ ثابت للعرض. */
  key: string;
  day: string;
  amountMinor: number;
  ref: string | null;
  witnesses: WitnessKind[];
  unclear: boolean;
  foodicsPurchaseId: string | null;
}

export type StatementCover =
  | { state: "DOES_NOT_ISSUE" }
  | { state: "NEVER" }
  | {
      state: "COVERED";
      through: string;
      /** أيّامٌ مضت منذ آخر يومٍ غطّاه كشف. */
      staleDays: number;
      /** أيّامٌ بين كشفين لم يغطّها أيٌّ منهما — فاتورةٌ فيها لا يفحصها كشف. */
      gaps: { from: string; to: string; days: number }[];
    };

export interface SupplierBoardRow {
  supplier: SupplierFacts;
  invoices: MissingInvoice[];
  /** مجموعُ ما يُحتمل غيابُه — كلُّ واقعةٍ مرّةً واحدة ولو شهد عليها اثنان. */
  missingMinor: number;
  payments: PaymentWitness[];
  unbackedMinor: number;
  cover: StatementCover;
  /** نشِطٌ ولا شاهدَ خارجيَّ عليه: لا كشفٌ حديث ولا فودكس. */
  blind: boolean;
}

export interface MissingBoard {
  /** من عليه قرينةٌ — الأكبرُ مبلغاً أوّلاً. */
  withLeads: SupplierBoardRow[];
  /** من لا قرينةَ عليه **ولا شاهد** — الأكبرُ تعاملاً أوّلاً. */
  blind: SupplierBoardRow[];
  /** نشِطون عليهم شاهدٌ ولا قرينة — عددُهم يُقال ليُعرف أنّ الصمتَ عن فحص. */
  clearCount: number;
  /** بلا شاهدٍ وتعاملُهم مرّةٌ واحدة في المدّة — لا يُسألون، ويُقال عددُهم كي لا يُظنّوا مفحوصين. */
  oneOffCount: number;
  /**
   * أيّامٌ بين كشفين لمورّدٍ نشِط لم يغطّها أيٌّ منهما — فاتورةٌ فيها لا يفحصها كشف.
   * الأطولُ أوّلاً.
   */
  coverGaps: { supplier: SupplierFacts; from: string; to: string; days: number }[];
  totals: {
    invoices: number;
    missingMinor: number;
    /** منها ما اتّفق عليه شاهدان. */
    confirmedByTwo: number;
    unbackedMinor: number;
  };
}

/** يضمّ المدَد المتداخلة والمتلاصقة، مرتّبةً. */
function mergeRanges(ranges: readonly { from: string; to: string }[]): { from: string; to: string }[] {
  const sorted = ranges.filter((r) => r.from <= r.to).map((r) => ({ ...r })).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const out: { from: string; to: string }[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= addDays(last.to, 1)) {
      if (r.to > last.to) last.to = r.to;
    } else {
      out.push(r);
    }
  }
  return out;
}

/** بمَ يشهد كشفُ المورّد: إلى أيّ يومٍ، وكم مضى بعده، وأيُّ أيّامٍ سقطت بين كشفين. */
export function statementCover(
  supplier: Pick<SupplierFacts, "issuesStatements" | "statements">,
  today: string,
): StatementCover {
  const merged = mergeRanges(supplier.statements);
  if (merged.length === 0) return supplier.issuesStatements ? { state: "NEVER" } : { state: "DOES_NOT_ISSUE" };
  const gaps: { from: string; to: string; days: number }[] = [];
  for (let i = 1; i < merged.length; i++) {
    const from = addDays(merged[i - 1].to, 1);
    const to = addDays(merged[i].from, -1);
    gaps.push({ from, to, days: daysBetween(from, to) + 1 });
  }
  const through = merged[merged.length - 1].to;
  return { state: "COVERED", through, staleDays: Math.max(0, daysBetween(through, today)), gaps };
}

/**
 * يدمج شاهدَي المورّد الواحد: سطرُ كشفٍ وحركةُ فودكس بالمبلغ نفسِه (بتسامح الريال) وبينهما
 * أسبوعٌ فأقلّ واقعةٌ واحدة. واحدةٌ بواحدة، الأقربُ يوماً أوّلاً، والترتيبُ ثابت — فالنتيجةُ
 * لا تتغيّر بترتيب الصفوف.
 */
export function mergeWitnesses(
  statement: readonly StatementWitness[],
  foodics: readonly FoodicsWitness[],
): MissingInvoice[] {
  const lines = [...statement].sort((a, b) => a.day.localeCompare(b.day) || a.amountMinor - b.amountMinor || (a.ref ?? "").localeCompare(b.ref ?? ""));
  const moves = [...foodics].sort((a, b) => a.day.localeCompare(b.day) || a.purchaseId.localeCompare(b.purchaseId));

  const pairs: { line: number; move: number; off: number }[] = [];
  lines.forEach((l, li) => {
    moves.forEach((m, mi) => {
      if (Math.abs(l.amountMinor - m.amountMinor) > TOTAL_ROUNDING_TOLERANCE_MINOR) return;
      const off = Math.abs(daysBetween(l.day, m.day));
      if (off <= WITNESS_WINDOW_DAYS) pairs.push({ line: li, move: mi, off });
    });
  });
  pairs.sort((a, b) => a.off - b.off || a.line - b.line || a.move - b.move);

  const moveOfLine = new Map<number, number>();
  const takenMoves = new Set<number>();
  for (const p of pairs) {
    if (moveOfLine.has(p.line) || takenMoves.has(p.move)) continue;
    moveOfLine.set(p.line, p.move);
    takenMoves.add(p.move);
  }

  const out: MissingInvoice[] = [];
  lines.forEach((l, li) => {
    const mi = moveOfLine.get(li);
    const m = mi === undefined ? null : moves[mi];
    out.push({
      key: `st:${l.day}:${l.amountMinor}:${l.ref ?? ""}:${li}`,
      day: l.day,
      amountMinor: l.amountMinor,
      /* رقمُ الكشف أوثق؛ وإن لم يُقرأ فرقمُ فودكس */
      ref: l.unclear ? m?.invoiceNumber ?? l.ref : l.ref ?? m?.invoiceNumber ?? null,
      witnesses: m ? ["STATEMENT", "FOODICS"] : ["STATEMENT"],
      /* شاهدٌ ثانٍ بالمبلغ واليوم يرفع الالتباس عن مرجعٍ لم يُقرأ */
      unclear: l.unclear && m === null,
      foodicsPurchaseId: m?.purchaseId ?? null,
    });
  });
  moves.forEach((m, mi) => {
    if (takenMoves.has(mi)) return;
    out.push({
      key: `fx:${m.purchaseId}`,
      day: m.day,
      amountMinor: m.amountMinor,
      ref: m.invoiceNumber,
      witnesses: ["FOODICS"],
      unclear: false,
      foodicsPurchaseId: m.purchaseId,
    });
  });
  return out.sort((a, b) => b.amountMinor - a.amountMinor || a.day.localeCompare(b.day) || a.key.localeCompare(b.key));
}

/** أعلى هذا المورّد شاهدٌ من خارج أرشيفنا؟ — فودكس مربوط، أو كشفٌ لم يقدُم. */
function hasOutsideWitness(s: SupplierFacts, cover: StatementCover): boolean {
  if (s.foodicsLinked) return true;
  return cover.state === "COVERED" && cover.staleDays <= STALE_STATEMENT_DAYS;
}

export interface MissingBoardInput {
  suppliers: readonly SupplierFacts[];
  statement: readonly StatementWitness[];
  foodics: readonly FoodicsWitness[];
  payments: readonly PaymentWitness[];
  /** `YYYY-MM-DD` بتوقيت الرياض. */
  today: string;
}

export function buildMissingBoard(input: MissingBoardInput): MissingBoard {
  const group = <T extends { supplierId: string }>(rows: readonly T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.supplierId, [...(m.get(r.supplierId) ?? []), r]);
    return m;
  };
  const statementBy = group(input.statement);
  const foodicsBy = group(input.foodics);
  const paymentsBy = group(input.payments);

  const withLeads: SupplierBoardRow[] = [];
  const blind: SupplierBoardRow[] = [];
  let clearCount = 0;
  let oneOffCount = 0;
  const coverGaps: MissingBoard["coverGaps"] = [];

  for (const supplier of input.suppliers) {
    const invoices = mergeWitnesses(statementBy.get(supplier.id) ?? [], foodicsBy.get(supplier.id) ?? []);
    const payments = [...(paymentsBy.get(supplier.id) ?? [])].sort((a, b) => b.unbackedMinor - a.unbackedMinor || a.paymentId.localeCompare(b.paymentId));
    const cover = statementCover(supplier, input.today);
    const active = supplier.recentInvoices > 0;
    if (active && cover.state === "COVERED") {
      for (const g of cover.gaps) if (g.days >= COVER_GAP_MIN_DAYS) coverGaps.push({ supplier, ...g });
    }
    /* من لا يصدر فواتير لا فاتورةَ له تغيب — حوالتُه هي الشراء نفسُه */
    const isBlind = supplier.recentInvoices >= BLIND_MIN_INVOICES && supplier.issuesInvoices && !hasOutsideWitness(supplier, cover);
    const row: SupplierBoardRow = {
      supplier, invoices,
      missingMinor: invoices.reduce((s, i) => s + i.amountMinor, 0),
      payments,
      unbackedMinor: payments.reduce((s, p) => s + p.unbackedMinor, 0),
      cover, blind: isBlind,
    };
    if (invoices.length > 0 || payments.length > 0) withLeads.push(row);
    else if (isBlind) blind.push(row);
    else if (!active) continue;
    else if (supplier.issuesInvoices && !hasOutsideWitness(supplier, cover)) oneOffCount++;
    else clearCount++;
  }

  withLeads.sort((a, b) =>
    (b.missingMinor + b.unbackedMinor) - (a.missingMinor + a.unbackedMinor) || a.supplier.name.localeCompare(b.supplier.name, "ar"));
  blind.sort((a, b) => b.supplier.recentBilledMinor - a.supplier.recentBilledMinor || a.supplier.name.localeCompare(b.supplier.name, "ar"));

  coverGaps.sort((a, b) => b.days - a.days || a.supplier.name.localeCompare(b.supplier.name, "ar") || a.from.localeCompare(b.from));

  const all = withLeads.flatMap((r) => r.invoices);
  return {
    withLeads, blind, clearCount, oneOffCount, coverGaps,
    totals: {
      invoices: all.length,
      missingMinor: all.reduce((s, i) => s + i.amountMinor, 0),
      confirmedByTwo: all.filter((i) => i.witnesses.length > 1).length,
      unbackedMinor: withLeads.reduce((s, r) => s + r.unbackedMinor, 0),
    },
  };
}
