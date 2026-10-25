/**
 * النقد القادم — إسقاطٌ ممّا هو معلوم وحده، لا تخمين.
 *
 * ثلاثةُ مصادر لا غير، وكلٌّ بتاريخه كما يُعرَف:
 *
 *   ١. دفعةُ الشهر المنقضي (أوّل هذا الشهر) — ما لم يُحوَّل منها متأخّرٌ الآن.
 *   ٢. فواتيرُ هذا الشهر المفتوحة حتى اليوم — تُدفَع أوّل الشهر القادم،
 *      وتكبر كلّما وصلت فاتورة؛ فيُقال «حتى اليوم».
 *   ٣. المصروفاتُ المتكرّرة المسجّلة — في يومها إن عُرف، وإلّا في شهرها
 *      بلا يوم («يومٌ غير محدَّد») ولا يُخترَع لها يوم.
 *   ٤. الرواتبُ من المسيّر — ما بقي من الشهر الماضي متأخّر، وما بقي من الجاري
 *      يومَ ٢٥ (موعدُ الرواتب)، والشهرُ القادم كاملاً من الرواتب المكتوبة. كانت
 *      الصفحةُ تقول «الإيجار والرواتب لا يظهران» والمسيّرُ يعرف الباقي بالهللة.
 *
 * والوارد لا يُحسَب: المبيعاتُ غير موصولة، فالإسقاطُ حدٌّ أدنى للنقد لا
 * توقّعٌ له — ويُقال ذلك. والرصيدُ الابتدائيّ آخرُ رصيدٍ ختاميٍّ معروف؛
 * فإن جُهل لم يُرسَم خطُّ الرصيد أصلاً.
 *
 * دالّةٌ خالصة — تأخذ وقائع وتُرجع دلاءً مرتّبة.
 */
import { formatDay, formatMonth, addDays, daysInMonth } from "./riyadh-time";
import { MAX_AMOUNT_MINOR, formatRiyalsDisplay } from "./money";
import { addMonths, monthsBetween } from "./filing";

export type Cadence = "MONTHLY" | "QUARTERLY" | "ANNUAL";

/** دورةُ المصروف من نصّ القاعدة — وما ليس ربعيّاً ولا سنويّاً شهريّ، كما يكتبه النموذج. */
export function asCadence(v: string): Cadence {
  return v === "QUARTERLY" || v === "ANNUAL" ? v : "MONTHLY";
}

export interface RecurringInput {
  id: string;
  label: string;
  amountMinor: number;
  cadence: Cadence;
  /** YYYY-MM-DD أو YYYY-MM أو فارغ. */
  startsOn: string | null;
  endsOn: string | null;
}

export interface SupplierDue {
  supplierId: string;
  supplierName: string;
  amountMinor: number;
}

export interface OutlookInput {
  /** اليوم بتوقيت الرياض — YYYY-MM-DD. */
  today: string;
  /** الشهر المنقضي — دفعتُه أوّل هذا الشهر. */
  runMonth: string;
  /** ما بقي من دفعة الشهر المنقضي جاهزاً للتحويل. */
  overdueRun: SupplierDue[];
  /** محجوزٌ من تلك الدفعة — لا يُحوَّل حتى تصل الفاتورة الصحيحة. */
  heldMinor: number;
  /** فواتيرُ هذا الشهر المفتوحة حتى اليوم. */
  nextRun: SupplierDue[];
  recurring: RecurringInput[];
  /**
   * متكرّرٌ قُيِّد له مصروفٌ هذا الشهر (مربوطٌ بـ`recurring_expense_id`) — دُفع،
   * فلا يُطرَح من الرصيد ثانيةً في «بقيّة الشهر». وغيابُه «لا يُعرف»: يُعرض الكلّ.
   */
  paidThisMonth?: ReadonlySet<string>;
  /** آخرُ رصيدٍ معروف — `null` مجهول. */
  balanceMinor: number | null;
  balanceAsOf: string | null;
  /** الرواتبُ الباقية من المسيّر — غيابُها: لا يُسقَط شيء. */
  payroll?: readonly PayrollDue[];
  /**
   * ضريبةُ القيمة المضافة المستحقّة للهيئة — إقرارٌ انقضت فترتُه ولم يُقدَّم، والفترةُ
   * الجارية «حتى اليوم». غيابُها: لا يُسقَط شيء (كما كان). انظر `VatDue`.
   */
  vat?: readonly VatDue[];
}

