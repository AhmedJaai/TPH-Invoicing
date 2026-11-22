/**
 * أسطرُ الدائن في كشف المورّد مقابلَ ما قيّدناه — سداداً بسداد، وإشعاراً بإشعار.
 *
 * ── لماذا ──
 *
 * كان الكشفُ يُقابَل بفواتيرنا سطراً سطراً، وأمّا دائنُه (ما يقول المورّدُ إنّه وصله منّا) فلا
 * يدخل إلّا رصيداً ختاميّاً واحداً. فحوالةٌ خرجت ولم يقيّدها المورّد تظهر «فرقاً» بلا تحديد،
 * ويُدفع الرصيدُ الذي يطالب به وفيه مالٌ وصله. وهذا هو المالُ الذي يُخسَر بصمت: لا يكشفه إلّا
 * سطرٌ بسطر.
 *
 * ── وما لا تفعله ──
 *
 * قراءةٌ: لا تُنشئ دفعةً ولا تمسّ تخصيصاً. وما لم يُقابَل «يُسأل عنه» لا «ضاع»: المورّدُ قد يجمع
 * حوالتين في سطر، أو يقيّد بعد تاريخ كشفه.
 */
import { classifyCredit } from "@/lib/credit-notes";
import { TOTAL_ROUNDING_TOLERANCE_MINOR } from "@/lib/money";
import { addDays, daysBetween } from "@/lib/riyadh-time";

/** المورّدُ يقيّد الحوالةَ يومَ وصولها — قبلها بيومين (تاريخُ القيمة) إلى أسبوعٍ بعدها. */
export const RECEIPT_BEFORE_DAYS = 2;
export const RECEIPT_AFTER_DAYS = 7;
/**
 * سدادُنا في آخر أيّامٍ من مدّة الكشف قد لا يكون وصله قبل أن يطبعه — لا يُسأل عنه.
 * هي نافذةُ الوصول نفسُها، فلا يُقال «لم يقيّدها» عن حوالةٍ قد تكون في الطريق.
 */
export const IN_TRANSIT_DAYS = RECEIPT_AFTER_DAYS;

/** طريقةُ دفعتنا كما تُقال بجانبها. */
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  BANK_TRANSFER: "حوالة بنكية",
  CASH: "نقداً",
  EMPLOYEE_ADVANCE: "عن طريق موظف",
  OWNER_ACCOUNT: "من حساب المالك",
  CREDIT_NOTE: "إشعار دائن قيّدناه",
};

export type CreditLineKind = "PAYMENT" | "CREDIT_NOTE";

export interface StatementCreditLine {
  day: string;
  ref: string | null;
  description: string | null;
  amountMinor: number;
}

export interface OurSettlement {
  paymentId: string;
  day: string;
  /** المبلغُ كما خرج، و`feeMinor` ما اقتطعه البنك — المورّدُ يقيّد ما وصله. */
  amountMinor: number;
  feeMinor: number;
  /** `CREDIT_NOTE` إشعارٌ قيّدناه — يقابله إشعارٌ في كشفه لا سداد. */
  isCreditNote: boolean;
  /** تُعرض بجانب الدفعة: حوالة · نقد · من حساب المالك. */
  method: string;
}

export interface SettlementPair {
  /** سطرٌ أو أكثر من كشفه — المورّدُ يقسم حوالتَنا على فواتيره سطراً لكلّ فاتورة (بيكوف ٩٠٠ = ١٥٠ + ٧٥٠). */
  lines: StatementCreditLine[];
  /** دفعةٌ أو أكثر من دفعاتنا — أو يجمع حوالتين في سطر. */
  ours: OurSettlement[];
  kind: CreditLineKind;
}

