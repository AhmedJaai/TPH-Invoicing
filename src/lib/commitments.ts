/**
 * تقويمُ الالتزامات — يوماً بيوم ما يُدفع وما ينتهي.
 *
 * «النقد القادم» يعرض مراحل، وموعدُ الإقرار في صفحته، وانتهاءُ الرخص في صفحتها.
 * ولا عرضَ واحداً يقول «ماذا يستحقّ يومَ ١٥؟». هنا تُجمع من مصادرها نفسها — لا
 * حسابٌ ثانٍ: دفعتا المورّدين، والمتكرّرُ بيومه (`occursIn`)، وآخرُ يومٍ للإقرار،
 * وانتهاءُ الوثائق.
 *
 * **ولا يُخترَع يومٌ لما يومُه مجهول**: المتكرّرُ بلا يومٍ يُسرَد «بلا يوم» في شهره.
 * والمبلغُ المجهول `null` (ضريبةُ ربعٍ ينقصه كشف، ووثيقةٌ لا مبلغَ لها) — لا صفر،
 * ولا يدخل مجموعَ اليوم.
 *
 * دالّةٌ خالصة.
 */
import { occursIn, PAYDAY, withoutPayrollDuplicates, type PayrollDue, type RecurringInput, type SupplierDue, type VatDue } from "./cash-outlook";
import { daysInMonth, formatMonth } from "@/lib/riyadh-time";
import { countNoun, SUPPLIER } from "./arabic";
import { addMonths } from "./filing";

export type CommitmentKind = "SUPPLIER_RUN" | "RECURRING" | "VAT" | "EXPIRY" | "PAYROLL";

export const COMMITMENT_LABEL: Record<CommitmentKind, string> = {
  SUPPLIER_RUN: "دفعة المورّدين",
  RECURRING: "متكرر",
  VAT: "ضريبة",
  EXPIRY: "وثيقة تنتهي",
  PAYROLL: "رواتب",
};

export interface Commitment {
  id: string;
  kind: CommitmentKind;
  label: string;
  sub?: string;
  /** `null`: لا مبلغَ له (وثيقة) أو لا يُعرف (ضريبةٌ ينقصها كشف). */
  amountMinor: number | null;
  /** غيابُه: لا صفحةَ يفتحها هذا الدور (الرواتب للمالك وحده) */
  href?: string;
}

export interface CommitmentDay {
  /** YYYY-MM-DD */
  day: string;
  items: Commitment[];
  /** مجموعُ ما عُرف مبلغُه وحده. */
  totalMinor: number;
  /** فيه ما لا يُعرف مبلغُه من المال (لا الوثائق). */
  hasUnknown: boolean;
  past: boolean;
  today: boolean;
}

export interface CommitmentsInput {
  /** YYYY-MM-DD بتوقيت الرياض. */
  today: string;
  /** أوّلُ الشهور المعروضة — YYYY-MM. */
  fromMonth: string;
  /** كم شهراً. */
  months: number;
  /** ما بقي من دفعة الشهر المنقضي — موعدُه كان أوّلَ هذا الشهر. */
  overdueRun: readonly SupplierDue[];
  /** فواتيرُ هذا الشهر حتى اليوم — تُدفع أوّلَ القادم. */
  nextRun: readonly SupplierDue[];
  recurring: readonly RecurringInput[];
  /** متكرّرٌ قُيِّد دفعُه هذا الشهر — لا يُعرض مستحقّاً ثانيةً. */
  paidThisMonth?: ReadonlySet<string>;
  vat: readonly VatDue[];
  expiries: readonly { id: string; title: string; kindLabel: string; expiresOn: string }[];
  /** الرواتبُ الباقية من المسيّر — يومُها ٢٥، والماضي متأخّر */
  payroll?: readonly PayrollDue[];
  /** يرى المسيّر — وإلّا يُعرض السطرُ بلا رابط */
  payrollHref?: boolean;
}

export interface Commitments {
  days: CommitmentDay[];
  /** ما يقع في شهرٍ معروض ولا يُعرف يومُه. */
  undated: { month: string; items: Commitment[] }[];
  /** موعدُه قبل أوّل شهرٍ معروض وما زال قائماً — ضريبةٌ فات موعدُها، وثيقةٌ انتهت. */
  overdue: Commitment[];
  totalMinor: number;
}


const sum = (list: readonly SupplierDue[]) => list.reduce((s, x) => s + Math.max(0, x.amountMinor), 0);