/**
 * مستحقُّ الضريبة لفترة — أكبرُ خروجٍ منفردٍ في السنة، وكان الإسقاطُ لا يعرفه.
 *
 * `amountMinor` من حساب الإقرار نفسه (`computeVatReturn`): موجبٌ يُسدَّد، وصفرٌ أو
 * سالبٌ لا خروجَ فيه، و`null` **لا يُعرف** — شهرٌ من الفترة بلا كشف بنك، فالرقمُ
 * الناقص لا يُكتب رقماً. و`accruing` الفترةُ لم تنتهِ: المبلغُ «حتى اليوم» ويكبر.
 */
export interface VatDue {
  periodKey: string;
  label: string;
  /** آخرُ يومٍ للتقديم والسداد — YYYY-MM-DD. */
  deadline: string;
  amountMinor: number | null;
  accruing: boolean;
}

/** ما بقي من رواتب شهرٍ في المسيّر — يُجمَع سطراً واحداً (الرواتبُ فرادى للمالك وحده). */
export interface PayrollDue {
  month: string;
  amountMinor: number;
  /** من بقي له شيء */
  people: number;
  /** موظّفون بلا راتبٍ مكتوب — مجموعُهم غير معروف فلا يُحسب، ويُقال */
  unknownPeople: number;
  /** حوالاتُ رواتب في الكشف لم توزَّع بعد خُصمت من الباقي — خرجت من الرصيد فعلاً */
  undistributedMinor?: number;
}

/** يومُ الرواتب في المقهى (`docs/decisions/payroll.md`) */
export const PAYDAY = 25;

export interface OutflowLine {
  id: string;
  label: string;
  sub?: string;
  amountMinor: number;
  kind: "SUPPLIER" | "RECURRING" | "VAT" | "PAYROLL";
  /** وجهةُ السطر — وغيابُها: لا صفحةَ يفتحها هذا الدور (الرواتب للمالك وحده) */
  href?: string;
}

export interface OutlookBucket {
  id: string;
  title: string;
  /** سطرٌ يقول متى ولماذا هنا. */
  when: string;
  tone: "danger" | "warn" | "neutral";
  lines: OutflowLine[];
  totalMinor: number;
  /** الرصيدُ بعد هذا الدلو إن عُرف الرصيد — حدٌّ أدنى لأنّ الوارد لا يُحسَب. */
  afterMinor: number | null;
}

export interface CashOutlook {
  buckets: OutlookBucket[];
  totalMinor: number;
  heldMinor: number;
  balanceMinor: number | null;
  balanceAsOf: string | null;
  /** أوّلُ دلوٍ يقصر عنه الرصيد — `null` إن لم يقصر أو جُهل. */
  shortfallAt: string | null;
  recurringCount: number;
  /** ما دخل الجدولَ من الضريبة بمبلغه — يُسمّى كي لا يتغيّر رقمٌ بلا سبب. */
  vatIncluded: VatDue[];
  /** موعدُه بعد أفق الجدول (آخر الشهر القادم) — «جنِّب له»، ولا يُطرح من الرصيد هنا. */
  vatAhead: VatDue[];
  /** فترةٌ لا يُعرف مستحقُّها — يُقال ولا يُسقَط صفراً. */
  vatUnknown: VatDue[];
}

/**
 * أيقع المصروفُ المتكرّر في هذا الشهر؟ ويومُه إن عُرف.
 * الشهريّ كلَّ شهر، والربعيّ كلَّ ثلاثة من شهر بدئه، والسنويّ في شهر بدئه.
 * وبلا تاريخ بدءٍ لا يُعرف شهرُ الربعيّ والسنويّ — فلا يُوضَع في شهرٍ مخترَع.
 */
export function occursIn(r: RecurringInput, month: string): { occurs: boolean; day: number | null } {
  const start = r.startsOn?.slice(0, 7) ?? null;
  const end = r.endsOn?.slice(0, 7) ?? null;
  if (start && month < start) return { occurs: false, day: null };
  if (end && month > end) return { occurs: false, day: null };
  const day = r.startsOn && /^\d{4}-\d{2}-\d{2}$/.test(r.startsOn) ? Number(r.startsOn.slice(8, 10)) : null;
  if (r.cadence === "MONTHLY") return { occurs: true, day };
  if (!start) return { occurs: false, day: null };
  const gap = monthsBetween(start, month);
  const period = r.cadence === "QUARTERLY" ? 3 : 12;
  return { occurs: gap >= 0 && gap % period === 0, day };
}

