/**
 * مراقبةُ تسويات الشبكة — من حركات البنك وحدها، بلا بياناتٍ جديدة.
 *
 * سؤالان لم يكن لهما جواب:
 *
 *   ١. كم تأخذ الشبكةُ فعلاً؟ — الرسمُ ÷ التسوية، شهراً بشهر.
 *      على ٨٤٠ ألفاً من التسويات عُشرُ نقطةٍ = ٨٤٠ ريالاً.
 *   ٢. أيُّ يومِ بيعٍ لم تصل تسويتُه؟ — الغائبُ لا يُرى في جدول، فيُحسب.
 *
 * وتُبنى على `groupBatches` (كانت مبنيّةً ولا يستدعيها أحد): الدفعةُ تجمع
 * التسويةَ برسمها وضريبته بمفتاحٍ واحد (التاجر · يومُ البيع · الشبكة).
 *
 * دوالُّ خالصة. والنسبةُ بنقاط الأساس عدداً صحيحاً (١٠٠ نقطة = ١٪)،
 * وما لا مقامَ له `null` لا صفر: شهرٌ بلا تسوياتٍ لا «نسبتُه ٠».
 */
import { groupBatches, recognizePos, type PosDetails } from "./pos";
import { isoDay } from "@/lib/riyadh-time";

export type PosKind = PosDetails["kind"];

export interface PosTx {
  id: string;
  /** يومُ القيمة بتوقيت الرياض — YYYY-MM-DD. */
  day: string;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  /** بابُ الحركة كما هو في القاعدة — وهو الحَكَم إن خالف ما يُقرأ من الوصف. */
  kind: PosKind;
  description: string | null;
  transactionType: string | null;
}

/**
 * رمزُ التسوية باسمٍ يُقرأ — لما ثبت معناه في كشوف المقهى وحده (`MC` · `VC`).
 * وغيرُه يُعرض برمزه كما كتبه البنك: اسمٌ مخمَّن لشبكةٍ خبرٌ كاذب.
 */
const KNOWN_SCHEME: Record<string, string> = {
  MC: "ماستركارد",
  VC: "فيزا",
};

export function schemeLabel(code: string | undefined): string {
  if (!code) return "رمزٌ لم يُقرأ";
  const c = code.toUpperCase();
  return KNOWN_SCHEME[c] ? `${KNOWN_SCHEME[c]} (${c})` : `رمز ${c}`;
}

