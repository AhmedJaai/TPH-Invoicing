/**
 * واجهة مزوّد الاستخراج.
 *
 * الغرض منها أن يبقى قرار «أي نموذج يقرأ الفاتورة» قابلاً للتبديل بمتغيّر
 * بيئة واحد، فلا يُقيّدنا مزوّد بعينه ولا نعيد كتابة شيء عند تغييره.
 *
 * المزوّدون المتاحون:
 *   claude  — الأدق، مدفوع بالاستخدام، وبياناتك ليست مادة تدريب.
 *   gemini  — طبقة مجانية سخية، لكن جوجل تستخدم بيانات الطبقة المجانية
 *             لتحسين منتجاتها وقد يقرؤها مراجعون بشريون.
 *   ollama  — نموذج رؤية مفتوح المصدر يعمل على جهازك، مجاني تماماً وخاص تماماً،
 *             لكنه أقل دقة ولا يعمل إلا والجهاز مشتغل.
 */
import type { ExtractionResult } from "./schema";

export type ProviderName = "claude" | "gemini" | "ollama";

export interface ExtractionRequest {
  data: Buffer;
  mimeType: string;
  companyVat: string;
  companyName: string;
  supplierNames: string[];
}

export interface ExtractionSuccess {
  ok: true;
  value: ExtractionResult;
  model: string;
  provider: ProviderName;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ExtractionFailure {
  ok: false;
  reason: string;
  provider: ProviderName;
}

export type ExtractionOutcome = ExtractionSuccess | ExtractionFailure;

export interface ExtractionProvider {
  name: ProviderName;
  /** هل المزوّد مهيَّأ فعلاً؟ نفحص قبل المحاولة لنعطي رسالة مفيدة. */
  isConfigured(): boolean;
  extract(request: ExtractionRequest): Promise<ExtractionOutcome>;
}

const PROVIDER_NAMES: readonly ProviderName[] = ["claude", "gemini", "ollama"];

export function selectedProviderName(): ProviderName {
  const raw = (process.env.EXTRACTION_PROVIDER ?? "claude").toLowerCase();
  return (PROVIDER_NAMES as readonly string[]).includes(raw) ? (raw as ProviderName) : "claude";
}

/** التعليمات مشتركة بين المزوّدين حتى تُقارن دقّتهما على أساس واحد. */
export function buildInstructions(
  companyVat: string,
  companyName: string,
  supplierNames: string[],
): string {
  return `أنت مساعد محاسبي دقيق في ${companyName}، مقهى في جدة. مهمتك قراءة مستند مالي واستخراج حقوله حرفياً.

الرقم الضريبي لمنشأتنا: ${companyVat}
نحن دائماً المشتري في هذه المستندات، لا البائع.

موردونا المعروفون: ${supplierNames.join(" · ")}

قواعد الاستخراج:
- انسخ الأرقام كما هي حرفياً. لا تحسب ولا تصحّح ولا تستنتج مبلغاً غائباً.
- إن كان المبلغ غير واضح أو مقطوعاً، اتركه فارغاً واخفض الثقة. الفراغ أأمن من التخمين.
- لا تُركّب رقم فاتورة أبداً. إن لم يظهر رقم مطبوع في المستند فاترك الحقل فارغاً — ولا تشتقّه من التاريخ ولا من اسم المنشأة ولا من رقم الطلب.
- ميّز الرقم الضريبي للبائع عن رقم المشتري بموضعه في المستند لا بشكله. رقمنا ${companyVat} هو رقم المشتري دائماً.
- المستند الذي يحمل «عرض سعر» أو Quotation أو Proforma ليس فاتورة مهما شابهها.
- المستند الذي يجمع عدة عمليات بتواريخ مختلفة ورصيد مُدوَّر هو كشف حساب لا فاتورة. وفي كشف الحساب انسخ كل سطر في statementLines بتاريخه ومرجعه ومدينه ودائنه، وانسخ الرصيدين الافتتاحي والختامي كما هما — ولا تجمع ولا تحسب رصيداً.
- التاريخ بصيغة YYYY-MM-DD ميلادية. إن لم يظهر إلا التاريخ الهجري فحوّله واخفض ثقة التاريخ.
- الثقة تقديرك الصادق للوضوح: المستند الممسوح بجودة رديئة ثقته منخفضة ولو قرأتَه.`;
}
