/** نقطة الدخول الوحيدة للاستخراج — تختار المزوّد من متغيّرات البيئة. */
import { claudeProvider } from "./extract";
import { deepseekExtractionProvider } from "./provider-deepseek";
import { geminiProvider } from "./provider-gemini";
import { ollamaProvider } from "./provider-ollama";
import { selectedProviderName, type ExtractionOutcome, type ExtractionRequest } from "./provider";
import { deriveAmounts, isCalendarDate, looksHijri } from "./validate-extraction";
import { emptyEvidence, reconcileWithQr } from "./evidence";
import { readZatcaQr, type QrReading } from "./zatca-qr";
import { PROMPT_VERSION, SCHEMA_VERSION } from "./versions";
import { normalizeDocumentDate } from "@/lib/document-date";

export { isSupportedUpload, uploadMimeType } from "./extract";
export type { ExtractionOutcome, ExtractionRequest } from "./provider";

const PROVIDERS = {
  deepseek: deepseekExtractionProvider,
  claude: claudeProvider,
  gemini: geminiProvider,
  ollama: ollamaProvider,
} as const;

/**
 * المزوّد الفعليّ — DeepSeek ما لم يُطلب غيره صراحةً.
 *
 * جيميني وOllama خاملان في الشيفرة. وكان متغيّرٌ قديمٌ واحد في Vercel
 * (`EXTRACTION_PROVIDER=gemini`) يكفي لإرسال فواتير المقهى كاملةً إلى طبقةٍ
 * مجانية تتدرّب عليها ويراجعها بشر — بلا إعلان. فصار البديل يحتاج إقراراً
 * ثانياً صريحاً، ويُسجَّل حين يُختار.
 */
function effectiveProviderName(): keyof typeof PROVIDERS {
  const name = selectedProviderName();
  if (name === "deepseek") return name;
  if (process.env.EXTRACTION_ALLOW_ALT_PROVIDER === "true") {
    console.warn(`extraction: المزوّد البديل «${name}» مُفعَّل بإقرارٍ صريح`);
    return name;
  }
  console.warn(`extraction: EXTRACTION_PROVIDER=${name} بلا EXTRACTION_ALLOW_ALT_PROVIDER=true — يُستعمل deepseek`);
  return "deepseek";
}

export function activeProviderName(): string {
  return effectiveProviderName();
}

export function activeProvider() {
  return PROVIDERS[effectiveProviderName()];
}

/** ما يُمنَح لفكّ رمز الفاتورة — شاهدٌ لا يُنتظَر عليه القراءةُ كلُّها */
const QR_BUDGET_MS = 12_000;

/** يقرأ رمز الفاتورة بمهلة: إن طال قيل «لم يُفحص» ومضت القراءة. */
async function readQrWithin(data: Buffer, mimeType: string): Promise<QrReading> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<QrReading>((resolve) => {
    timer = setTimeout(() => resolve({ status: "SKIPPED", reason: "طال فحص الرمز فتُرك" }), QR_BUDGET_MS);
  });
  try {
    return await Promise.race([readZatcaQr(data, mimeType), late]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function extractDocument(request: ExtractionRequest): Promise<ExtractionOutcome> {
  /*
    رمز الفاتورة الضريبيّ يُقرأ **من الملفّ نفسه** والنموذجُ يقرأ — حتميّاً،
    وبلا أن يخرج الملفّ إلى أحد. فيصير شاهداً مستقلّاً على ما يقترحه النموذج.
  */
  const qrPending = readQrWithin(request.data, request.mimeType);
  const outcome = await activeProvider().extract(request);

  /*
    الاشتقاق الحسابيّ هنا — بعد المزوّد وقبل ما سواه.

    فيسري على المزوّدين كلّهم بقاعدةٍ واحدة، ولا يُترَك لكلّ واحدٍ أن
    يجتهد فيه. والنموذج يُطلَب منه النقل، والحسابُ شأنُ الشيفرة.
  */
  if (!outcome.ok) return outcome;

  const evidence = outcome.evidence ?? emptyEvidence();
  evidence.promptVersion ??= PROMPT_VERSION;
  evidence.schemaVersion ??= SCHEMA_VERSION;
  evidence.provider ??= outcome.provider;

  let value = outcome.value;

  /*
    التاريخ كما طُبع إلى صيغته: «13/09/2026» يفهمه الخادم فلا يُعاد عنه السؤال.
    والهجريّ لا يُحوَّل — يُفرَّغ فيبقى مجهولاً (يسدّه رمز الفاتورة إن وُجد، أو إنسان).
  */
  let hijri: string | null = null;
  if (value.invoiceDate.trim() !== "" && !isCalendarDate(value.invoiceDate)) {
    const normalized = normalizeDocumentDate(value.invoiceDate);
    if (normalized) value = { ...value, invoiceDate: normalized };
  }
  if (looksHijri(value.invoiceDate)) {
    hijri = value.invoiceDate;
    value = { ...value, invoiceDate: "" };
  }

  const qr = await qrPending;
  evidence.qr = qr;
  if (qr.status === "FOUND") {
    const reconciled = reconcileWithQr(value, qr.facts, request.companyVat);
    value = reconciled.value;
    evidence.provenance = { ...evidence.provenance, ...reconciled.provenance };
    evidence.agreements = reconciled.agreements;
    evidence.disagreements = reconciled.disagreements;
  }

  if (hijri && value.invoiceDate === "") {
    evidence.unresolvedConflicts = [
      ...evidence.unresolvedConflicts,
      `التاريخ مطبوعٌ هجريّاً «${hijri}» ولم يُحوَّل — اكتب الميلاديّ من الورقة`,
    ];
  }

  /* الصافي = الإجماليّ − الضريبة: هويّةٌ حسابيّة تُعلَّم «محسوب» ولا تُنسَب للنموذج */
  const derived = deriveAmounts(value);
  if (derived.subtotalAmount !== value.subtotalAmount) evidence.provenance.subtotalAmount = "DERIVED";

  return { ...outcome, value: derived, evidence };
}