export interface SettlementComparison {
  matched: SettlementPair[];
  /** في كشفه سدادٌ أو إشعارٌ لا نعرفه — قيّده المورّد ولم نقيّده. */
  theirsOnly: { line: StatementCreditLine; kind: CreditLineKind }[];
  /**
   * قيّدناه في مدّة كشفه ولم يرد فيه — **سدادٌ لم يقيّده المورّد**: يطالبك بما وصله.
   * بعد أن يُستثنى ما قد يكون في الطريق (`IN_TRANSIT_DAYS`).
   */
  oursOnly: OurSettlement[];
  /** سدادُنا في آخر أيّام الكشف بلا سطر — قد يكون في الطريق، يُعدّ ولا يُسأل عنه. */
  inTransit: OurSettlement[];
  /**
   * أيذكر كشفُه السدادَ أصلاً؟ كشفٌ لا سطرَ سدادٍ فيه (فواتيرُ وحدها) لا يُسأل عن حوالاتنا —
   * غيابُها منه صفةُ الكشف لا خبرٌ عنها (لوريفا أكتوبر · أفال).
   */
  listsPayments: boolean;
  listsCreditNotes: boolean;
}

/** المبلغُ في كشفه يوافق دفعتنا: كما خرجت، أو ما وصله بعد رسوم التحويل. */
function agrees(theirsMinor: number, ours: OurSettlement): boolean {
  const near = (x: number) => Math.abs(theirsMinor - x) <= TOTAL_ROUNDING_TOLERANCE_MINOR;
  return near(ours.amountMinor) || (ours.feeMinor > 0 && near(ours.amountMinor - ours.feeMinor));
}

function withinReceipt(lineDay: string, oursDay: string): boolean {
  const off = daysBetween(oursDay, lineDay);
  return off >= -RECEIPT_BEFORE_DAYS && off <= RECEIPT_AFTER_DAYS;
}

/**
 * يقابل واحداً بواحد: الأقربُ يوماً ثمّ الأقربُ مبلغاً، والترتيبُ ثابت — فالنتيجةُ لا تتغيّر
 * بترتيب الصفوف. والسدادُ لا يقابل إشعاراً ولا العكس: الإشعارُ لم يخرج له مال.
 *
 * `period` مدّةُ الكشف: ما قيّدناه خارجها لا يُسأل عنه، وما قبلها بأسبوعٍ يدخل المرشّحين لأنّ
 * الحوالةَ قبل أوّل يومٍ قد يقيّدها المورّد في أوّله.
 */
