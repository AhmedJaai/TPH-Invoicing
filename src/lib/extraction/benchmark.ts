/**
 * مقياس مقارنة النماذج.
 *
 * كان اختيار المزوّد رأياً: «جيميني ضعيف» أو «كلود أفضل». وهذا لا
 * يُبنى عليه قرارٌ يمسّ أرقام فواتير.
 *
 * وهنا يُقاس على مستنداتٍ حقيقية بحقيقةٍ معلومة، وبمعايير تُذكر
 * صراحةً. والمعيار الأهمّ ليس الدقّة الخام بل **نسبة الخطأ الواثق**:
 * قراءةٌ خاطئة بثقةٍ عالية أخطر من فراغٍ معلَن — لأنّ الفراغ يُراجَع
 * والخطأ الواثق يمرّ.
 */

export interface GroundTruth {
  documentId: string;
  kind: string;
  supplierName?: string;
  /**
   * أسماءُ المورّد الأخرى المسجَّلة (الإنجليزيّ مع العربيّ): الفاتورة قد تحمل أحدهما،
   * ومطابقةُ الإنجليزيّ بالعربيّ وحده تعدّ الصوابَ خطأً.
   */
  supplierAliases?: string[];
  invoiceNumber?: string;
  invoiceDate?: string;
  subtotalMinor?: number;
  vatMinor?: number;
  totalMinor?: number;
  lineCount?: number;
}

export interface Prediction extends Partial<Omit<GroundTruth, "supplierAliases">> {
  documentId: string;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  durationMs: number;
  /** ثقة النموذج بمجموعات الحقول. */
  confidence?: Record<string, number>;
  /** فشل الاستخراج أصلاً. */
  failed?: boolean;
}

export type FieldName =
  | "kind" | "supplierName" | "invoiceNumber" | "invoiceDate"
  | "subtotalMinor" | "vatMinor" | "totalMinor" | "lineCount";

export const FIELDS: readonly FieldName[] = [
  "kind", "supplierName", "invoiceNumber", "invoiceDate",
  "subtotalMinor", "vatMinor", "totalMinor", "lineCount",
];

export interface FieldScore {
  field: FieldName;
  /** أُجيب وأصاب. */
  correct: number;
  /** أُجيب وأخطأ — وهذا هو المؤذي. */
  wrong: number;
  /** لم يُجَب، والحقيقة موجودة. */
  missed: number;
  /** لا حقيقة له فلا يُحاسَب. */
  notApplicable: number;
  accuracy: number | null;
}

export interface BenchmarkResult {
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  documents: number;
  failures: number;
  fields: FieldScore[];
  /**
   * نسبة الخطأ الواثق: أخطأ وثقته عالية.
   *
   * وهي المعيار الحاكم — أخطر من الدقّة الخام.
   */
  confidentErrorRate: number | null;
  medianDurationMs: number | null;
  overallAccuracy: number | null;
}

/** فوق هذه الثقة يُعدّ الخطأ «واثقاً». */
export const CONFIDENT = 0.8;

/** فرق يُغتفَر في المبالغ: هللة. */
export const AMOUNT_TOLERANCE_MINOR = 1;

/* NFKC أوّلاً: «ﻣﺆﺳﺴﺔ» (شكلُ عرض) و«مؤسسة» نصّان مختلفان بايتاً */
function normalize(v: string): string {
  return v.normalize("NFKC").replace(/[ً-ْـ]/g, "").replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي")
    .replace(/ة/g, "ه").replace(/\s+/g, " ").trim().toLowerCase();
}

/** المطبوع يحمل «مؤسسة» و«المحدودة» حول الاسم المسجَّل — فيكفي الاحتواء من أحد الطرفين. */
function sameSupplier(names: readonly string[], got: string): boolean {
  const g = normalize(got).replace(/\s+/g, "");
  if (g === "") return false;
  return names.some((n) => {
    const w = normalize(n).replace(/\s+/g, "");
    return w !== "" && (g === w || g.includes(w) || w.includes(g));
  });
}

