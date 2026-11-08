/**
 * مراقبةُ السعر — بابٌ واحد يقول: هل تغيّر سعرُ هذا الصنف عند مورّده فعلاً؟
 *
 * كانت أربعُ شاشاتٍ تحسبه بأربع طرق، كلُّها «آخرُ سطرين»: فقراءةٌ خاطئةٌ واحدة
 * تصير «ارتفاعاً»، وصيغتا اسمٍ لصنفٍ واحد صنفين بلا تاريخ، وبندان بسعرين في فاتورةٍ
 * واحدة («تشيز كيك» الكبير والصغير باسمٍ واحد عند غاناش) يتقلّبان «+٣٢٪ / −٢٤٪» كلَّ
 * يوم. وفي الإنتاج (٨ نوفمبر ٢٠٢٦) كان ١٧ من ١٩ «تغيّراً» في الأصناف قراءةً لا سعراً.
 *
 * فالقاعدة هنا:
 *
 *   1. **الهويّة**: صيغُ الاسم الواحد تُجمع حين يكون الدليلُ قاطعاً لا تشابهاً —
 *      الكلماتُ نفسُها بترتيبٍ آخر، أو رمزُ الصنف (SKU) نفسُه، أو الاسمُ نفسُه بلا
 *      مسافة («دولت شي» = «دولتشي»)، أو الاسمُ الإنجليزيّ (أو العربيّ) نفسُه بالأرقام
 *      نفسها. وصيغتان في فاتورةٍ واحدة بندين صنفان لا يُجمعان أبداً.
 *   2. **السعرُ لكلّ فاتورة لا لكلّ سطر**: فاتورةٌ فيها للصنف سعران «مزدوجة» لا تُقرأ.
 *   3. **التغيّرُ يُصدَّق بفاتورتين**: سعرٌ جديد في فاتورةٍ واحدة «ينتظر تأكيداً»، وسعرٌ
 *      شاذٌّ بين فاتورتين بالسعر المعتاد قراءةٌ خاطئة تُتجاهَل. والسابقُ هو السعرُ
 *      المعتاد (الأكثرُ تكراراً قبله) لا آخرُ سطر.
 *   4. **ما يفسّره غيرُ السعر يُسمّى**: فرقٌ قدرُه الضريبة (×١٫١٥) قراءةٌ شاملةٌ للضريبة،
 *      وفرقُ ضعفين فأكثر وحدةٌ أو كمّيّةٌ قُرئت خطأ (المجموعُ مكانَ الحبّة) — لا يُعدّان
 *      ارتفاعاً ولا انخفاضاً.
 *   5. **سعران عاشا معاً في فاتورة** صنفان باسمٍ واحد، لا سعرٌ تغيّر.
 *
 * أعدادٌ صحيحة بالهللات والنسبُ بنقاط الأساس. والاسمُ المخزّن لا يتغيّر: الجمعُ هنا
 * للمقارنة وحدها، والدمجُ الدائم يُقرّه إنسانٌ («هو نفسه…» في صفحة المورّد).
 */

/** دون هذا تقريبٌ لا حركة — بنقاط الأساس (٣٪). */
export const PRICE_MOVE_FLOOR_BP = 300;
/**
 * ما قارب ضعفين فأكثر (١٫٩×، أو دون النصف) وحدةٌ أو كمّيّةٌ مختلفة في الغالب، لا سعر —
 * نادك «قليل الدسم» ٣٫٠٣ ثمّ ١٫٥٢: الكمّيّةُ قُرئت ضعفين لا السعرُ انتصف.
 */
export const UNIT_GAP_MULTIPLE_BP = 19_000;
/** فرقٌ قدرُه الضريبة بهامش ١٪ — قراءةٌ شاملةٌ للضريبة مرّةً وصافيةٌ مرّة. */
const VAT_FACTOR_BP = 11_500;
const VAT_SLACK_BP = 100;
/** سطورٌ لا يُبنى عليها سعر: ضربُها لا يستقيم، أو كمّيّتُها لم تُقرأ. */
const UNTRUSTED_BASIS = new Set(["INCONSISTENT", "QTY_UNREAD"]);

export interface PriceLine {
  supplierId: string;
  /** الوصف المطبَّع كما خُزّن (`normalized_description`) */
  normalized: string;
  description: string;
  invoiceId: string;
  invoiceNumber?: string | null;
  /** YYYY-MM-DD */
  day: string;
  /** سعر الوحدة الفعليّ بالهللات (`line-pricing.ts`) */
  unitMinor: number;
  /** الكمّيّة بالمِلّي — `null` لم تُقرأ */
  qtyMilli: number | null;
  /** إجماليّ السطر الصافي بالهللات */
  totalMinor?: number;
  basis: string | null;
}