export function buildCashOutlook(input: OutlookInput): CashOutlook {
  const thisMonth = input.today.slice(0, 7);
  const nextMonth = addMonths(thisMonth, 1);
  const todayDay = Number(input.today.slice(8, 10));

  const supplierLines = (list: SupplierDue[], prefix: string): OutflowLine[] =>
    list
      .filter((s) => s.amountMinor > 0)
      .sort((a, b) => b.amountMinor - a.amountMinor)
      .map((s) => ({
        id: `${prefix}:${s.supplierId}`,
        label: s.supplierName,
        amountMinor: s.amountMinor,
        kind: "SUPPLIER" as const,
        href: "/payments",
      }));

  const recurringLines = (month: string, filter: (day: number | null) => boolean): OutflowLine[] =>
    input.recurring
      /* ما دُفع هذا الشهر خرج من الرصيد فعلاً — إسقاطُه ثانيةً يُنقص النقدَ مرّتين */
      .filter((r) => !(month === thisMonth && input.paidThisMonth?.has(r.id)))
      .map((r) => ({ r, o: occursIn(r, month) }))
      .filter(({ o }) => o.occurs && filter(o.day))
      .map(({ r, o }) => ({
        id: `rec:${r.id}:${month}`,
        label: r.label,
        sub: o.day ? `يوم ${o.day}` : "اليوم غير محدّد",
        amountMinor: r.amountMinor,
        kind: "RECURRING" as const,
        href: "/settings#recurring",
      }));

  /* ما أُسقط من «بقيّة الشهر» لأنّه دُفع — يُسمّى بمبلغه، فلا يرتفع «يبقى بعدها» بلا تفسير */
  const settled = input.recurring
    .filter((r) => input.paidThisMonth?.has(r.id) && occursIn(r, thisMonth).occurs)
    .map((r) => `${r.label} ${formatRiyalsDisplay(r.amountMinor)}`);
  const settledNote = settled.length > 0 ? ` · وقد خرج منها ما سُجّل دفعه: ${settled.join("، ")}` : "";

  /*
    الضريبة: كلُّ مستحقٍّ معلومٍ موجب يقع في مرحلة موعده. ما فات موعدُه متأخّرٌ الآن،
    وما موعدُه بعد الشهر القادم خارج الأفق فيُعلَن «جنِّب له». والمجهولُ لا يدخل رقماً.
  */
  const vat = input.vat ?? [];
  const vatKnown = vat.filter((v) => v.amountMinor !== null && v.amountMinor > 0);
  const vatLine = (v: VatDue): OutflowLine => ({
    id: `vat:${v.periodKey}`,
    label: `ضريبة القيمة المضافة: ${v.label}`,
    sub: `${v.accruing ? "المبلغ حتى اليوم وسيزيد · " : ""}آخر موعد لسدادها ${formatDay(v.deadline)}`,
    amountMinor: v.amountMinor ?? 0,
    kind: "VAT" as const,
    href: `/close/vat?period=${v.periodKey}`,
  });
  const vatIn = (pick: (deadlineMonth: string) => boolean) =>
    vatKnown.filter((v) => pick(v.deadline.slice(0, 7))).map(vatLine);
  const payrollLine = (p: PayrollDue): OutflowLine => ({
    id: `pay:${p.month}`,
    label: `رواتب ${formatMonth(p.month)}`,
    sub: [
      p.month < thisMonth ? "لم تُحوَّل كاملة" : `يوم ${PAYDAY}`,
      `${p.people === 1 ? "موظف واحد" : p.people === 2 ? "موظفان" : `${p.people} موظفين`}`,
      p.unknownPeople > 0 ? `ومعهم ${p.unknownPeople === 1 ? "موظف" : `${p.unknownPeople} موظفين`} بلا راتب مكتوب لم يُحسب` : null,
      (p.undistributedMinor ?? 0) > 0 ? `بعد خصم ${formatRiyalsDisplay(p.undistributedMinor ?? 0)} حُوّلت ولم توزَّع` : null,
    ].filter(Boolean).join(" · "),
    amountMinor: p.amountMinor,
    kind: "PAYROLL" as const,
    href: `/payroll?month=${p.month}`,
  });
  const payrollIn = (pick: (month: string) => boolean) =>
    (input.payroll ?? []).filter((p) => p.amountMinor > 0 && pick(p.month)).map(payrollLine);

  const vatIncluded = vatKnown.filter((v) => v.deadline.slice(0, 7) <= nextMonth);
  const vatAhead = vatKnown.filter((v) => v.deadline.slice(0, 7) > nextMonth);
  const vatUnknown = vat.filter((v) => v.amountMinor === null);

  const raw: Omit<OutlookBucket, "totalMinor" | "afterMinor">[] = [
    {
      id: "overdue",
      title: "متأخر الآن",
      when: `دفعة ${formatMonth(input.runMonth)} التي كان موعدها أول ${formatMonth(thisMonth)}`,
      tone: "danger",
      lines: [...supplierLines(input.overdueRun, "run"), ...payrollIn((m) => m < thisMonth), ...vatIn((m) => m < thisMonth)],
    },
    {
      id: "rest",
      title: `باقي ${formatMonth(thisMonth)}`,
      when: `مصروفات متكررة لم يُسجَّل دفعها هذا الشهر، ولم يحن موعدها أو موعدها غير محدد${settledNote}`,
      tone: "warn",
      lines: [...recurringLines(thisMonth, (day) => day === null || day >= todayDay), ...payrollIn((m) => m === thisMonth), ...vatIn((m) => m === thisMonth)],
    },
    {
      id: "next-run",
      title: `أول ${formatMonth(nextMonth)}`,
      when: `دفعة ${formatMonth(thisMonth)} من الفواتير المسجّلة حتى اليوم، وتزيد كلما وصلت فاتورة جديدة`,
      tone: "neutral",
      lines: [...supplierLines(input.nextRun, "next"), ...recurringLines(nextMonth, (day) => day === 1)],
    },
    {
      id: "next-month",
      title: `خلال ${formatMonth(nextMonth)}`,
      when: "المصروفات المتكررة المسجّلة عندك",
      tone: "neutral",
      lines: [...recurringLines(nextMonth, (day) => day !== 1), ...payrollIn((m) => m === nextMonth), ...vatIn((m) => m === nextMonth)],
    },
  ];

  let running = input.balanceMinor;
  let shortfallAt: string | null = null;
  const buckets: OutlookBucket[] = raw
    .filter((b) => b.lines.length > 0)
    .map((b) => {
      const totalMinor = b.lines.reduce((s, l) => s + l.amountMinor, 0);
      if (running !== null) {
        running -= totalMinor;
        if (running < 0 && shortfallAt === null) shortfallAt = b.id;
      }
      /* عنوانُ المرحلة يصف الدفعةَ والمتكرّر — فإن دخلتها الضريبةُ قيل */
      const withPay = b.lines.some((l) => l.kind === "PAYROLL") ? `${b.when} · ورواتب الموظفين من المسيّر` : b.when;
      const when = b.lines.some((l) => l.kind === "VAT") ? `${withPay} · ومعها ضريبة القيمة المضافة عند موعد الإقرار` : withPay;
      return { ...b, when, totalMinor, afterMinor: running };
    });

  return {
    buckets,
    totalMinor: buckets.reduce((s, b) => s + b.totalMinor, 0),
    heldMinor: input.heldMinor,
    balanceMinor: input.balanceMinor,
    balanceAsOf: input.balanceAsOf,
    shortfallAt,
    recurringCount: input.recurring.length,
    vatIncluded,
    vatAhead,
    vatUnknown,
  };
}

