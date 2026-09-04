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
 * والحلّ ليس ترتيباً أذكى للجشع، بل النظر إلى الفترة كلّها: تُرتَّب
 * المطالبات بدرجتها لا بترتيب ورودها، ويُمنَع تخصيص فاتورةٍ مرّتين.
 * وهذا يبقى تقريباً لا حلّاً أمثل تامّاً — والتقريب المعلَن خيرٌ من
 * ادّعاء المثالية.
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
}

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

  const ordered = [...claims].sort(
    (a, b) =>
      b.candidate.score - a.candidate.score ||
      a.candidate.invoiceIds.length - b.candidate.invoiceIds.length ||
      a.transactionId.localeCompare(b.transactionId),
  );

  const takenInvoices = new Set<string>();
  const settled = new Set<string>();
  const assigned: Assignment[] = [];

  for (const claim of ordered) {
    if (settled.has(claim.transactionId)) continue;
    if (claim.candidate.invoiceIds.some((id) => takenInvoices.has(id))) continue;

    /*
      الوصيف يُحسب بين ما بقي ممكناً لهذه الحركة وقت القرار — لا بين كل
      ما وُلّد. فمرشّحٌ سُحبت فواتيره لم يعد منافساً، وحسبانه منافساً
      يُنتج «تردّداً» كاذباً يوقف مطابقةً صحيحة.
    */
    const alternatives = (byTransaction.get(claim.transactionId) ?? [])
      .filter((c) => c !== claim)
      .filter((c) => !c.candidate.invoiceIds.some((id) => takenInvoices.has(id)))
      .map((c) => c.candidate.score);

    assigned.push({
      transactionId: claim.transactionId,
      candidate: claim.candidate,
      runnerUpScore: alternatives.length > 0 ? Math.max(...alternatives) : null,
    });

    settled.add(claim.transactionId);
    for (const id of claim.candidate.invoiceIds) takenInvoices.add(id);
  }

  const unassigned: Unassigned[] = [];
  for (const [transactionId, list] of byTransaction) {
    if (settled.has(transactionId)) continue;
    unassigned.push({
      transactionId,
      bestBlockedScore: list.length > 0 ? Math.max(...list.map((c) => c.candidate.score)) : null,
    });
  }

  return {
    assigned: assigned.sort((a, b) => b.candidate.score - a.candidate.score),
    unassigned: unassigned.sort((a, b) => a.transactionId.localeCompare(b.transactionId)),
  };
}