/* ───────────────────────── الهويّة ───────────────────────── */

const UNIT_TOKENS = new Set(["kg", "g", "l", "ml", "pc", "ctn", "bag", "pack"]);
const NOISE_TOKENS = new Set(["sr", "x"]);

/** رمزُ صنفٍ يكتبه المورّد: أرقامٌ أربعةٌ فأكثر لا تتبعها وحدة، أو حروفٌ ثمّ أرقام (zfg0238). */
function isCode(tok: string, next: string | undefined): boolean {
  if (/^\d{4,}$/.test(tok)) return !next || !UNIT_TOKENS.has(next);
  return /^[a-z]{2,}\d{3,}$/.test(tok);
}

/** رمزٌ يصلح هويّةً وحده: خمسةُ أرقامٍ فأكثر أو حروفٌ ثمّ أرقام — لا «1000» التي تتكرّر عبوةً. */
function isStrongCode(tok: string): boolean {
  return /^\d{5,}$/.test(tok) || /^[a-z]{2,}\d{3,}$/.test(tok);
}

interface NameShape {
  signature: string;
  squashed: string;
  codes: string[];
  numbers: string;
  latin: string | null;
  arabic: string | null;
}

function shapeOf(normalized: string): NameShape {
  const raw = normalized.split(" ").filter(Boolean);
  const codes: string[] = [];
  const kept: string[] = [];
  raw.forEach((t, i) => {
    if (isCode(t, raw[i + 1])) {
      if (isStrongCode(t)) codes.push(t);
      return;
    }
    if (NOISE_TOKENS.has(t)) return;
    kept.push(t);
  });
  const set = [...new Set(kept)].sort();
  const numbers = set.filter((t) => /^\d+(\.\d+)?$/.test(t)).join(",");
  /* كلماتٌ لا رموز: «bk 02 v019 cf» رموزٌ تتكرّر بين الحبوب والفنجان عند مود القهوة */
  const alpha = (script: RegExp) => {
    const words = set.filter((t) => script.test(t) && t.length >= 3 && !UNIT_TOKENS.has(t));
    return words.length >= 2 ? `${words.join(" ")}|${numbers}` : null;
  };
  return {
    signature: set.join(" "),
    squashed: kept.join(""),
    codes,
    numbers,
    latin: alpha(/^[a-z]+$/),
    arabic: alpha(/^\p{Script=Arabic}+$/u),
  };
}

/**
 * يجمع صيغَ اسم الصنف الواحد عند مورّدٍ واحد — بالدليل القاطع وحده.
 * يُرجع لكلّ اسمٍ مطبَّع ممثّلَ مجموعته (أكثرُها بنوداً).
 */
export function itemIdentity(lines: readonly Pick<PriceLine, "normalized" | "invoiceId">[]): Map<string, string> {
  const count = new Map<string, number>();
  const invoicesOf = new Map<string, Set<string>>();
  for (const l of lines) {
    if (!l.normalized) continue;
    count.set(l.normalized, (count.get(l.normalized) ?? 0) + 1);
    const s = invoicesOf.get(l.normalized) ?? new Set<string>();
    s.add(l.invoiceId);
    invoicesOf.set(l.normalized, s);
  }
  const names = [...count.keys()].sort();
  const parent = new Map(names.map((n) => [n, n]));
  const members = new Map(names.map((n) => [n, [n]]));
  const find = (n: string): string => {
    let r = n;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  /* صيغتان في فاتورةٍ واحدة بندان منفصلان — صنفان، فلا تُجمع مجموعتاهما */
  const coOccur = (a: string, b: string) => {
    for (const x of members.get(a)!) for (const y of members.get(b)!) {
      const ix = invoicesOf.get(x)!, iy = invoicesOf.get(y)!;
      for (const id of ix) if (iy.has(id)) return true;
    }
    return false;
  };
  const unite = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra === rb || coOccur(ra, rb)) return;
    parent.set(rb, ra);
    members.set(ra, [...members.get(ra)!, ...members.get(rb)!]);
  };

  const shapes = new Map(names.map((n) => [n, shapeOf(n)]));
  const byKey = new Map<string, string>();
  const link = (key: string | null, name: string) => {
    if (!key) return;
    const seen = byKey.get(key);
    if (seen) unite(seen, name);
    else byKey.set(key, name);
  };
  for (const n of names) {
    const s = shapes.get(n)!;
    if (s.signature) link(`sig:${s.signature}`, n);
    if (s.squashed.length >= 4) link(`sq:${s.squashed}`, n);
    for (const c of s.codes) link(`code:${c}`, n);
    link(s.latin && `lat:${s.latin}`, n);
    link(s.arabic && `ar:${s.arabic}`, n);
  }

  const out = new Map<string, string>();
  for (const n of names) {
    const group = members.get(find(n))!;
    const rep = [...group].sort((a, b) => (count.get(b)! - count.get(a)!) || a.localeCompare(b))[0];
    out.set(n, rep);
  }
  return out;
}