/** `260718` ← `2026-07-18`، و`null` لما ليس تاريخاً. */
export function batchDay(batchDate: string | undefined): string | null {
  if (!batchDate || !/^\d{6}$/.test(batchDate)) return null;
  const mm = Number(batchDate.slice(2, 4));
  const dd = Number(batchDate.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `20${batchDate.slice(0, 2)}-${batchDate.slice(2, 4)}-${batchDate.slice(4, 6)}`;
}

/** نسبةٌ بنقاط الأساس — `null` حين لا مقام. */
export function rateBp(feeMinor: number, settlementMinor: number): number | null {
  if (settlementMinor <= 0) return null;
  return Math.round((feeMinor * 10_000) / settlementMinor);
}

interface Read {
  tx: PosTx;
  /** رمزُ الشبكة كما في الوصف — `?` إن لم يُقرأ. */
  code: string;
  /** يومُ البيع من الوصف — `null` إن لم يحمله. */
  saleDay: string | null;
  pos: PosDetails;
}

function read(tx: PosTx): Read {
  const seen = recognizePos(tx.description, tx.direction, tx.transactionType);
  const pos: PosDetails = { ...(seen ?? {}), kind: tx.kind };
  return { tx, code: pos.scheme?.toUpperCase() ?? "?", saleDay: batchDay(pos.batchDate), pos };
}

/* ─────────────────────────── النسبةُ الفعليّة ─────────────────────────── */

/** ما وصل تسويةً برمز شبكته — الرسمُ لا يُنسب إلى شبكة: رمزُه غيرُ رمز تسويته. */
export interface SchemeSettlement {
  code: string;
  label: string;
  settlementMinor: number;
  count: number;
}

export interface MonthFees {
  month: string;
  settlementMinor: number;
  /** رسومٌ تتبع التسويات (لكلّ عمليّة). */
  feeMinor: number;
  /** رسومٌ لا تتبع دفعة — الرسمُ الشهريّ للجهاز ونحوه. تُعرض وحدها ولا تدخل النسبة. */
  fixedFeeMinor: number;
  vatMinor: number;
  rateBp: number | null;
  /** وسيطُ نسب الأشهر السابقة (ثلاثةٌ على الأقلّ) — `null` «لا عادةَ تُعرف بعد». */
  usualBp: number | null;
  /** ما زاد عن العادة بالريال على تسويات هذا الشهر — `null` حيث لا عادة أو لا زيادة. */
  excessMinor: number | null;
  schemes: SchemeSettlement[];
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** كم شهراً سابقاً يلزم لتُعرف «العادة». */
export const USUAL_MIN_MONTHS = 3;
/** وكم يُؤخذ منها على الأكثر — الأقربُ فالأقرب. */
export const USUAL_WINDOW_MONTHS = 6;

/**
 * الرسومُ شهراً بشهر — الأحدثُ أوّلاً.
 *
 * الشهرُ شهرُ **قيمة الحركة** في البنك: هكذا تُقرأ في الكشف وهكذا تدخل الإقرار.
 * والنسبةُ للشبكات مجتمعةً: رمزُ الرسم في الكشف غيرُ رمز تسويته، فنسبتُه إلى
 * شبكةٍ بعينها تخمين. وما لا يحمل يومَ دفعةٍ من الرسوم (رسمُ الجهاز
 * الشهريّ) يُعزل: هو مبلغٌ ثابت، وضمُّه إلى النسبة يرفعها في شهرٍ قليلِ البيع
 * فيُقرأ ارتفاعاً في السعر وهو ليس كذلك.
 */
export function monthlyFees(rows: readonly PosTx[]): MonthFees[] {
  const byMonth = new Map<string, Read[]>();
  for (const tx of rows) {
    const month = tx.day.slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), read(tx)]);
  }

  const months = [...byMonth.keys()].sort();
  const out: MonthFees[] = [];
  for (const month of months) {
    const list = byMonth.get(month) ?? [];
    const schemes = new Map<string, SchemeSettlement>();
    let settlementMinor = 0;
    let feeMinor = 0;
    let fixedFeeMinor = 0;
    let vatMinor = 0;
    for (const r of list) {
      if (r.tx.kind === "POS_SETTLEMENT") {
        settlementMinor += r.tx.amountMinor;
        const s = schemes.get(r.code) ?? { code: r.code, label: schemeLabel(r.pos.scheme), settlementMinor: 0, count: 0 };
        s.settlementMinor += r.tx.amountMinor;
        s.count++;
        schemes.set(r.code, s);
      } else if (r.tx.kind === "POS_VAT") {
        vatMinor += r.tx.amountMinor;
      } else if (r.saleDay === null) {
        fixedFeeMinor += r.tx.amountMinor;
      } else {
        feeMinor += r.tx.amountMinor;
      }
    }
    const perScheme = [...schemes.values()].sort((a, b) => b.settlementMinor - a.settlementMinor);
    const rate = rateBp(feeMinor, settlementMinor);

    const prior = out
      .slice(-USUAL_WINDOW_MONTHS)
      .flatMap((m) => (m.rateBp === null ? [] : [m.rateBp]));
    const usualBp = prior.length >= USUAL_MIN_MONTHS ? median(prior) : null;
    const excessMinor =
      rate !== null && usualBp !== null && rate > usualBp
        ? Math.round(((rate - usualBp) * settlementMinor) / 10_000)
        : null;

    out.push({ month, settlementMinor, feeMinor, fixedFeeMinor, vatMinor, rateBp: rate, usualBp, excessMinor, schemes: perScheme });
  }
  return out.reverse();
}

