/**
 * رصيدا أوّل الشهر وآخره من عمود «الرصيد» في كشف البنك.
 *
 * كانت معادلة التسوية مبنيّةً بلا مُدخلات: `reconciliation_periods` فارغٌ
 * ولا شيفرة تكتبه، فيقول الإقفال كلّ شهر «المعادلة لا تُفحَص» — والقارئ
 * يقرأ الرصيد من كلّ صفّ ثمّ يرميه. فصار يُحفَظ.
 *
 * ولا يُخترَع رصيد: يُقبَل الشهر إن كانت كلّ حركاته تحمل رصيداً وكانت
 * السلسلة متّسقة (الرصيد بعد = الرصيد قبل ± المبلغ) خطوةً خطوة. وترتيب
 * الملفّ قد يكون الأحدث أوّلاً أو الأقدم أوّلاً، فيُختار الاتّجاه الذي
 * تستقيم عليه السلسلة. وما لا يستقيم يبقى مجهولاً — لا صفراً.
 */
import { monthEndDay } from "@/lib/riyadh-time";
import { monthOf } from "@/lib/filing";

export interface BalanceRow {
  rowNumber: number;
  valueDate: Date;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  balanceMinor?: number;
}

export interface MonthBalance {
  month: string;
  periodStart: string;
  periodEnd: string;
  openingMinor: number;
  closingMinor: number;
  rows: number;
}

const signed = (r: BalanceRow) => (r.direction === "CREDIT" ? r.amountMinor : -r.amountMinor);

function consistentSteps(chrono: readonly BalanceRow[]): boolean[] {
  const ok: boolean[] = [true];
  for (let i = 1; i < chrono.length; i++) {
    ok.push(chrono[i].balanceMinor === (chrono[i - 1].balanceMinor as number) + signed(chrono[i]));
  }
  return ok;
}

export function monthBalancesFromStatement(rows: readonly BalanceRow[]): MonthBalance[] {
  const inFile = [...rows].sort((a, b) => a.rowNumber - b.rowNumber);
  if (inFile.length < 2 || inFile.some((r) => r.balanceMinor === undefined)) {
    /* صفٌّ بلا رصيد يقطع السلسلة — فلا يُبنى على نصفها */
    if (inFile.filter((r) => r.balanceMinor !== undefined).length < 2) return [];
  }

  const forward = inFile;
  const backward = [...inFile].reverse();
  const score = (list: readonly BalanceRow[]) =>
    consistentSteps(list.filter((r) => r.balanceMinor !== undefined)).filter(Boolean).length;
  const chrono = score(forward) >= score(backward) ? forward : backward;

  const byMonth = new Map<string, BalanceRow[]>();
  for (const r of chrono) {
    const m = monthOf(r.valueDate);
    const list = byMonth.get(m) ?? [];
    list.push(r);
    byMonth.set(m, list);
  }

  const out: MonthBalance[] = [];
  for (const [month, list] of byMonth) {
    if (list.some((r) => r.balanceMinor === undefined)) continue;
    const steps = consistentSteps(list);
    if (steps.some((s) => !s)) continue;
    const first = list[0];
    const last = list[list.length - 1];
    out.push({
      month,
      periodStart: `${month}-01`,
      periodEnd: monthEndDay(month),
      openingMinor: (first.balanceMinor as number) - signed(first),
      closingMinor: last.balanceMinor as number,
      rows: list.length,
    });
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * يومُ الرصيد الختاميّ: آخرُ حركةٍ في فترته إن وُجدت، وإلّا آخرُ الفترة ما لم
 * يكن بعد اليوم — فرصيدٌ أُدخل بيدٍ لشهرٍ لم ينتهِ لا يُنسَب إلى يومٍ لم يأتِ،
 * ويُعرَض بلا تاريخ (`null`) لا بتاريخٍ كاذب.
 */
export function balanceAsOf(periodEnd: string, lastTransactionDay: string | null, today: string): string | null {
  if (lastTransactionDay !== null && lastTransactionDay <= periodEnd) return lastTransactionDay;
  return periodEnd <= today ? periodEnd : null;
}