/* ───────────────────────── الحكم ───────────────────────── */

/** ما يفسّر فرقاً غيرَ تغيّر السعر. */
export type PriceGapReason = "VAT" | "UNIT";

/** نسبةُ ما بين سعرين بنقاط الأساس — موجبٌ ارتفاع. */
export function deltaBp(fromMinor: number, toMinor: number): number {
  return Math.round(((toMinor - fromMinor) * 10_000) / fromMinor);
}

export function samePrice(a: number, b: number): boolean {
  return Math.abs(a - b) * 10_000 < PRICE_MOVE_FLOOR_BP * Math.min(a, b);
}

/** فرقٌ يفسّره غيرُ السعر: الضريبة، أو وحدةٌ وكمّيّة. `null` = فرقٌ يُصدَّق سعراً. */
export function gapReason(fromMinor: number, toMinor: number): PriceGapReason | null {
  if (fromMinor <= 0 || toMinor <= 0) return null;
  const hi = Math.max(fromMinor, toMinor), lo = Math.min(fromMinor, toMinor);
  if (hi * 10_000 >= lo * UNIT_GAP_MULTIPLE_BP) return "UNIT";
  if (Math.abs(hi * 10_000 - lo * VAT_FACTOR_BP) <= lo * VAT_SLACK_BP) return "VAT";
  return null;
}

export interface PriceReading {
  invoiceId: string;
  invoiceNumber: string | null;
  day: string;
  /** `null` = فاتورةٌ فيها للصنف سعران (بندان باسمٍ واحد) */
  unitMinor: number | null;
  /** كلُّ أسعار الصنف في هذه الفاتورة */
  prices: number[];
  /** شاذّةٌ بين قراءتين بالسعر المعتاد — قراءةٌ خاطئة في الغالب */
  stray: boolean;
}

export type PriceState =
  /** شراءٌ واحد — لا تغيّرَ يُقال */
  | { kind: "NEW" }
  | { kind: "STABLE" }
  /** تغيّرٌ أكّدته فاتورتان فأكثر */
  | { kind: "MOVED"; fromMinor: number; toMinor: number; deltaBp: number; sinceDay: string; previousDay: string; confirmations: number; reason: PriceGapReason | null }
  /** سعرٌ جديد في آخر فاتورةٍ وحدها — ينتظر الفاتورة التالية */
  | { kind: "UNCONFIRMED"; fromMinor: number; toMinor: number; deltaBp: number; sinceDay: string; previousDay: string; invoiceId: string; invoiceNumber: string | null; reason: PriceGapReason | null }
  /** سعران عاشا معاً في فاتورةٍ واحدة — صنفان باسمٍ واحد، لا تغيّر */
  | { kind: "MIXED"; prices: number[] };

export interface ItemPrice {
  /** `${supplierId}::${ممثّل الاسم}` */
  key: string;
  supplierId: string;
  normalized: string;
  /** كلُّ صيغ الاسم المجموعة هنا */
  variants: string[];
  displayName: string;
  /** عددُ الفواتير التي فيها الصنف */
  invoices: number;
  lastMinor: number | null;
  lastDay: string | null;
  lastInvoiceId: string | null;
  /** السعرُ المعتاد الآن — ما تُقارَن به الفاتورةُ القادمة. `null` إن لم يُعرف (MIXED). */
  expectedMinor: number | null;
  firstMinor: number | null;
  firstDay: string | null;
  state: PriceState;
  readings: PriceReading[];
  /** أسعارٌ صالحةٌ للرسم (بلا الشاذّ ولا المزدوج)، الأقدمُ أوّلاً */
  trail: number[];
  /** الكمّيّة بالمِلّي في آخر ٣٦٥ يوماً — `null` إن جُهلت كمّيّةُ بندٍ منها */
  yearQtyMilli: number | null;
}

