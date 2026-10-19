/**
 * مقارنةُ الأرباع المقدَّمة — «لماذا ارتفعت ضريبتي؟» من لقطات «قدّمتُه».
 *
 * `vat_filings` يحفظ كلَّ إقرارٍ كما قُدِّم، بأرقامه ولقطةِ حسابه. هنا تُقرأ اللقطاتُ
 * جنباً إلى جنب: المخرجات، والمدخلاتُ بأبوابها الثلاثة، والصافي، ونسبةُ المدخلات إلى
 * المخرجات — ثمّ أكبرُ ما حرّك الصافي عن الربع الذي قبله، مسمّىً بمبلغه.
 *
 * واللقطةُ JSON كُتب في وقته: ما لا يُقرأ من أبوابها `null` («غير محفوظ») لا صفر،
 * والأرقامُ الأربعة الرئيسة من أعمدة الجدول نفسِها.
 */

export interface FiledQuarterInput {
  periodKey: string;
  filedOn: string;
  outputVatMinor: number;
  inputVatMinor: number;
  carriedInMinor: number;
  netMinor: number;
  snapshot: unknown;
}

export interface FiledQuarter {
  periodKey: string;
  filedOn: string;
  outputVatMinor: number;
  inputVatMinor: number;
  /** أبوابُ المدخلات من اللقطة — `null` لم تُحفظ بهذا الشكل. */
  fromInvoicesMinor: number | null;
  fromFeesMinor: number | null;
  fromSelectedMinor: number | null;
  carriedInMinor: number;
  netMinor: number;
  /** المدخلات ÷ المخرجات بالنقاط الأساس (٪ × ١٠٠) — `null` حين لا مخرجات. */
  inputShareBp: number | null;
}

function minorAt(root: unknown, path: readonly string[]): number | null {
  let node: unknown = root;
  for (const key of path) {
    if (typeof node !== "object" || node === null || !Object.hasOwn(node, key)) return null;
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === "number" && Number.isSafeInteger(node) ? node : null;
}

export function readFiledQuarter(f: FiledQuarterInput): FiledQuarter {
  return {
    periodKey: f.periodKey,
    filedOn: f.filedOn,
    outputVatMinor: f.outputVatMinor,
    inputVatMinor: f.inputVatMinor,
    fromInvoicesMinor: minorAt(f.snapshot, ["result", "input", "invoices", "vatMinor"]),
    fromFeesMinor: minorAt(f.snapshot, ["result", "input", "bankVat", "vatMinor"]),
    fromSelectedMinor: minorAt(f.snapshot, ["result", "input", "selected", "vatMinor"]),
    carriedInMinor: f.carriedInMinor,
    netMinor: f.netMinor,
    inputShareBp: f.outputVatMinor > 0 ? Math.round((f.inputVatMinor * 10_000) / f.outputVatMinor) : null,
  };
}

export interface NetDriver {
  label: string;
  /** أثرُه في الصافي: موجبٌ يرفع ما يُسدَّد، سالبٌ يخفضه. */
  effectMinor: number;
}

/**
 * ما حرّك الصافي بين ربعين مقدَّمين، الأكبرُ أثراً أوّلاً (ثلاثةٌ على الأكثر).
 * المخرجاتُ ترفعه، وكلُّ بابِ مدخلاتٍ والرصيدُ المرحَّل يخفضه. وإن لم تُحفظ أبوابُ
 * المدخلات في إحدى اللقطتين قيل «المدخلات» جملةً — لا بابٌ يُخترَع له رقم.
 */
export function netDrivers(previous: FiledQuarter, current: FiledQuarter): NetDriver[] {
  const drivers: NetDriver[] = [
    { label: "ضريبة المبيعات", effectMinor: current.outputVatMinor - previous.outputVatMinor },
    { label: "رصيد مرحّل من الربع السابق", effectMinor: -(current.carriedInMinor - previous.carriedInMinor) },
  ];
  const parts: [string, number | null, number | null][] = [
    ["خصم الفواتير", previous.fromInvoicesMinor, current.fromInvoicesMinor],
    ["خصم ضريبة الرسوم", previous.fromFeesMinor, current.fromFeesMinor],
    ["خصم ما اخترته من الخارج", previous.fromSelectedMinor, current.fromSelectedMinor],
  ];
  if (parts.every(([, a, b]) => a !== null && b !== null)) {
    for (const [label, a, b] of parts) drivers.push({ label, effectMinor: -((b ?? 0) - (a ?? 0)) });
  } else {
    drivers.push({ label: "ضريبة المدخلات (أبوابها غير محفوظة في اللقطة)", effectMinor: -(current.inputVatMinor - previous.inputVatMinor) });
  }
  return drivers
    .filter((d) => d.effectMinor !== 0)
    .sort((a, b) => Math.abs(b.effectMinor) - Math.abs(a.effectMinor))
    .slice(0, 3);
}

export interface QuarterComparison {
  quarters: FiledQuarter[];
  /** آخرُ ربعٍ مقدَّم مقابل الذي قبله — `null` حين لا ربعين. */
  latest: { previous: FiledQuarter; current: FiledQuarter; netChangeMinor: number; drivers: NetDriver[] } | null;
}

export function compareFiledQuarters(filings: readonly FiledQuarterInput[]): QuarterComparison {
  const quarters = filings.map(readFiledQuarter).sort((a, b) => a.periodKey.localeCompare(b.periodKey));
  if (quarters.length < 2) return { quarters, latest: null };
  const current = quarters[quarters.length - 1];
  const previous = quarters[quarters.length - 2];
  return {
    quarters,
    latest: { previous, current, netChangeMinor: current.netMinor - previous.netMinor, drivers: netDrivers(previous, current) },
  };
}

/** النسبةُ من النقاط الأساس بخانةٍ عشريّة — «40.0٪»، بلا إشارة (حصّةٌ لا تغيّر) وبحسابٍ صحيح. */
export function shareText(bp: number): string {
  const tenths = Math.round(bp / 10);
  return `\u2066${Math.floor(tenths / 10)}.${tenths % 10}٪\u2069`;
}