/** أيُّ ارتفاعٍ عن العادة يستحقّ أن يُقال: خمسُ نقاط أساسٍ وخمسون ريالاً معاً. */
export const FEE_RISE_MIN_BP = 5;
export const FEE_RISE_MIN_MINOR = 50_00;

export function feeRose(m: Pick<MonthFees, "rateBp" | "usualBp" | "excessMinor">): boolean {
  return (
    m.rateBp !== null && m.usualBp !== null && m.excessMinor !== null &&
    m.rateBp - m.usualBp >= FEE_RISE_MIN_BP && m.excessMinor >= FEE_RISE_MIN_MINOR
  );
}

/* ─────────────────────────── أيّامُ التسوية ─────────────────────────── */

export interface SettlementDay {
  /** يومُ البيع إن حمله الوصف، وإلّا يومُ القيمة. */
  day: string;
  settlementMinor: number;
  feeMinor: number;
  vatMinor: number;
  netMinor: number;
  /** كم دفعةً (شبكةً) وصلت لهذا اليوم. */
  batches: number;
  /** أُخذ اليومُ من يوم القيمة لأنّ الوصف لا يحمل يومَ البيع. */
  byValueDate: boolean;
}

/**
 * لكلّ يومِ بيعٍ ما وصل له — مجموعاً من دفعاته (`groupBatches`). الأحدثُ أوّلاً.
 * وما لا مفتاحَ دفعةٍ له (وصفٌ صامت) يُنسب إلى يوم قيمته، ويُقال ذلك.
 */
export function settlementDays(rows: readonly PosTx[]): SettlementDay[] {
  const keyed: { pos: PosDetails; amountMinor: number }[] = [];
  const loose: Read[] = [];
  for (const tx of rows) {
    const r = read(tx);
    if (r.saleDay && r.pos.merchantId) keyed.push({ pos: r.pos, amountMinor: tx.amountMinor });
    else loose.push(r);
  }

  const days = new Map<string, SettlementDay>();
  const at = (day: string, byValueDate: boolean): SettlementDay => {
    const d = days.get(day) ?? { day, settlementMinor: 0, feeMinor: 0, vatMinor: 0, netMinor: 0, batches: 0, byValueDate };
    days.set(day, d);
    return d;
  };

  for (const b of groupBatches(keyed)) {
    /* المفتاح `تاجر:YYMMDD:شبكة` — واليومُ قسمُه الأوسط */
    const day = batchDay(b.key.split(":")[1]);
    if (!day) continue;
    const d = at(day, false);
    d.settlementMinor += b.settlementMinor;
    d.feeMinor += b.feeMinor;
    d.vatMinor += b.vatMinor;
    if (b.settlementMinor > 0) d.batches++;
  }
  for (const r of loose) {
    const d = at(r.tx.day, true);
    if (r.tx.kind === "POS_SETTLEMENT") {
      d.settlementMinor += r.tx.amountMinor;
      d.batches++;
    }
    if (r.tx.kind === "POS_FEE") d.feeMinor += r.tx.amountMinor;
    if (r.tx.kind === "POS_VAT") d.vatMinor += r.tx.amountMinor;
  }

  return [...days.values()]
    .map((d) => ({ ...d, netMinor: d.settlementMinor - d.feeMinor - d.vatMinor }))
    .sort((a, b) => b.day.localeCompare(a.day));
}

function shift(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return isoDay(new Date(Date.UTC(y, m - 1, d + n)));
}

function weekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** كم يوماً تُمهَل التسويةُ قبل أن يُسأل عنها — يوما عملٍ وعطلةُ الأسبوع. */
export const SETTLEMENT_GRACE_DAYS = 4;
/** كم أسبوعاً سابقاً يُنظر فيه لمعرفة «أهذا يومٌ يفتح فيه المقهى عادةً؟». */
export const USUAL_WEEKS = 6;
/** وكم منها يجب أن تكون فيه تسويةٌ ليُعدّ اليومُ معتاداً. */
export const USUAL_WEEKS_MIN = 4;