export function buildCommitments(input: CommitmentsInput): Commitments {
  const thisMonth = input.today.slice(0, 7);
  const months = Array.from({ length: input.months }, (_, i) => addMonths(input.fromMonth, i));
  const lastMonth = months[months.length - 1];
  const firstDay = `${input.fromMonth}-01`;
  const byDay = new Map<string, Commitment[]>();
  const undated = new Map<string, Commitment[]>();
  const overdue: Commitment[] = [];
  const put = (day: string, c: Commitment) => {
    if (day < firstDay) overdue.push(c);
    else if (day.slice(0, 7) <= lastMonth) byDay.set(day, [...(byDay.get(day) ?? []), c]);
  };

  /* دفعتا المورّدين: المنقضيةُ موعدُها أوّلُ هذا الشهر، والجاريةُ أوّلُ القادم */
  const overdueMinor = sum(input.overdueRun);
  if (overdueMinor > 0) {
    put(`${thisMonth}-01`, {
      id: "run:overdue", kind: "SUPPLIER_RUN", label: "دفعة الشهر الماضي، لم تُحوَّل بعد",
      sub: countNoun(input.overdueRun.filter((s) => s.amountMinor > 0).length, SUPPLIER), amountMinor: overdueMinor, href: "/payments",
    });
  }
  const nextMinor = sum(input.nextRun);
  if (nextMinor > 0) {
    put(`${addMonths(thisMonth, 1)}-01`, {
      id: "run:next", kind: "SUPPLIER_RUN", label: "دفعة هذا الشهر",
      sub: "من الفواتير المسجّلة حتى اليوم، وتزيد مع كل فاتورة جديدة", amountMinor: nextMinor, href: "/payments",
    });
  }

  for (const p of input.payroll ?? []) {
    if (p.amountMinor <= 0) continue;
    put(`${p.month}-${String(PAYDAY).padStart(2, "0")}`, {
      id: `pay:${p.month}`, kind: "PAYROLL", label: `رواتب ${formatMonth(p.month)}${p.month < thisMonth ? "، لم تُحوَّل كاملة" : ""}`,
      sub: `${p.people === 1 ? "موظف واحد" : p.people === 2 ? "موظفان" : `${p.people} موظفين`}${p.unknownPeople > 0 ? ` · ومعهم ${p.unknownPeople} بلا راتب مكتوب لم يُحسب` : ""}`,
      amountMinor: p.amountMinor,
      ...(input.payrollHref ? { href: `/payroll?month=${p.month}` } : {}),
    });
  }

  for (const month of months) {
    for (const r of withoutPayrollDuplicates(input.recurring, input.payroll)) {
      const o = occursIn(r, month);
      if (!o.occurs) continue;
      if (month === thisMonth && input.paidThisMonth?.has(r.id)) continue;
      const c: Commitment = { id: `rec:${r.id}:${month}`, kind: "RECURRING", label: r.label, amountMinor: r.amountMinor, href: "/settings#recurring" };
      if (o.day === null) undated.set(month, [...(undated.get(month) ?? []), c]);
      else put(`${month}-${String(Math.min(o.day, daysInMonth(month))).padStart(2, "0")}`, c);
    }
  }

  for (const v of input.vat) {
    /* رصيدٌ دائن أو صفرٌ معلوم لا خروجَ فيه — لكنّ الإقرار يُقدَّم في موعده، فيبقى في التقويم بلا مبلغٍ يُدفع */
    put(v.deadline, {
      id: `vat:${v.periodKey}`,
      kind: "VAT",
      label: `آخر موعد لإقرار ${v.label}`,
      sub: v.amountMinor === null ? "المبلغ غير معروف، لأن أحد أشهره بلا كشف بنك"
        : v.amountMinor <= 0 ? "لا مبلغ مستحق السداد الآن، لكن يجب تقديم الإقرار"
        : v.accruing ? "المبلغ حتى اليوم، وسيزيد" : undefined,
      amountMinor: v.amountMinor === null ? null : Math.max(0, v.amountMinor),
      href: `/close/vat?period=${v.periodKey}`,
    });
  }

  for (const e of input.expiries) {
    put(e.expiresOn, {
      id: `exp:${e.id}`, kind: "EXPIRY", label: e.title, sub: `${e.kindLabel} — ${e.expiresOn < input.today ? "انتهت" : "تنتهي"}`,
      amountMinor: null, href: "/settings/obligations",
    });
  }

  const days: CommitmentDay[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, items]) => {
      const sorted = [...items].sort((a, b) => (b.amountMinor ?? -1) - (a.amountMinor ?? -1) || a.label.localeCompare(b.label));
      return {
        day,
        items: sorted,
        totalMinor: sorted.reduce((s, c) => s + (c.amountMinor ?? 0), 0),
        hasUnknown: sorted.some((c) => c.amountMinor === null && c.kind !== "EXPIRY"),
        past: day < input.today,
        today: day === input.today,
      };
    });

  return {
    days,
    undated: months.flatMap((month) => (undated.has(month) ? [{ month, items: undated.get(month) ?? [] }] : [])),
    overdue,
    totalMinor: days.reduce((s, d) => s + d.totalMinor, 0),
  };
}
