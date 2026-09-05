/**
 * التسوية الشاملة.
 *
 * كان النظام يمرّ على الحركات واحدةً واحدة، ويحجز الفاتورة لأوّل حركة
 * تطلبها. فقرارٌ مبكّر ضعيف يسرق فاتورةً من مطابقةٍ لاحقة أقوى:
 *
 *   فواتير: ١٬٠٠٠ · ٢٬٠٠٠ · ٣٬٠٠٠
 *   حركتان: ٣٬٠٠٠ · ٣٬٠٠٠
 *
 * فالأولى تأخذ فاتورة الثلاثة آلاف، والثانية تُحرَم من ١٬٠٠٠+٢٬٠٠٠
 * لأنّها لم تعد تجد ما يكفي — أو تأخذها بدرجة أضعف.
 *
 * والحلّ ليس ترتيباً أذكى للجشع: الترتيب بالدرجة يقع في الخطأ نفسه.
 *
 *   حركة أ: فاتورتا ١+٢ بدرجة ٩٥
 *   حركة ب: فاتورة ٢    بدرجة ٩٤
 *   حركة ج: فاتورة ١    بدرجة ٩٣
 *
 * فالجشع يأخذ «أ» أوّلاً لأنّها الأعلى، فيخسر ٩٤+٩٣ = ١٨٧ مقابل ٩٥.
 *
 * فصار بحثاً عن أعلى مجموعٍ ممكن: تفريعٌ وتحديد (branch and bound) على
 * كل تخصيصٍ محتمل، مع قطع الفرع متى استحال أن يبلغ أفضلَ ما وُجد.
 * وهي مسألة صعبة نظرياً، فلها ميزانيّة عقد؛ فإن نفدت رجع إلى الجشع
 * **وأعلن ذلك** في `exact`. والتقريب المعلَن خيرٌ من ادّعاء المثالية.
 */
import type { Candidate } from "./candidates";

export interface Claim {
  transactionId: string;
  candidate: Candidate;
}

export interface Assignment {
  transactionId: string;
  candidate: Candidate;
  /** المرشّح الذي يليه في القوّة — أساس قاعدة الهامش. */
  runnerUpScore: number | null;
}

export interface Unassigned {
  transactionId: string;
  /** أفضل ما وُجد ثمّ سُحبت فواتيره — يُعرَض ليُفهَم سبب الحرمان. */
  bestBlockedScore: number | null;
}

export interface Reconciliation {
  assigned: Assignment[];
  unassigned: Unassigned[];
  /** هل بُلغ الحلّ الأمثل يقيناً، أم نفدت الميزانيّة فرُجع إلى الجشع؟ */
  exact: boolean;
  /** مجموع درجات ما خُصّص — مقياس جودة الحلّ. */
  totalScore: number;
}

/**
 * أقصى عدد عقد يُفحَص قبل الرجوع إلى الجشع.
 *
 * المسألة صعبة نظرياً (تعبئة مجموعات)، فلا يُترَك البحث بلا حدّ في
 * مسارٍ يعمل داخل طلب HTTP. والحدّ سخيّ لأحجام الكشوف الواقعية.
 */
export const NODE_BUDGET = 200_000;

/**
 * يوزّع الفواتير على الحركات بلا تكرار.
 *
 * الترتيب بالدرجة عبر الحركات كلّها — لا بترتيب الحركات. فالمطالبة
 * الأقوى تُخدَم أوّلاً ولو جاءت حركتُها آخر الملفّ.
 *
 * وعند تساوي الدرجة يُقدَّم الأقلّ فواتيرَ: نسبة دفعةٍ إلى فاتورةٍ
 * واحدة أقرب إلى الحقيقة من نسبتها إلى ستّ اجتمعت مصادفةً.
 */
