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
  invoiceNumber?: string;
  invoiceDate?: string;
  subtotalMinor?: number;
  vatMinor?: number;
  totalMinor?: number;
  lineCount?: number;
}

export interface Prediction extends Partial<GroundTruth> {
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

function normalize(v: string): string {
  return v.replace(/[ً-ْـ]/g, "").replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي")
    .replace(/ة/g, "ه").replace(/\s+/g, " ").trim().toLowerCase();
}

function same(field: FieldName, truth: unknown, got: unknown): boolean {
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
        score.missed++;
        continue;
      }

      const hit = same(score.field, expected, got);
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