/** «تغيّر سعره فعلاً»: مؤكَّدٌ ولا يفسّره غيرُ السعر. */
export function isRealMove(s: PriceState): s is Extract<PriceState, { kind: "MOVED" }> {
  return s.kind === "MOVED" && s.reason === null;
}

/** «راجع البند»: فرقٌ لا يُصدَّق سعراً — بضعفين أو بالضريبة، أو جديدٌ لم يؤكَّد. */
export function needsLineCheck(s: PriceState): s is Extract<PriceState, { kind: "MOVED" | "UNCONFIRMED" }> {
  return (s.kind === "MOVED" || s.kind === "UNCONFIRMED") && s.reason !== null;
}

function modeOf(prices: readonly number[]): { price: number; count: number } | null {
  /* الأحدثُ يغلب عند التساوي — المصفوفةُ بترتيب الزمن */
  let best: { price: number; count: number } | null = null;
  for (let i = prices.length - 1; i >= 0; i--) {
    const p = prices[i];
    const n = prices.filter((q) => samePrice(q, p)).length;
    if (!best || n > best.count) best = { price: p, count: n };
  }
  return best;
}

function judge(readings: PriceReading[]): { state: PriceState; expected: number | null } {
  const clean = readings.filter((r) => r.unitMinor !== null);
  if (clean.length === 0) return { state: { kind: "MIXED", prices: [...new Set(readings.flatMap((r) => r.prices))].sort((a, b) => a - b) }, expected: null };
  /*
    الشاذُّ قراءةٌ خاطئة يُعلَّم ويُتجاوَز: ما حصرته قراءتان متّفقتان، أو قفزةٌ بقدر الضريبة
    أو بضعفين لم تتكرّر (ألبرو ١٥٫٦٥ ثمّ ١٨ — هو نفسُه بالضريبة — ثمّ ١٤٫٧٨). وأوّلُ قراءةٍ
    شاذّةٌ إن خالفت بضعفين الاثنتين بعدها وهما متقاربتان (نستله ٨٫٥٠ ثمّ ٣٤٠ و٣٧٤).
    وآخرُ قراءةٍ لا تُعلَّم: هي «تنتظر تأكيداً» لا خطأٌ محسوم.
  */
  const at = (i: number) => clean[i].unitMinor!;
  if (clean.length >= 3 && gapReason(at(0), at(1)) !== null && gapReason(at(0), at(2)) !== null && gapReason(at(1), at(2)) === null) clean[0].stray = true;
  let anchor = clean[0].stray ? 1 : 0;
  for (let i = anchor + 1; i < clean.length - 1; i++) {
    const a = at(anchor), b = at(i), next = at(i + 1);
    const sandwiched = samePrice(a, next) && !samePrice(a, b);
    const lonelyJump = gapReason(a, b) !== null && !samePrice(b, next);
    if (sandwiched || lonelyJump) clean[i].stray = true;
    else anchor = i;
  }
  const usable = clean.filter((r) => !r.stray);
  const last = usable[usable.length - 1];
  const c = last.unitMinor!;
  if (usable.length === 1) return { state: { kind: "NEW" }, expected: c };

  /* نظامُ السعر الحاليّ: من آخر فاتورةٍ إلى الوراء ما دام السعرُ هو هو */
  let start = usable.length - 1;
  while (start > 0 && samePrice(usable[start - 1].unitMinor!, c)) start--;
  const confirmations = usable.length - start;
  const prior = usable.slice(0, start);
  if (prior.length === 0) return { state: { kind: "STABLE" }, expected: c };

  const recentPrior = prior.slice(-6).map((r) => r.unitMinor!);
  const prev = modeOf(recentPrior)!.price;
  if (samePrice(prev, c)) return { state: { kind: "STABLE" }, expected: c };
  const previousDay = [...prior].reverse().find((r) => samePrice(r.unitMinor!, prev))!.day;

  /* سعران في فاتورةٍ واحدة يوماً ما: صنفان يعيشان معاً، لا سعرٌ حلّ محلّ سعر */
  const coexist = readings.some((r) => r.prices.some((p) => samePrice(p, prev)) && r.prices.some((p) => samePrice(p, c)));
  if (coexist) return { state: { kind: "MIXED", prices: [prev, c].sort((a, b) => a - b) }, expected: null };

  const reason = gapReason(prev, c);
  const common = { fromMinor: prev, toMinor: c, deltaBp: deltaBp(prev, c), sinceDay: usable[start].day, previousDay, reason };
  if (confirmations >= 2) {
    /* ما تكرّر في فاتورتين صار هو السعر — ولو بوحدةٍ أخرى؛ والسببُ يُقال بجانبه */
    return { state: { kind: "MOVED", ...common, confirmations }, expected: c };
  }
  return {
    state: { kind: "UNCONFIRMED", ...common, invoiceId: last.invoiceId, invoiceNumber: last.invoiceNumber },
    /* ما لم يؤكَّد لا يصير معياراً — الفاتورةُ القادمة تُقارَن بالمعتاد */
    expected: prev,
  };
}