export function reconcile(claims: readonly Claim[]): Reconciliation {
  const byTransaction = new Map<string, Claim[]>();
  for (const c of claims) {
    const list = byTransaction.get(c.transactionId) ?? [];
    list.push(c);
    byTransaction.set(c.transactionId, list);
  }

  /*
    الترتيب: الأقلّ خياراتٍ أوّلاً.

    الحركة التي لها مرشّح واحد تُحسم بلا تفريع، فتقييدها مبكّراً يقطع
    فروعاً كثيرة. وعند التساوي يُرتَّب بالمعرّف كي تثبت النتيجة.
  */
  const groups = [...byTransaction.entries()]
    .map(([transactionId, list]) => ({
      transactionId,
      options: [...list].sort(
        (a, b) =>
          b.candidate.score - a.candidate.score ||
          a.candidate.invoiceIds.length - b.candidate.invoiceIds.length,
      ),
    }))
    .sort(
      (a, b) =>
        a.options.length - b.options.length ||
        a.transactionId.localeCompare(b.transactionId),
    );

  /** أفضل درجةٍ ممكنة لكل مجموعةٍ بعد الحاليّة — أساس القطع. */
  const suffixBest: number[] = new Array(groups.length + 1).fill(0);
  for (let i = groups.length - 1; i >= 0; i--) {
    suffixBest[i] = suffixBest[i + 1] + (groups[i].options[0]?.candidate.score ?? 0);
  }

  let bestScore = -1;
  let bestChoice: (Claim | null)[] = [];
  let nodes = 0;
  let exhausted = false;

  const taken = new Set<string>();
  const current: (Claim | null)[] = new Array(groups.length).fill(null);

  const walk = (index: number, score: number) => {
    if (exhausted) return;
    if (++nodes > NODE_BUDGET) { exhausted = true; return; }

    if (index === groups.length) {
      if (score > bestScore) {
        bestScore = score;
        bestChoice = [...current];
      }
      return;
    }

    // لا يمكن لهذا الفرع أن يبلغ أفضل ما وُجد — يُقطَع
    if (score + suffixBest[index] <= bestScore) return;

    for (const option of groups[index].options) {
      if (option.candidate.invoiceIds.some((id) => taken.has(id))) continue;
      for (const id of option.candidate.invoiceIds) taken.add(id);
      current[index] = option;
      walk(index + 1, score + option.candidate.score);
      current[index] = null;
      for (const id of option.candidate.invoiceIds) taken.delete(id);
      if (exhausted) return;
    }

    // وترك الحركة بلا تخصيص خيارٌ أيضاً: قد يفتح لغيرها ما هو أفضل
    current[index] = null;
    walk(index + 1, score);
  };

  walk(0, 0);

  /*
    نفدت الميزانيّة: يُرجَع إلى الجشع بالدرجة. وهو أضعف، لكنّه معلَنٌ
    في `exact` فلا يُدَّعى ما ليس كذلك.
  */
  if (exhausted || bestScore < 0) {
    const fallback = greedy(groups);
    return { ...fallback, exact: false };
  }

  const chosen = new Map<string, Claim>();
  bestChoice.forEach((claim, i) => {
    if (claim) chosen.set(groups[i].transactionId, claim);
  });

  return { ...collect(groups, chosen), exact: true };
}

/** الجشع بالدرجة — يُستعمل حين تنفد ميزانيّة البحث وحدها. */
function greedy(
  groups: readonly { transactionId: string; options: Claim[] }[],
): Omit<Reconciliation, "exact"> {
  const ordered = groups
    .flatMap((g) => g.options)
    .sort(
      (a, b) =>
        b.candidate.score - a.candidate.score ||
        a.candidate.invoiceIds.length - b.candidate.invoiceIds.length ||
        a.transactionId.localeCompare(b.transactionId),
    );

  const taken = new Set<string>();
  const chosen = new Map<string, Claim>();
  for (const claim of ordered) {
    if (chosen.has(claim.transactionId)) continue;
    if (claim.candidate.invoiceIds.some((id) => taken.has(id))) continue;
    chosen.set(claim.transactionId, claim);
    for (const id of claim.candidate.invoiceIds) taken.add(id);
  }
  return collect(groups, chosen);
}

/**
 * يبني النتيجة من الاختيار، ويحسب الوصيف.
 *
 * والوصيف يُحسب بين ما كان **ممكناً** لهذه الحركة بعد استقرار الحلّ —
 * لا بين كل ما وُلّد. فمرشّحٌ أُخذت فواتيره لحركةٍ أخرى لم يعد منافساً،
 * وحسبانه منافساً يُنتج «تردّداً» كاذباً يوقف مطابقةً صحيحة.
 */
function collect(
  groups: readonly { transactionId: string; options: Claim[] }[],
  chosen: ReadonlyMap<string, Claim>,
): Omit<Reconciliation, "exact"> {
  const taken = new Set<string>();
  for (const claim of chosen.values()) {
    for (const id of claim.candidate.invoiceIds) taken.add(id);
  }

  const assigned: Assignment[] = [];
  const unassigned: Unassigned[] = [];
  let totalScore = 0;

  for (const g of groups) {
    const claim = chosen.get(g.transactionId);
    if (!claim) {
      unassigned.push({
        transactionId: g.transactionId,
        bestBlockedScore: g.options.length > 0
          ? Math.max(...g.options.map((c) => c.candidate.score))
          : null,
      });
      continue;
    }

    const mine = new Set(claim.candidate.invoiceIds);
    const rivals = g.options
      .filter((c) => c !== claim)
      .filter((c) => c.candidate.invoiceIds.every((id) => !taken.has(id) || mine.has(id)))
      .map((c) => c.candidate.score);

    totalScore += claim.candidate.score;
    assigned.push({
      transactionId: g.transactionId,
      candidate: claim.candidate,
      runnerUpScore: rivals.length > 0 ? Math.max(...rivals) : null,
    });
  }

  return {
    assigned: assigned.sort((a, b) => b.candidate.score - a.candidate.score),
    unassigned: unassigned.sort((a, b) => a.transactionId.localeCompare(b.transactionId)),
    totalScore,
  };
}
