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
 *
 * والوارد لا يُحسَب: المبيعاتُ غير موصولة، فالإسقاطُ حدٌّ أدنى للنقد لا
 * توقّعٌ له — ويُقال ذلك. والرصيدُ الابتدائيّ آخرُ رصيدٍ ختاميٍّ معروف؛
 * فإن جُهل لم يُرسَم خطُّ الرصيد أصلاً.
 *
 * دالّةٌ خالصة — تأخذ وقائع وتُرجع دلاءً مرتّبة.
 */
import { formatMonth } from "./riyadh-time";

export type Cadence = "MONTHLY" | "QUARTERLY" | "ANNUAL";

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
  /** آخرُ رصيدٍ معروف — `null` مجهول. */
  balanceMinor: number | null;
  balanceAsOf: string | null;
}

export interface OutflowLine {
  id: string;
  label: string;
  sub?: string;
  amountMinor: number;
  kind: "SUPPLIER" | "RECURRING";
  href: string;
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
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty * 12 + tm) - (fy * 12 + fm);
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
      .map((r) => ({ r, o: occursIn(r, month) }))
      .filter(({ o }) => o.occurs && filter(o.day))
      .map(({ r, o }) => ({
        id: `rec:${r.id}:${month}`,
        label: r.label,
        sub: o.day ? `يوم ${o.day}` : "يومٌ غير محدَّد",
        amountMinor: r.amountMinor,
        kind: "RECURRING" as const,
        href: "/settings#recurring",
      }));

  const raw: Omit<OutlookBucket, "totalMinor" | "afterMinor">[] = [
    {
      id: "overdue",
      title: "متأخّرٌ الآن",
      when: `دفعةُ ${formatMonth(input.runMonth)} — كان موعدُها أوّل ${formatMonth(thisMonth)}`,
      tone: "danger",
      lines: supplierLines(input.overdueRun, "run"),
    },
    {
      id: "rest",
      title: `بقيّة ${formatMonth(thisMonth)}`,
      when: "مصروفاتٌ متكرّرة لم يحن يومُها — أو يومُها غير محدَّد فتحقّق أدُفعت",
      tone: "warn",
      lines: recurringLines(thisMonth, (day) => day === null || day >= todayDay),
    },
    {
      id: "next-run",
      title: `أوّل ${formatMonth(nextMonth)}`,
      when: `دفعةُ ${formatMonth(thisMonth)} — من الفواتير المسجّلة حتى اليوم، وتكبر كلّما وصلت فاتورة`,
      tone: "neutral",
      lines: [...supplierLines(input.nextRun, "next"), ...recurringLines(nextMonth, (day) => day === 1)],
    },
    {
      id: "next-month",
      title: `خلال ${formatMonth(nextMonth)}`,
      when: "المصروفاتُ المتكرّرة المسجّلة",
      tone: "neutral",
      lines: recurringLines(nextMonth, (day) => day !== 1),
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
      return { ...b, totalMinor, afterMinor: running };
    });

  return {
    buckets,
    totalMinor: buckets.reduce((s, b) => s + b.totalMinor, 0),
    heldMinor: input.heldMinor,
    balanceMinor: input.balanceMinor,
    balanceAsOf: input.balanceAsOf,
    shortfallAt,
    recurringCount: input.recurring.length,
  };
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

function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function monthLength(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * ما يخرج في الأيّام السبعة القادمة — جوابُ «ماذا أدفع هذا الأسبوع؟» في
 * إحاطة الصباح. من المصادر نفسها التي يبني منها `buildCashOutlook`:
 * المتأخّرُ من دفعة الشهر المنقضي (مستحقٌّ الآن)، والمتكرّرُ الذي يقع يومُه
 * في النافذة. واليومُ الذي يتجاوز طولَ الشهر (٣١ في شهرٍ من ثلاثين) يقع
 * في آخره. وما لا يومَ له يُعَدّ ولا يُوضَع في يومٍ مخترَع.
 */
export function dueThisWeek(
  input: Pick<OutlookInput, "today" | "overdueRun" | "recurring">,
  days = 7,
): WeekDue {
  const to = shiftDay(input.today, days - 1);
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
      const date = `${month}-${String(Math.min(o.day, monthLength(month))).padStart(2, "0")}`;
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

  lines.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || b.amountMinor - a.amountMinor);
  return { from: input.today, to, lines, totalMinor: lines.reduce((s, l) => s + l.amountMinor, 0), undated };
}