/* ─────────────────────────── ماذا لو أجّلتُ هذا؟ ─────────────────────────── */

export interface WhatIf {
  buckets: OutlookBucket[];
  shortfallAt: string | null;
  /** ما أُجِّل — بالهللات. */
  deferredMinor: number;
  /** أدنى ما يبلغه الرصيدُ في الإسقاط — `null` إن جُهل الرصيد. */
  lowestMinor: number | null;
}

/** معرّفُ الدلو الذي يستقبل ما أُجِّل من آخر مرحلة. */
export const LATER_BUCKET = "later";

/**
 * «ماذا لو أجّلتُ هذا؟» — ينقل كلَّ سطرٍ مؤجَّل إلى المرحلة التالية ويعيد حساب
 * «يبقى بعدها» لكلّ مرحلة. **تجربةٌ في المتصفّح لا قيد**: جمعٌ وطرحُ أعدادٍ صحيحة
 * من أرقام الخادم نفسها، والمجموعُ الكلّيّ لا يتغيّر — التأجيلُ ينقل الخروجَ ولا
 * يُسقطه. وما أُجِّل من آخر مرحلة يذهب إلى «بعد ذلك» ولا يختفي. والرصيدُ المجهول
 * يبقى مجهولاً: لا يُرسَم خطٌّ من صفرٍ مخترَع.
 */