export interface MissingSettlement {
  day: string;
  /** وسيطُ ما يصل في مثل هذا اليوم من الأسبوع — تقديرٌ لما غاب، لا مبلغٌ واقع. */
  usualMinor: number | null;
  /** كم أسبوعاً من الستّة السابقة كان في مثله تسوية. */
  seenWeeks: number;
}

/** مفتاحُ قرار الإنسان في يومٍ غائب — يُشتقّ من اليوم ولا يُولَّد. */
export function missingSettlementKey(day: string): string {
  return `pos-missing:${day}`;
}

/**
 * أيّامُ بيعٍ لم تصل تسويتُها.
 *
 * يُسأل عن اليوم إن اجتمعت ثلاثة:
 *   - لا تسويةَ له (لا بيوم بيعه ولا — لما لا يحمل يومَ البيع — بيوم قيمته أو تاليَيه)؛
 *   - هو يومٌ معتاد: في أربعةٍ على الأقلّ من مثله في الأسابيع الستّة السابقة تسوية؛
 *   - الكشفُ يغطّي ما بعده: آخرُ يومٍ في الكشف بعده بمهلة التسوية، وإلّا
 *     فالغائبُ غائبٌ لأنّ الكشف لم يُستورَد لا لأنّ المال لم يصل.
 *
 * و`ignored` ما حسمه صاحبُه (كان مغلقاً · وصلت لاحقاً). ولا يُسمّى الغيابُ
 * ضياعاً: يُقال «لم تصل» ويُترك الحكمُ له.
 */
export function missingSettlements(
  rows: readonly PosTx[],
  opts: { lastBankDay: string | null; ignored?: ReadonlySet<string>; lookbackDays?: number },
): MissingSettlement[] {
  if (!opts.lastBankDay) return [];
  const settled = rows.filter((r) => r.kind === "POS_SETTLEMENT");
  if (settled.length === 0) return [];

  const bySaleDay = new Map<string, number>();
  const looseValueDays = new Set<string>();
  for (const tx of settled) {
    const r = read(tx);
    if (r.saleDay) bySaleDay.set(r.saleDay, (bySaleDay.get(r.saleDay) ?? 0) + tx.amountMinor);
    else looseValueDays.add(tx.day);
  }
  /* ما لا يحمل يومَ البيع: يومُ قيمته يغطّي يومَه واليومين قبله */
  const covered = (day: string) =>
    bySaleDay.has(day) || [0, 1, 2].some((n) => looseValueDays.has(shift(day, n)));
  const amountOn = (day: string) => bySaleDay.get(day) ?? null;

  const first = [...bySaleDay.keys(), ...looseValueDays].sort()[0];
  const until = shift(opts.lastBankDay, -SETTLEMENT_GRACE_DAYS);
  const from = opts.lookbackDays ? [first, shift(until, -opts.lookbackDays)].sort()[1] : first;

  const out: MissingSettlement[] = [];
  for (let day = from; day <= until; day = shift(day, 1)) {
    if (covered(day)) continue;
    if (opts.ignored?.has(missingSettlementKey(day))) continue;
    const dow = weekday(day);
    const sameDays = Array.from({ length: USUAL_WEEKS }, (_, i) => shift(day, -7 * (i + 1)));
    const seen = sameDays.filter((d) => weekday(d) === dow && covered(d));
    if (seen.length < USUAL_WEEKS_MIN) continue;
    out.push({
      day,
      usualMinor: median(seen.flatMap((d) => {
        const amount = amountOn(d);
        return amount === null ? [] : [amount];
      })),
      seenWeeks: seen.length,
    });
  }
  return out.reverse();
}

/** نقاطُ الأساس نسبةً بخانتين — «‏1.25٪» — و`null` «غير معروف». معزولةٌ كي لا تنقلب في سطرٍ عربيّ. */
export function formatRate(bp: number | null): string {
  if (bp === null) return "غير معروف";
  const abs = Math.abs(bp);
  const sign = bp < 0 ? "−" : "";
  return `⁦${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}٪⁩`;
}
