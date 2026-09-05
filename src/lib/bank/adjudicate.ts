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
 * وهذا الملفّ **يقرّر متى** وأيّ **نوعٍ** من الغموض. والاستدعاء في
 * `services/adjudicator.service.ts`.
 */
import type { Candidate } from "./candidates";
import type { Decision } from "./decision";
import type { EntityCandidate } from "./entity-candidates";
import { highValueThreshold } from "./verdict-policy";

export type AdjudicationReason =
  | "CLOSE_CANDIDATES"     // مرشّحان متقاربان — النظام لا يعرف أيّهما
  | "UNKNOWN_HIGH_VALUE"   // مبلغ كبير ومستفيد مجهول
  | "CONFLICTING_EVIDENCE" // أدلّة تتناقض
  | "NONE";

/**
 * نوع الغموض — وهما مختلفان لا واحد.
 *
 * كان النظام يخلطهما: يُنشئ لحركةٍ مجهولة المستفيد حالةَ تحكيمٍ
 * **بلا مرشّحي فواتير**، والحَكَم يرفض ما لا مرشّح له. فالمسار الذي
 * صُمّم لأخطر الحالات — مبلغٌ كبير وجهةٌ مجهولة — كان ميّتاً.
 *
 *   `INVOICE` : نعرف الجهة ونختلف أيّ فاتورة.
 *   `ENTITY`  : لا نعرف من هي الجهة أصلاً.
 */
export type AdjudicationKind = "INVOICE" | "ENTITY";

export interface AdjudicationCase {
  transactionId: string;
  kind: AdjudicationKind;
  reason: AdjudicationReason;
  /** مرشّحو الفواتير — لحالة `INVOICE`. */
  candidates: Candidate[];
  /** مرشّحو الجهات — لحالة `ENTITY`. */
  entityCandidates: EntityCandidate[];
  /** لماذا احتاج حَكَماً. */
  note: string;
}

/**
 * الحدّ الذي يصير عنده المبلغ المجهول مستحقّاً للتحكيم.
 *
 * يُحسب من وسيط حركات المقهى — راجع `verdict-policy.ts`. وكان ثابتاً
 * بألف ريال، وهو رقمٌ لا يعني الشيء نفسه في مقهىً يشتري بعشرة آلاف
 * شهرياً وفي آخر يشتري بمئة ألف.
 */
export const HIGH_VALUE_MINOR = 100_000;

/** الفارق الذي يُعدّ عنده المرشّحان متقاربين. */
export const CLOSE_MARGIN = 0.05;

export interface CaseInput {
  transactionId: string;
  amountMinor: number;
  supplierId: string | null;
  candidates: readonly Candidate[];
  /** ما رُشِّح من الجهات حين جُهل المستفيد. */
  entityCandidates?: readonly EntityCandidate[];
  decision: Decision | null;
  /** وسيط حركات المقهى — الكبير نسبيّ لا ثابت. */
  medianAmountMinor?: number | null;
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
      kind: "INVOICE",
      reason: "CLOSE_CANDIDATES",
      candidates: [top, second, ...input.candidates.slice(2, 5)],
      entityCandidates: [],
      note:
        `مرشّحان متقاربان (${Math.round(top.score * 100)} و${Math.round(second.score * 100)}) — ` +
        "الحساب لا يفصل بينهما",
    };
  }

  /*
    مجهول المستفيد وكبير القيمة: حالةُ **جهة** لا حالةُ فاتورة. وتُرسَل
    بمرشّحي جهات — فإن لم يُرشَّح أحد فلا شيء يُسأل عنه، ويبقى للإنسان.
  */
  const threshold = highValueThreshold(input.medianAmountMinor ?? null);
  const entities = input.entityCandidates ?? [];

  if (input.supplierId === null && input.amountMinor >= threshold && entities.length > 0) {
    return {
      transactionId: input.transactionId,
      kind: "ENTITY",
      reason: "UNKNOWN_HIGH_VALUE",
      candidates: [],
      entityCandidates: [...entities],
      note:
        `مبلغ كبير (${(input.amountMinor / 100).toFixed(2)} ريالاً) ومستفيده مجهول — ` +
        `و${entities.length} جهةً مرشَّحة`,
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