export function whatIfDefer(
  buckets: readonly OutlookBucket[],
  balanceMinor: number | null,
  deferred: ReadonlySet<string>,
): WhatIf {
  const staged: { bucket: OutlookBucket; lines: OutflowLine[] }[] = buckets.map((b) => ({ bucket: b, lines: [] }));
  const later: OutflowLine[] = [];
  let deferredMinor = 0;
  buckets.forEach((b, i) => {
    for (const line of b.lines) {
      if (!deferred.has(line.id)) {
        staged[i].lines.push(line);
        continue;
      }
      deferredMinor += line.amountMinor;
      if (i + 1 < staged.length) staged[i + 1].lines.push(line);
      else later.push(line);
    }
  });
  const all = later.length > 0
    ? [...staged, {
        bucket: { id: LATER_BUCKET, title: "بعد ذلك", when: "ما أجّلته من آخر مرحلة، وما زال مستحقاً", tone: "neutral" as const, lines: [], totalMinor: 0, afterMinor: null },
        lines: later,
      }]
    : staged;

  let running = balanceMinor;
  let lowest = balanceMinor;
  let shortfallAt: string | null = null;
  const out = all.map(({ bucket, lines }) => {
    const totalMinor = lines.reduce((s, l) => s + l.amountMinor, 0);
    if (running !== null) {
      running -= totalMinor;
      if (lowest === null || running < lowest) lowest = running;
      if (running < 0 && shortfallAt === null && totalMinor > 0) shortfallAt = bucket.id;
    }
    return { ...bucket, lines, totalMinor, afterMinor: running };
  });
  return { buckets: out, shortfallAt, deferredMinor, lowestMinor: lowest };
}

/* ─────────────────────────── هذا الأسبوع ─────────────────────────── */

export interface WeekLine extends OutflowLine {
  /** YYYY-MM-DD — و`null` للمتأخّر: موعدُه مضى فهو مستحقٌّ الآن. */
  date: string | null;
}

export interface WeekDue {
  /** أوّلُ الأيّام السبعة وآخرُها — اليومُ والستّةُ بعده. */
  from: string;
  to: string;
  lines: WeekLine[];
  totalMinor: number;
  /** متكرّرٌ يقع هذا الشهر بلا يومٍ محدَّد — لا يُحسب في الأسبوع ولا يُنسى. */
  undated: number;
}

/**
 * ما يخرج في الأيّام السبعة القادمة — جوابُ «ماذا أدفع هذا الأسبوع؟» في
 * إحاطة الصباح. من المصادر نفسها التي يبني منها `buildCashOutlook`:
 * المتأخّرُ من دفعة الشهر المنقضي (مستحقٌّ الآن)، والمتكرّرُ الذي يقع يومُه
 * في النافذة. واليومُ الذي يتجاوز طولَ الشهر (٣١ في شهرٍ من ثلاثين) يقع
 * في آخره. وما لا يومَ له يُعَدّ ولا يُوضَع في يومٍ مخترَع.
 */
