/**
 * بينك وبين المقهى — ما دفعه المالكُ من جيبه للمقهى، وما أخذه منه.
 *
 * ثلاثةُ مصادر كانت متفرّقة ولا يجمعها شيء:
 *   - دفعاتُ مورّدين بطريقة `OWNER_ACCOUNT` — سدّدها من حسابه الشخصيّ (له)؛
 *   - واردُ البنك المصنَّف «تحويل شخصيّ» — مالٌ أدخله إلى حساب المقهى (له)؛
 *   - صادرُ البنك المصنَّف «تحويل شخصيّ» — مالٌ أخذه من المقهى (عليه).
 *
 * والرصيدُ الجاري = ما له − ما عليه: موجبٌ «المقهى مدينٌ لك»، سالبٌ «سحبتَ
 * أكثر ممّا أدخلت». **جمعٌ لما صُنّف وقُيّد لا حكمٌ محاسبيّ**: الحركةُ التي لم
 * تُصنَّف «شخصيّة» ليست هنا، وما دُفع نقداً من جيبه بلا قيدٍ لا يُعرف.
 *
 * دالّةٌ خالصة — أعدادٌ صحيحة بالهللات.
 */

export type OwnerEntryKind =
  /** سدّد مورّداً من حسابه الشخصيّ */
  | "PAID_FOR_CAFE"
  /** حوّل إلى حساب المقهى */
  | "PUT_IN"
  /** حوّل من حساب المقهى إلى نفسه */
  | "TOOK_OUT";

export interface OwnerEntry {
  id: string;
  /** YYYY-MM-DD بتوقيت الرياض. */
  day: string;
  kind: OwnerEntryKind;
  amountMinor: number;
  label: string;
  /** موضعُ السجلّ — حركةُ البنك أو ملفُّ المورّد. */
  href: string;
  /** سدادُ المورّد (`PAID_FOR_CAFE`) وحده: معرّفُه، وأمِن تحويلات المقهى سُدّد (083) */
  payment?: { id: string; fromTransfers: boolean };
}

export const OWNER_ENTRY_LABEL: Record<OwnerEntryKind, string> = {
  PAID_FOR_CAFE: "سدّدت عن المقهى",
  PUT_IN: "أدخلت إلى الحساب",
  TOOK_OUT: "أخذت من الحساب",
};

/** أثرُ القيد على الرصيد: ما له موجب، وما عليه سالب. */
export function signedMinor(e: Pick<OwnerEntry, "kind" | "amountMinor">): number {
  return e.kind === "TOOK_OUT" ? -e.amountMinor : e.amountMinor;
}

export interface OwnerLine extends OwnerEntry {
  /** الرصيدُ بعد هذا القيد — من أوّل ما في السجلّ. */
  balanceMinor: number;
}

export interface OwnerYear {
  year: string;
  paidForCafeMinor: number;
  putInMinor: number;
  tookOutMinor: number;
  /** ما له − ما عليه في هذه السنة وحدها. */
  netMinor: number;
}

export interface OwnerAccount {
  /** الأحدثُ أوّلاً، وكلٌّ برصيده بعده. */
  lines: OwnerLine[];
  years: OwnerYear[];
  paidForCafeMinor: number;
  putInMinor: number;
  tookOutMinor: number;
  balanceMinor: number;
}

export function buildOwnerAccount(entries: readonly OwnerEntry[]): OwnerAccount {
  const ordered = [...entries].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
  const years = new Map<string, OwnerYear>();
  const lines: OwnerLine[] = [];
  let balance = 0;
  let paid = 0;
  let put = 0;
  let took = 0;

  for (const e of ordered) {
    balance += signedMinor(e);
    lines.push({ ...e, balanceMinor: balance });
    const year = e.day.slice(0, 4);
    const y = years.get(year) ?? { year, paidForCafeMinor: 0, putInMinor: 0, tookOutMinor: 0, netMinor: 0 };
    if (e.kind === "PAID_FOR_CAFE") { y.paidForCafeMinor += e.amountMinor; paid += e.amountMinor; }
    if (e.kind === "PUT_IN") { y.putInMinor += e.amountMinor; put += e.amountMinor; }
    if (e.kind === "TOOK_OUT") { y.tookOutMinor += e.amountMinor; took += e.amountMinor; }
    y.netMinor += signedMinor(e);
    years.set(year, y);
  }

  return {
    lines: lines.reverse(),
    years: [...years.values()].sort((a, b) => b.year.localeCompare(a.year)),
    paidForCafeMinor: paid,
    putInMinor: put,
    tookOutMinor: took,
    balanceMinor: balance,
  };
}
