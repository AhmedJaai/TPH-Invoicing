/**
 * الحَكَم: أين يُستدعى الذكاء الاصطناعي، وأين لا يُستدعى.
 *
 * والقاعدة التي تحكم هذا الملفّ كلّه: **لا يُستدعى إلّا حين تعجز
 * القواعد.** أكثر الحركات تُحسم ببنيتها أو بذاكرة أكّدها إنسان —
 * وإرسالها إلى نموذجٍ إهدارٌ للمال وللوقت، وإضعافٌ للدقّة: النموذج قد
 * يخطئ فيما لا يخطئ فيه الحساب.
 *
 * وحين يُستدعى، لا يُعطى الملفّ ولا القاعدة: يُعطى **مرشّحين مولَّدين
 * حسابياً** ويُسأل أيّهم. فهو يرجّح بين معلومات، ولا يخترع واحدة.
 *
 * وهذا الملفّ **يقرّر متى** فقط. والاستدعاء نفسه ليس مبنيّاً بعد،
 * ولا يُدَّعى أنّه كذلك.
 */
import type { Candidate } from "./candidates";
import type { Decision } from "./decision";

export type AdjudicationReason =
  | "CLOSE_CANDIDATES"     // مرشّحان متقاربان — النظام لا يعرف أيّهما
  | "UNKNOWN_HIGH_VALUE"   // مبلغ كبير ومستفيد مجهول
  | "CONFLICTING_EVIDENCE" // أدلّة تتناقض
  | "NONE";

export interface AdjudicationCase {
  transactionId: string;
  reason: AdjudicationReason;
  /** ما يُعرَض على الحَكَم — مرشّحون مولَّدون، لا بيانات خام. */
  candidates: Candidate[];
  /** لماذا احتاج حَكَماً. */
  note: string;
}

/**
 * الحدّ الذي يصير عنده المبلغ المجهول مستحقّاً للتحكيم.
 *
 * ألف ريال: ما دونها لا يستحقّ كلفة نموذج، وحلّه بيد صاحب العمل أسرع.
 */
export const HIGH_VALUE_MINOR = 100_000;

/** الفارق الذي يُعدّ عنده المرشّحان متقاربين. */
export const CLOSE_MARGIN = 0.05;

export interface CaseInput {
  transactionId: string;
  amountMinor: number;
  supplierId: string | null;
  candidates: readonly Candidate[];
  decision: Decision | null;
}

/**
 * أيّ الحركات تستحقّ حَكَماً — وأيّها لا.
 *
 * والترتيب مقصود: ما حُسم تلقائياً لا يُعاد فيه النظر أبداً. إرسال
 * المحسوم إلى نموذجٍ يفتح باب أن ينقض ما ثبت بالحساب.
 */
export function needsAdjudication(input: CaseInput): AdjudicationCase | null {
  if (input.decision?.disposition === "AUTO") return null;

  const [top, second] = input.candidates;

  if (top && second && top.score - second.score < CLOSE_MARGIN) {
    return {
      transactionId: input.transactionId,
      reason: "CLOSE_CANDIDATES",
      candidates: [top, second, ...input.candidates.slice(2, 5)],
      note:
        `مرشّحان متقاربان (${Math.round(top.score * 100)} و${Math.round(second.score * 100)}) — ` +
        "الحساب لا يفصل بينهما",
    };
  }

  if (input.supplierId === null && input.amountMinor >= HIGH_VALUE_MINOR) {
    return {
      transactionId: input.transactionId,
      reason: "UNKNOWN_HIGH_VALUE",
      candidates: [],
      note: `مبلغ كبير (${input.amountMinor / 100} ريالاً) ومستفيده مجهول`,
    };
  }

  return null;
}

export interface AdjudicationPlan {
  cases: AdjudicationCase[];
  /** كم حركةً استُغني عن التحكيم فيها — وهو المكسب. */
  skipped: number;
  /** نسبة ما يحتاج نموذجاً من الكلّ. */
  rate: number;
}

/**
 * يخطّط التحكيم لدفعة كاملة.
 *
 * والمقصود من هذه الدالّة أن تُظهر أنّ النسبة صغيرة: ثلاثمئة حركة
 * تُحسم منها مئتان وسبعون بالحساب، ويُسأل عن ستّ. وهذا هو الفرق بين
 * استعمال الذكاء وإدمانه.
 */
export function planAdjudication(inputs: readonly CaseInput[]): AdjudicationPlan {
  const cases: AdjudicationCase[] = [];
  for (const i of inputs) {
    const c = needsAdjudication(i);
    if (c) cases.push(c);
  }
  return {
    cases,
    skipped: inputs.length - cases.length,
    rate: inputs.length === 0 ? 0 : cases.length / inputs.length,
  };
}