export function dueThisWeek(
  input: Pick<OutlookInput, "today" | "overdueRun" | "recurring" | "payroll">,
  days = 7,
): WeekDue {
  const to = addDays(input.today, days - 1);
  const months = [...new Set([input.today.slice(0, 7), to.slice(0, 7)])];

  const lines: WeekLine[] = input.overdueRun
    .filter((s) => s.amountMinor > 0)
    .sort((a, b) => b.amountMinor - a.amountMinor)
    .map((s) => ({
      id: `run:${s.supplierId}`,
      label: s.supplierName,
      amountMinor: s.amountMinor,
      kind: "SUPPLIER" as const,
      href: "/payments",
      date: null,
    }));

  let undated = 0;
  for (const r of input.recurring) {
    for (const month of months) {
      const o = occursIn(r, month);
      if (!o.occurs) continue;
      if (o.day === null) {
        if (month === input.today.slice(0, 7)) undated++;
        continue;
      }
      const date = `${month}-${String(Math.min(o.day, daysInMonth(month))).padStart(2, "0")}`;
      if (date < input.today || date > to) continue;
      lines.push({
        id: `rec:${r.id}:${date}`,
        label: r.label,
        amountMinor: r.amountMinor,
        kind: "RECURRING",
        href: "/settings#recurring",
        date,
      });
    }
  }

  /* الرواتب: الباقي من شهرٍ مضى مستحقٌّ الآن، والجاري يومَ ٢٥ إن وقع في الأيّام السبعة */
  for (const p of input.payroll ?? []) {
    if (p.amountMinor <= 0) continue;
    const date = p.month < input.today.slice(0, 7) ? null : `${p.month}-${String(PAYDAY).padStart(2, "0")}`;
    if (date !== null && (date > to || (date < input.today && p.month !== input.today.slice(0, 7)))) continue;
    lines.push({
      id: `pay:${p.month}`,
      label: `رواتب ${formatMonth(p.month)}`,
      amountMinor: p.amountMinor,
      kind: "PAYROLL",
      href: `/payroll?month=${p.month}`,
      /* يومُ ٢٥ مضى والشهرُ لم ينتهِ: مستحقٌّ الآن */
      date: date !== null && date < input.today ? null : date,
    });
  }

  lines.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || b.amountMinor - a.amountMinor);
  return { from: input.today, to, lines, totalMinor: lines.reduce((s, l) => s + l.amountMinor, 0), undated };
}

/* ─────────────────────────── حدُّ الرصيد الأدنى ─────────────────────────── */

export interface FloorBreach {
  /** أوّلُ مرحلةٍ ينزل بعدها الرصيدُ تحت الحدّ. */
  bucketId: string;
  title: string;
  /** الرصيدُ بعدها — حدٌّ أدنى، لأنّ الوارد لا يُحسب. */
  afterMinor: number;
  /** كم ينقص عن الحدّ. */
  shortMinor: number;
  /** أكبرُ ما في تلك المرحلة — «ما يسبّبه». */
  causes: { label: string; amountMinor: number }[];
}

/**
 * متى ينزل الرصيدُ تحت الحدّ الذي كتبه صاحبُه؟ — أوّلُ مرحلةٍ في الإسقاط يصير
 * «يبقى بعدها» دونه، وأكبرُ ثلاثة أسطرٍ فيها.
 *
 * `null` في ثلاث: لم يُكتب حدّ، أو الرصيدُ مجهول (لا إنذارَ ولا «سليم» عن غير علم —
 * `afterMinor` فيها `null`)، أو لا مرحلةَ تكسره. والمتّصلُ يفرّق بينها بما يعرف.
 * والواردُ غير محسوب: فالإنذارُ «إن لم يدخل شيء»، ويُقال ذلك.
 */
export function floorBreach(buckets: readonly OutlookBucket[], floorMinor: number | null): FloorBreach | null {
  if (floorMinor === null) return null;
  for (const b of buckets) {
    if (b.afterMinor === null) return null;
    if (b.afterMinor < floorMinor) {
      return {
        bucketId: b.id,
        title: b.title,
        afterMinor: b.afterMinor,
        shortMinor: floorMinor - b.afterMinor,
        causes: [...b.lines].sort((x, y) => y.amountMinor - x.amountMinor).slice(0, 3).map((l) => ({ label: l.label, amountMinor: l.amountMinor })),
      };
    }
  }
  return null;
}

/** الحدُّ كما خُزّن نصّاً ← هللاتٌ صحيحة موجبة — وما لا يُفهم `null` «لم يُضبط» لا صفر. */
export function parseStoredMinor(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,10}$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 && n <= MAX_AMOUNT_MINOR ? n : null;
}