/** رقمُ الفاتورة يُقابَل بلا فراغاته: «INV 12» و«INV12» رقمٌ واحد. */
function same(field: FieldName, truth: unknown, got: unknown): boolean {
  if (field === "invoiceNumber" && typeof truth === "string" && typeof got === "string") {
    return normalize(truth).replace(/\s+/g, "") === normalize(got).replace(/\s+/g, "");
  }
  if (typeof truth === "number" && typeof got === "number") {
    const tolerance = field.endsWith("Minor") ? AMOUNT_TOLERANCE_MINOR : 0;
    return Math.abs(truth - got) <= tolerance;
  }
  if (typeof truth === "string" && typeof got === "string") {
    return normalize(truth) === normalize(got);
  }
  return truth === got;
}

/** المجموعة التي تنتمي إليها كل حقلٍ في ثقة النموذج. */
const CONFIDENCE_GROUP: Record<FieldName, string> = {
  kind: "documentKind",
  supplierName: "supplierName",
  invoiceNumber: "invoiceNumber",
  invoiceDate: "invoiceDate",
  subtotalMinor: "amounts",
  vatMinor: "amounts",
  totalMinor: "amounts",
  lineCount: "amounts",
};

export function scoreProvider(
  truths: readonly GroundTruth[],
  predictions: readonly Prediction[],
): BenchmarkResult | null {
  if (predictions.length === 0) return null;

  const truthById = new Map(truths.map((t) => [t.documentId, t]));
  const first = predictions[0];

  const fields: FieldScore[] = FIELDS.map((field) => ({
    field, correct: 0, wrong: 0, missed: 0, notApplicable: 0, accuracy: null,
  }));

  let confidentErrors = 0;
  let confidentAnswers = 0;
  const durations: number[] = [];
  let failures = 0;

  for (const p of predictions) {
    const truth = truthById.get(p.documentId);
    if (!truth) continue;
    if (p.failed) { failures++; continue; }
    durations.push(p.durationMs);

    for (const score of fields) {
      const expected = truth[score.field as keyof GroundTruth];
      const got = p[score.field as keyof Prediction];

      if (expected === undefined || expected === null || expected === "") {
        score.notApplicable++;
        continue;
      }
      if (got === undefined || got === null || got === "") {
        /*
          الصفر المؤكَّد والحقل الفارغ يتّفقان في الضريبة: فاتورةٌ بلا بند ضريبة تُقيَّد
          صفراً، والنموذج يترك الحقل فارغاً لأنّه لم يُطبَع — وهما قولٌ واحد.
        */
        if (score.field === "vatMinor" && expected === 0) score.correct++;
        else score.missed++;
        continue;
      }

      const hit = score.field === "supplierName" && typeof got === "string"
        ? sameSupplier([String(expected), ...(truth.supplierAliases ?? [])], got)
        : same(score.field, expected, got);
      if (hit) score.correct++;
      else score.wrong++;

      const c = p.confidence?.[CONFIDENCE_GROUP[score.field]];
      if (c !== undefined && c >= CONFIDENT) {
        confidentAnswers++;
        if (!hit) confidentErrors++;
      }
    }
  }

  for (const f of fields) {
    const judged = f.correct + f.wrong + f.missed;
    f.accuracy = judged === 0 ? null : f.correct / judged;
  }

  const judgedAll = fields.reduce((s, f) => s + f.correct + f.wrong + f.missed, 0);
  const correctAll = fields.reduce((s, f) => s + f.correct, 0);

  durations.sort((a, b) => a - b);

  return {
    provider: first.provider,
    model: first.model,
    promptVersion: first.promptVersion,
    schemaVersion: first.schemaVersion,
    documents: predictions.length,
    failures,
    fields,
    confidentErrorRate: confidentAnswers === 0 ? null : confidentErrors / confidentAnswers,
    medianDurationMs: durations.length === 0 ? null : durations[Math.floor(durations.length / 2)],
    overallAccuracy: judgedAll === 0 ? null : correctAll / judgedAll,
  };
}

/**
 * يرتّب المزوّدين.
 *
 * **الخطأ الواثق أوّلاً**، ثمّ الدقّة، ثمّ السرعة. ومزوّدٌ أدقّ بنقطة
 * وأكثر خطأً واثقاً بخمس ليس أفضل — في المال، الخطأ الذي يمرّ أغلى من
 * الفراغ الذي يُراجَع.
 */
