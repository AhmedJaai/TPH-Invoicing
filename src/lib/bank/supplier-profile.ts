/**
 * كيف يُسدَّد هذا المورّد عادةً.
 *
 * المطابقة اليوم بلا ذاكرة سلوك: تُقاس كل دفعة كأنّها أوّل دفعة في
 * تاريخ المقهى. وهذا يُهدر أوثق ما يملكه النظام — ما فعله صاحبه مئةَ
 * مرّةٍ قبلها.
 *
 * ثلاثة أنماطٍ يعرفها كل من أدار مقهى:
 *
 *   • **مهلة السداد**: مورّدٌ يُدفَع بعد فاتورته بيومين، وآخر في آخر
 *     الشهر مهما جاءت. فالفاتورة القريبة أرجح عند الأوّل، وفاتورةُ
 *     أوّل الشهر أرجح عند الثاني — ونافذةٌ واحدة لهما تظلم أحدهما.
 *
 *   • **التجميع**: مورّدٌ تُسدَّد فواتيره واحدةً واحدة، وآخر يُسدَّد
 *     شهرياً بحوالةٍ تجمع عشراً. فترجيحُ المجموعات عند الثاني صوابٌ
 *     وعند الأوّل ضجيج.
 *
 *   • **الاستقرار**: مورّدٌ مبالغه متقاربة، وآخر متفاوتة. والشاذّ عند
 *     الأوّل يستحقّ وقفةً لا يستحقّها عند الثاني.
 *
 * **ولا تُبنى ملامح على سابقةٍ أو سابقتين.** ما تحت الحدّ يُعلَن
 * «لا يُعرَف بعد» ولا يُخمَّن — وترجيحٌ مبنيّ على مرّةٍ واحدة أسوأ من
 * لا ترجيح: له ثقةُ الإحصاء بلا سنده.
 *
 * والملامح **ترجّح ولا تحسم**: تحرّك درجةً حُسبت من أدلّة، ولا تُنشئ
 * مطابقةً بلا دليل. فمن سُدّد مئةَ مرّةٍ في يومين قد يُسدَّد اليوم بعد
 * شهر، وذلك لا يجعل السداد غيرَ سداد.
 */

/** أقلّ عدد دفعاتٍ سابقة تُبنى عليها ملامح. */
export const MIN_HISTORY = 5;

export interface PaymentObservation {
  /** أيامٌ بين تاريخ الفاتورة وتاريخ الدفع — سالبٌ يعني دفعاً قبلها. */
  lagDays: number;
  /** كم فاتورة سدّدتها هذه الدفعة. */
  invoiceCount: number;
  amountMinor: number;
}

export interface SupplierProfile {
  supplierId: string;
  /** عدد الدفعات التي بُنيت عليها. */
  sampleSize: number;
  /** وسيط المهلة — الوسيط لا المتوسّط: دفعةٌ متأخّرة شهرين لا تزيح العادة. */
  medianLagDays: number | null;
  /** أوسع مهلة معتادة — الرُّبيع الأعلى. */
  usualMaxLagDays: number | null;
  /** هل يُسدَّد جمعاً عادةً؟ */
  batches: boolean;
  medianInvoicesPerPayment: number | null;
  medianAmountMinor: number | null;
  /** `false` حين لا تكفي السابقة — والجهل يُعلَن ولا يُخمَّن. */
  known: boolean;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)));
  return sorted[idx];
}

export function buildProfile(
  supplierId: string,
  history: readonly PaymentObservation[],
): SupplierProfile {
  if (history.length < MIN_HISTORY) {
    return {
      supplierId,
      sampleSize: history.length,
      medianLagDays: null,
      usualMaxLagDays: null,
      batches: false,
      medianInvoicesPerPayment: null,
      medianAmountMinor: null,
      known: false,
    };
  }

  const counts = history.map((h) => h.invoiceCount);
  const medianCount = median(counts)!;

  return {
    supplierId,
    sampleSize: history.length,
    medianLagDays: median(history.map((h) => h.lagDays)),
    usualMaxLagDays: quantile(history.map((h) => h.lagDays), 0.9),
    /* «جمعاً» = أكثرُ دفعاته تحمل أكثر من فاتورة */
    batches: medianCount >= 2,
    medianInvoicesPerPayment: medianCount,
    medianAmountMinor: median(history.map((h) => h.amountMinor)),
    known: true,
  };
}

/** أقصى تعديلٍ تُحدثه الملامح في الدرجة — ترجيحٌ لا حسم. */
export const MAX_ADJUSTMENT = 0.08;

export interface ProfileFit {
  /** يُضاف إلى الدرجة — موجبٌ أو سالب، وفي حدّ `MAX_ADJUSTMENT`. */
  adjustment: number;
  reason: string | null;
}

/**
 * يقيس موافقة مرشّحٍ لملامح مورّده.
 *
 * والحدّ ضيّق عمداً: الملامح تفصل بين متقاربَين، ولا تجعل بعيداً قريباً.
 * وتوسيعه يجعل النظام يُطابق بالعادة لا بالدليل — وهو بالضبط ما يقع فيه
 * البشر حين يتعبون.
 */
export function fitToProfile(
  profile: SupplierProfile,
  candidate: { lagDays: number; invoiceCount: number },
): ProfileFit {
  if (!profile.known) {
    return { adjustment: 0, reason: null };
  }

  let adjustment = 0;
  const notes: string[] = [];

  if (profile.medianLagDays !== null && profile.usualMaxLagDays !== null) {
    const spread = Math.max(3, Math.abs(profile.usualMaxLagDays - profile.medianLagDays));
    const off = Math.abs(candidate.lagDays - profile.medianLagDays);

    if (off <= spread) {
      adjustment += 0.05;
      notes.push(`المهلة ${candidate.lagDays} يوماً، وعادتُه ${profile.medianLagDays}`);
    } else if (off > spread * 3) {
      adjustment -= 0.05;
      notes.push(`المهلة ${candidate.lagDays} يوماً، وعادتُه ${profile.medianLagDays} — بعيدة`);
    }
  }

  if (profile.medianInvoicesPerPayment !== null) {
    const grouped = candidate.invoiceCount >= 2;
    if (grouped === profile.batches) {
      adjustment += 0.03;
      notes.push(profile.batches ? "يُسدَّد جمعاً وهذه مجموعة" : "يُسدَّد فاتورةً فاتورة");
    } else if (grouped && !profile.batches) {
      adjustment -= 0.03;
      notes.push("لم يُسدَّد جمعاً من قبل");
    }
  }

  const clamped = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, adjustment));
  return {
    adjustment: clamped,
    reason: notes.length > 0 ? notes.join(" · ") : null,
  };
}