export function compareSettlements(
  lines: readonly StatementCreditLine[],
  ours: readonly OurSettlement[],
  period: { from: string; to: string },
): SettlementComparison {
  const typed = [...lines]
    .filter((l) => l.amountMinor > 0)
    .map((line) => ({ line, kind: classifyCredit({ id: "", date: new Date(`${line.day}T00:00:00Z`), amountMinor: line.amountMinor, description: line.description, reference: line.ref }) as CreditLineKind }))
    .sort((a, b) => a.line.day.localeCompare(b.line.day) || a.line.amountMinor - b.line.amountMinor || (a.line.ref ?? "").localeCompare(b.line.ref ?? ""));
  const mine = [...ours].sort((a, b) => a.day.localeCompare(b.day) || a.paymentId.localeCompare(b.paymentId));
  const sameKind = (li: number, oi: number) => (typed[li].kind === "CREDIT_NOTE") === mine[oi].isCreditNote;

  const lineTaken = new Set<number>();
  const oursTaken = new Set<number>();
  const matched: SettlementPair[] = [];
  const take = (lis: number[], ois: number[]) => {
    lis.forEach((i) => lineTaken.add(i));
    ois.forEach((i) => oursTaken.add(i));
    matched.push({ lines: lis.map((i) => typed[i].line), ours: ois.map((i) => mine[i]), kind: typed[lis[0]].kind });
  };

  /* ١ · واحدٌ بواحد: الأقربُ يوماً ثمّ الأقربُ مبلغاً */
  const pairs: { li: number; oi: number; off: number; gap: number }[] = [];
  typed.forEach((t, li) => {
    mine.forEach((o, oi) => {
      if (!sameKind(li, oi) || !agrees(t.line.amountMinor, o) || !withinReceipt(t.line.day, o.day)) return;
      pairs.push({ li, oi, off: Math.abs(daysBetween(o.day, t.line.day)), gap: Math.abs(t.line.amountMinor - o.amountMinor) });
    });
  });
  pairs.sort((a, b) => a.off - b.off || a.gap - b.gap || a.li - b.li || a.oi - b.oi);
  for (const p of pairs) {
    if (lineTaken.has(p.li) || oursTaken.has(p.oi)) continue;
    take([p.li], [p.oi]);
  }

  /*
    ٢ · دفعةٌ واحدة بعدّة أسطر: المورّدُ يقسم الحوالةَ على فواتيره. ثمّ العكس: سطرٌ يجمع حوالتين.
    والمجموعةُ من الباقي وحده، في نافذة الوصول، وبالنوع نفسه — وأصغرُها أوّلاً.
  */
  mine.forEach((o, oi) => {
    if (oursTaken.has(oi)) return;
    const pool = typed.map((_, li) => li).filter((li) => !lineTaken.has(li) && sameKind(li, oi) && withinReceipt(typed[li].line.day, o.day));
    const group = findSubset(pool, (li) => typed[li].line.amountMinor, (sum) => agrees(sum, o));
    if (group) take(group, [oi]);
  });
  typed.forEach((t, li) => {
    if (lineTaken.has(li)) return;
    const pool = mine.map((_, oi) => oi).filter((oi) => !oursTaken.has(oi) && sameKind(li, oi) && withinReceipt(t.line.day, mine[oi].day));
    const group = findSubset(pool, (oi) => mine[oi].amountMinor, (sum) => Math.abs(sum - t.line.amountMinor) <= TOTAL_ROUNDING_TOLERANCE_MINOR);
    if (group) take([li], group);
  });

  const listsPayments = typed.some((t) => t.kind === "PAYMENT");
  const listsCreditNotes = typed.some((t) => t.kind === "CREDIT_NOTE");
  const asked = (o: OurSettlement) => (o.isCreditNote ? listsCreditNotes : listsPayments);
  const transitFrom = addDays(period.to, -IN_TRANSIT_DAYS + 1);
  const unmatchedOurs = mine.filter((o, i) => !oursTaken.has(i) && o.day >= period.from && o.day <= period.to && asked(o));
  return {
    matched,
    theirsOnly: typed.filter((_, i) => !lineTaken.has(i)),
    /* الإشعارُ قيّدناه من ورقته — لا يكون «في الطريق» */
    oursOnly: unmatchedOurs.filter((o) => o.isCreditNote || o.day < transitFrom),
    inTransit: unmatchedOurs.filter((o) => !o.isCreditNote && o.day >= transitFrom),
    listsPayments,
    listsCreditNotes,
  };
}

/** أقصى عددٍ في المجموعة، وأقصى مرشّحين يُبحث بينهم — البحثُ أُسّيّ فيُحدّ. */
const MAX_GROUP = 4;
const MAX_POOL = 14;

/**
 * أصغرُ مجموعةٍ (اثنان فأكثر) يوافق مجموعُها — وأوّلُها بالترتيب حين تتساوى، فالنتيجةُ ثابتة.
 * ولا تُقبل مجموعتان مختلفتان بالحجم نفسه: الالتباسُ يُترك للإنسان ولا يُحسم بالترتيب.
 */
function findSubset(pool: number[], amountOf: (i: number) => number, fits: (sum: number) => boolean): number[] | null {
  if (pool.length < 2 || pool.length > MAX_POOL) return null;
  for (let size = 2; size <= Math.min(MAX_GROUP, pool.length); size++) {
    const found: number[][] = [];
    const walk = (startAt: number, picked: number[], sum: number) => {
      if (found.length > 1) return;
      if (picked.length === size) {
        if (fits(sum)) found.push([...picked]);
        return;
      }
      for (let i = startAt; i < pool.length; i++) walk(i + 1, [...picked, pool[i]], sum + amountOf(pool[i]));
    };
    walk(0, [], 0);
    if (found.length === 1) return found[0];
    if (found.length > 1) return null;
  }
  return null;
}