export function rankProviders(results: readonly BenchmarkResult[]): BenchmarkResult[] {
  return [...results].sort(
    (a, b) =>
      (a.confidentErrorRate ?? 1) - (b.confidentErrorRate ?? 1) ||
      (b.overallAccuracy ?? 0) - (a.overallAccuracy ?? 0) ||
      (a.medianDurationMs ?? Infinity) - (b.medianDurationMs ?? Infinity),
  );
}

/** ما يلزم لتحويل قراءةٍ (محفوظةٍ أو جديدة) إلى توقّعٍ يُقاس. */
export interface PredictionMeta {
  documentId: string;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  durationMs: number;
}

/**
 * قراءةٌ — كما حُفظت أو كما عادت الآن — إلى توقّعٍ يُقاس.
 *
 * مرنةٌ عمداً: تُقرأ الحقول المقيسة وحدها ولا يُشترَط المخطّط كاملاً. اشتراطُه كان
 * يُسقط كلَّ ما حُفظ قبل آخر حقلٍ أُضيف، فيقيس المقياسُ تطوّرَ مخطّطنا ويعرضه ضعفاً
 * في المزوّد. والصافي يُشتقّ هنا (الإجماليّ − الضريبة) كما يشتقّه `extractDocument`:
 * فلا يُقارَن طرفٌ بعد المعالجة بطرفٍ قبلها. و`parse` يُحقَن ليبقى الملفّ خالصاً.
 */
export function predictionFromReading(
  reading: unknown,
  meta: PredictionMeta,
  parse: (amount: string) => number | null,
): Prediction {
  if (reading === null || reading === undefined || typeof reading !== "object") {
    return { ...meta, failed: true };
  }
  const text = (key: string): string | undefined => {
    const v: unknown = Reflect.get(reading, key);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
  };
  const money = (key: string): number | undefined => {
    const v = text(key);
    return v === undefined ? undefined : parse(v) ?? undefined;
  };
  const total = money("totalAmount");
  const vat = money("vatAmount");
  let subtotal = money("subtotalAmount");
  if (subtotal === undefined && total !== undefined && vat !== undefined && total - vat >= 0) subtotal = total - vat;

  const confidence: Record<string, number> = {};
  const rawConfidence: unknown = Reflect.get(reading, "confidence");
  if (rawConfidence && typeof rawConfidence === "object") {
    for (const [k, v] of Object.entries(rawConfidence)) if (typeof v === "number") confidence[k] = v;
  }
  const lines: unknown = Reflect.get(reading, "lines");

  return {
    ...meta,
    kind: text("documentKind"),
    supplierName: text("supplierNameAr") ?? text("supplierNameEn"),
    invoiceNumber: text("invoiceNumber"),
    invoiceDate: text("invoiceDate")?.slice(0, 10),
    subtotalMinor: subtotal,
    vatMinor: vat,
    totalMinor: total,
    lineCount: Array.isArray(lines) && lines.length > 0 ? lines.length : undefined,
    confidence,
  };
}

/** جدولُ نتيجةٍ للطباعة — نصٌّ خالص، بلا لون. */
export function formatBenchmark(label: string, r: BenchmarkResult | null): string {
  if (!r) return `\n── ${label} ──\n  لا يُقاس: لا قراءةَ واحدة`;
  const pct = (v: number | null) => (v === null ? "لا يُقاس" : `${(v * 100).toFixed(1)}%`);
  const lines = [`\n── ${label} ── (${r.provider} · ${r.model} · موجِّه ${r.promptVersion})`];
  for (const f of r.fields) {
    lines.push(
      `  ${f.field.padEnd(14)} صحيح ${String(f.correct).padStart(3)} · خطأ ${String(f.wrong).padStart(3)} · ` +
      `لم يُقرأ ${String(f.missed).padStart(3)} · لا حقيقة ${String(f.notApplicable).padStart(3)} → ${pct(f.accuracy)}`,
    );
  }
  lines.push(`  الدقّة الإجماليّة : ${pct(r.overallAccuracy)}`);
  lines.push(`  الخطأ الواثق      : ${pct(r.confidentErrorRate)} — أخطأ وثقتُه ${CONFIDENT} فأعلى (المعيار الحاكم)`);
  lines.push(`  فشل الاستخراج     : ${r.failures} من ${r.documents}`);
  return lines.join("\n");
}
