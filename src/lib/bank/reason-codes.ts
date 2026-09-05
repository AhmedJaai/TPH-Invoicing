/**
 * أسبابٌ تُتحقَّق، لا نصٌّ يُصدَّق.
 *
 * كان الحَكَم يُرجع جملةً: «اخترتُه لأنّه يبدو الأقرب». وهي لا تُفحَص:
 * قد يقول «المرجع مطابق» ودرجةُ المرجع صفر — فيمرّ سببٌ لم يقع.
 *
 * فصارت الأسباب **رموزاً محدودة**، ويُقابَل كلٌّ منها بما حسبه النظام.
 * فإن ادّعى النموذج دليلاً ليس موجوداً، رُدّ السبب — وإن سقطت أسبابه
 * كلّها رُدّ حكمه.
 *
 * وهذا هو الفرق بين «النموذج اختار» و**«النموذج أثبت»**.
 */
import type { ScoreParts } from "./candidates";

export type ReasonCode =
  | "BENEFICIARY_MATCH"        // اسم المستفيد يطابق المورّد
  | "ACCOUNT_MATCH"            // رقم حساب أو آيبان معروف
  | "REFERENCE_MATCH"          // المرجع يطابق رقم الفاتورة
  | "AMOUNT_EXACT"             // المبلغ يطابق تماماً
  | "AMOUNT_CLOSE"             // قريبٌ ضمن حدّ
  | "DATE_CLOSE"               // التاريخ قريب
  | "HISTORICAL_PATTERN"       // نمطٌ سابق مؤكَّد
  | "CANDIDATE_MARGIN"         // يسبق التالي بفارق واضح
  | "ONLY_CANDIDATE";          // لا منافس له

export const REASON_LABEL: Record<ReasonCode, string> = {
  BENEFICIARY_MATCH: "اسم المستفيد يطابق المورّد",
  ACCOUNT_MATCH: "الحساب أو الآيبان معروف",
  REFERENCE_MATCH: "المرجع يطابق رقم الفاتورة",
  AMOUNT_EXACT: "المبلغ يطابق تماماً",
  AMOUNT_CLOSE: "المبلغ قريب",
  DATE_CLOSE: "التاريخ قريب",
  HISTORICAL_PATTERN: "نمطٌ سابق أكّدتَه",
  CANDIDATE_MARGIN: "يسبق التالي بفارق واضح",
  ONLY_CANDIDATE: "لا منافس له",
};

export const ALL_REASON_CODES = Object.keys(REASON_LABEL) as ReasonCode[];

/**
 * ما تُثبته الأرقام فعلاً.
 *
 * تُحسب من درجات المرشّح لا من كلام النموذج — وهي المرجع الذي يُقابَل
 * به ادّعاؤه.
 */
export interface EvidenceFacts {
  parts: ScoreParts;
  /** فارق الدرجة عن المرشّح التالي، أو `null` إن لم يوجد. */
  margin: number | null;
  /** هل أكّد إنسانٌ هذا المستفيد من قبل؟ */
  hasMemory: boolean;
  /** هل عُرف حسابٌ أو آيبان؟ */
  hasAccountEvidence: boolean;
}

/** أدنى درجةٍ يُعدّ عندها البُعد دليلاً قائماً. */
const PRESENT = 0.5;

/**
 * هل هذا السبب قائمٌ فعلاً؟
 *
 * والحدود متعمَّدة الوضوح: «المبلغ يطابق تماماً» تعني درجةً كاملة لا
 * قريبة. فمن ادّعى التطابق التامّ ولم يقع، رُدّ ادّعاؤه.
 */
export function holds(code: ReasonCode, facts: EvidenceFacts): boolean {
  switch (code) {
    case "BENEFICIARY_MATCH": return facts.parts.supplier >= PRESENT;
    case "ACCOUNT_MATCH": return facts.hasAccountEvidence;
    case "REFERENCE_MATCH": return facts.parts.reference > 0;
    case "AMOUNT_EXACT": return facts.parts.amount === 1;
    case "AMOUNT_CLOSE": return facts.parts.amount > 0;
    case "DATE_CLOSE": return facts.parts.date >= PRESENT;
    case "HISTORICAL_PATTERN": return facts.hasMemory;
    case "CANDIDATE_MARGIN": return facts.margin !== null && facts.margin >= 0.05;
    case "ONLY_CANDIDATE": return facts.margin === null;
  }
}

export interface ReasonAudit {
  upheld: ReasonCode[];
  /** ما ادّعاه النموذج ولم يقع. */
  refuted: ReasonCode[];
  /** رموزٌ ليست من القائمة أصلاً. */
  unknown: string[];
}

/**
 * يفحص أسباب النموذج.
 *
 * ولا يُكتفى بعدّ الصحيح: المردود يُذكَر بعينه، فمن يراجع بعد شهر يرى
 * ما ادّعاه النموذج ولم يقع — وهو أنفع من درجةٍ مجرّدة.
 */
export function auditReasons(
  claimed: readonly string[],
  facts: EvidenceFacts,
): ReasonAudit {
  const upheld: ReasonCode[] = [];
  const refuted: ReasonCode[] = [];
  const unknown: string[] = [];

  for (const raw of claimed) {
    const code = raw.trim().toUpperCase() as ReasonCode;
    if (!ALL_REASON_CODES.includes(code)) {
      unknown.push(raw);
      continue;
    }
    if (holds(code, facts)) upheld.push(code);
    else refuted.push(code);
  }

  return { upheld, refuted, unknown };
}

/**
 * جودة الأدلّة: نسبة ما صحّ ممّا ادّعى.
 *
 * `null` حين لا يدّعي شيئاً — وهو حالٌ يختلف عن ادّعاءٍ سقط كلّه.
 */
export function evidenceQuality(audit: ReasonAudit): number | null {
  const total = audit.upheld.length + audit.refuted.length + audit.unknown.length;
  if (total === 0) return null;
  return audit.upheld.length / total;
}