/**
 * يتتبّع سعرَ كلّ صنفٍ عند مورّده. `todayDay` لحساب كمّيّة السنة (YYYY-MM-DD).
 */
export function trackPrices(lines: readonly PriceLine[], todayDay: string): ItemPrice[] {
  const bySupplier = new Map<string, PriceLine[]>();
  for (const l of lines) {
    if (!l.supplierId || !l.normalized) continue;
    const list = bySupplier.get(l.supplierId) ?? [];
    list.push(l);
    bySupplier.set(l.supplierId, list);
  }
  const yearAgo = shiftDay(todayDay, -365);
  const out: ItemPrice[] = [];

  for (const [supplierId, list] of bySupplier) {
    const identity = itemIdentity(list);
    const groups = new Map<string, PriceLine[]>();
    for (const l of list) {
      const rep = identity.get(l.normalized)!;
      const g = groups.get(rep) ?? [];
      g.push(l);
      groups.set(rep, g);
    }

    for (const [rep, g] of groups) {
      const byInvoice = new Map<string, PriceLine[]>();
      for (const l of g) {
        const x = byInvoice.get(l.invoiceId) ?? [];
        x.push(l);
        byInvoice.set(l.invoiceId, x);
      }
      const readings: PriceReading[] = [];
      for (const [invoiceId, ls] of byInvoice) {
        const prices = ls.filter((l) => l.unitMinor > 0 && !UNTRUSTED_BASIS.has(l.basis ?? "")).map((l) => l.unitMinor);
        if (prices.length === 0) continue;
        const one = prices.every((p) => samePrice(p, prices[0]));
        readings.push({
          invoiceId, invoiceNumber: ls[0].invoiceNumber ?? null, day: ls[0].day,
          unitMinor: one ? modeOf(prices)!.price : null, prices, stray: false,
        });
      }
      readings.sort((a, b) => a.day.localeCompare(b.day) || (a.invoiceNumber ?? a.invoiceId).localeCompare(b.invoiceNumber ?? b.invoiceId, undefined, { numeric: true }));

      const year = g.filter((l) => l.day >= yearAgo);
      const yearQtyMilli = year.some((l) => l.qtyMilli === null) ? null : year.reduce((s, l) => s + (l.qtyMilli ?? 0), 0);
      /* اسمُ الصيغة الأكثر بنوداً، وآخرُ ما كُتب به — لا الأطول: الأطولُ قد يكون سطراً ابتلع أرقامَه */
      const repLines = g.filter((l) => l.normalized === rep).sort((a, b) => b.day.localeCompare(a.day));
      const displayName = (repLines[0] ?? g[0]).description;
      const base = {
        key: `${supplierId}::${rep}`, supplierId, normalized: rep,
        variants: [...new Set(g.map((l) => l.normalized))], displayName,
        invoices: byInvoice.size, yearQtyMilli,
      };

      if (readings.length === 0) {
        out.push({ ...base, lastMinor: null, lastDay: null, lastInvoiceId: null, expectedMinor: null, firstMinor: null, firstDay: null, state: { kind: "NEW" }, readings, trail: [] });
        continue;
      }
      const { state, expected } = judge(readings);
      const good = readings.filter((r) => r.unitMinor !== null && !r.stray);
      const lastGood = good[good.length - 1] ?? null;
      out.push({
        ...base,
        lastMinor: lastGood?.unitMinor ?? null,
        lastDay: lastGood?.day ?? readings[readings.length - 1].day,
        lastInvoiceId: lastGood?.invoiceId ?? readings[readings.length - 1].invoiceId,
        expectedMinor: expected,
        firstMinor: good[0]?.unitMinor ?? null,
        firstDay: good[0]?.day ?? null,
        state,
        readings,
        trail: good.map((r) => r.unitMinor!),
      });
    }
  }
  return out;
}

function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** الأثرُ السنويّ لتغيّرٍ مؤكَّد: الفرقُ × كمّيّةِ السنة — `null` إن جُهلت الكمّيّة. */
export function annualImpactMinor(item: Pick<ItemPrice, "yearQtyMilli">, fromMinor: number, toMinor: number): number | null {
  if (item.yearQtyMilli === null) return null;
  return Math.round(((toMinor - fromMinor) * item.yearQtyMilli) / 1000);
}

/**
 * تغيّرُ أسعار المورّد في مجملها: متوسّطُ تغيّر أصنافه من أوّل سعرٍ معتاد إلى المعتاد الآن،
 * موزوناً بما اشتُري منها — لا متوسّطُ سطور شهرٍ بشهر (الذي يخلط الكيسَ بالكرتون).
 * `null` إن لم يكن له صنفٌ اشتُري في فاتورتين بسعرٍ يُقرأ.
 */
export function supplierPriceDriftBp(items: readonly ItemPrice[]): number | null {
  let weight = 0, sum = 0;
  for (const i of items) {
    if (i.state.kind === "MIXED" || i.state.kind === "NEW") continue;
    if (i.firstMinor === null || i.expectedMinor === null || i.trail.length < 2) continue;
    if (gapReason(i.firstMinor, i.expectedMinor) !== null) continue;
    const w = i.trail.length;
    sum += deltaBp(i.firstMinor, i.expectedMinor) * w;
    weight += w;
  }
  return weight === 0 ? null : Math.round(sum / weight);
}

/* ───────────────────────── المراجعة ───────────────────────── */

export interface PriceMove {
  description: string;
  nowMinor: number;
  wasMinor: number;
  wasDay: string;
  /** موجبٌ ارتفاع وسالبٌ انخفاض — بنقاط الأساس */
  deltaBp: number;
  /** ما يفسّر الفرق غيرَ السعر — فلا يُعترض به */
  reason: PriceGapReason | null;
}

/**
 * أسعارُ فاتورةٍ تُراجَع مقابل السعر المعتاد لكلّ صنفٍ عند مورّدها.
 * `lines` بسعر الوحدة الفعليّ (بعد `resolveLinePricing` وتسوية الصافي) لا كما قُرئ.
 */
export function movesAtReview(
  lines: readonly { description: string; normalized: string; unitMinor: number | null }[],
  history: readonly PriceLine[],
  todayDay: string,
): PriceMove[] {
  if (lines.length === 0 || history.length === 0) return [];
  const probe = "__review__";
  const supplierId = history[0].supplierId;
  const withNew: PriceLine[] = [
    ...history,
    ...lines.filter((l) => l.normalized).map((l) => ({
      supplierId, normalized: l.normalized, description: l.description, invoiceId: probe, day: todayDay,
      unitMinor: 0, qtyMilli: null, basis: null,
    })),
  ];
  const identity = itemIdentity(withNew);
  const items = trackPrices(history, todayDay);
  /* الصنفُ الذي تقع صيغتُه الجديدة في مجموعته — بالدليل نفسه الذي يجمع صيغَ التاريخ */
  const itemOf = (normalized: string): ItemPrice | undefined => {
    const rep = identity.get(normalized);
    return rep === undefined ? undefined : items.find((i) => i.variants.some((v) => identity.get(v) === rep));
  };

  const out: PriceMove[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    if (!l.normalized || l.unitMinor === null || l.unitMinor <= 0) continue;
    const item = itemOf(l.normalized);
    if (!item || item.expectedMinor === null || item.expectedMinor <= 0 || seen.has(item.key)) continue;
    if (samePrice(item.expectedMinor, l.unitMinor)) continue;
    seen.add(item.key);
    const wasDay = [...item.readings].reverse().find((r) => r.unitMinor !== null && samePrice(r.unitMinor, item.expectedMinor!))?.day ?? item.lastDay ?? todayDay;
    out.push({
      description: l.description,
      nowMinor: l.unitMinor,
      wasMinor: item.expectedMinor,
      wasDay,
      deltaBp: deltaBp(item.expectedMinor, l.unitMinor),
      reason: gapReason(item.expectedMinor, l.unitMinor),
    });
  }
  /* ما يُعترض عليه أوّلاً: الارتفاعُ الحقيقيّ، ثمّ ما يحتاج مراجعةَ البند */
  return out.sort((a, b) => Number(a.reason !== null) - Number(b.reason !== null) || b.deltaBp - a.deltaBp);
}
