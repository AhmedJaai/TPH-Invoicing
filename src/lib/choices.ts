/**
 * دفترُ اختياراتك — كلُّ ما قرّرتَه بيدك في موضعٍ واحد، بحاله اليوم.
 *
 * قاعدةُ ٧ أكتوبر: ما اختاره صاحبُ المقهى لا يُمنع ولا يُبطَل بصمت. والوعدُ الذي لا
 * يُرى لا يُتحقَّق منه — في ذلك اليوم سقطت سبعَ عشرةَ حوالةً اختارها من خصم الضريبة
 * ولم يُعرف إلّا من ارتفاع رقم. فهنا يُقرأ كلُّ اختيارٍ بحاله: **يعمل** · **لا يُطبَّق
 * الآن** بسببه · **مقفل** بإقرارٍ قُدِّم. ولكلٍّ أثرُه بالريال حيث يُحسب (و`null` حيث لا
 * يُحسب — لا صفر) وزرُّ سحبه أو موضعُ تغييره.
 *
 * هذا الملفّ نقيّ: يحوّل ما تعرضه شاشاتُ القرار نفسُها إلى صفوف الدفتر، بلا قاعدةٍ
 * ماليّة جديدة — الحكمُ «أتُحسب؟» يأتي محسوباً من `vat-return.ts`.
 */
import { formatRiyalsDisplay } from "./money";
import type { Capability } from "./permissions";

export type ChoiceGroupId =
  | "vat-tx" | "vat-invoice" | "vat-cash" | "hold" | "alert" | "supplier" | "rule" | "waiver";

export const CHOICE_GROUP_LABEL: Record<ChoiceGroupId, string> = {
  "vat-tx": "حركات بنك اخترتها للإقرار",
  "vat-invoice": "فواتير أكّدت ضريبتها أو استبعدتها",
  "vat-cash": "مبيعات نقد كتبتها",
  hold: "فواتير موقوفة أدخلتها في الدفعة",
  alert: "تنبيهات أغلقتها",
  supplier: "ما سجّلته عن مورّديك",
  rule: "قواعد تصنيف كتبتها",
  waiver: "ملاحظات تجاوزتها",
};

export const CHOICE_GROUP_HINT: Record<ChoiceGroupId, string> = {
  "vat-tx": "حركات خارجة أضفتها إلى خصم الضريبة، وحركات داخلة عددتها مبيعات أو استبعدتها. يظهر أثرها في الإقرار الضريبي.",
  "vat-invoice": "فواتير أكّدت أنها ضريبية فتُخصم ضريبتها، أو استبعدتها من الخصم.",
  "vat-cash": "مبيعات نقدية لم تُودع في البنك سجّلتها لكل شهر، وتدخل في ضريبة المبيعات كما سجّلتها.",
  hold: "أوقفها النظام لسبب يظهر معها، وقرّرت أنت دفعها. إلغاء قرارك يعيدها إلى الإيقاف.",
  alert: "تنبيهات اخترت فيها «ليس ازدواجاً» أو «أعرفه» أو «استُرد». لن تظهر من جديد إلا إن أعدت فتحها.",
  supplier: "سياسة المستندات، ومهلة السداد والحد الأعلى، والآيبان المكتوب يدوياً. وكلها تؤثر في التنبيهات وفي ملف التحويلات.",
  rule: "نص في وصف الحركة تُصنَّف به كل الحركات المشابهة.",
  waiver: "ملاحظة مانعة قرّرت تجاوزها وكتبت السبب.",
};

export type ChoiceState =
  /** يعمل الآن كما اخترت. */
  | "APPLIED"
  /** اخترتَه ولا يُطبَّق الآن — والسببُ معه. */
  | "NOT_APPLIED"
  /** داخل إقرارٍ قُدِّم — يُقرأ ولا يُسحَب حتى يُتراجَع عن التقديم. */
  | "LOCKED";

export const CHOICE_STATE_LABEL: Record<ChoiceState, string> = {
  APPLIED: "يعمل",
  NOT_APPLIED: "لا يعمل الآن",
  LOCKED: "مقفل لأن الإقرار قُدِّم",
};

export interface ChoiceRevoke {
  url: string;
  body: unknown;
  /** الصلاحيّةُ التي يحرس بها المسارُ نفسُه — الزرُّ لا يُعرض لمن لا يملكها. */
  needs: Capability;
  /** نصُّ الزرّ — يسمّي ما يقع: «أعِدها إلى الأصل» لا «تراجع». */
  label: string;
}

export interface ChoiceRow {
  /** فريدٌ في الدفتر كلِّه. */
  id: string;
  group: ChoiceGroupId;
  /** على ماذا وقع الاختيار. */
  subject: string;
  /** ما الذي اختير. */
  choice: string;
  /** `YYYY-MM-DD` بتوقيت الرياض — `null` لم يُحفَظ تاريخُه. */
  decidedOn: string | null;
  /** أثرُه الحاليّ بالهللات — `null` لا يُحسب له أثرٌ بالريال (لا صفر). */
  effectMinor: number | null;
  /** ما معنى الأثر: «ضريبةٌ تُخصم» · «تدخل الدفعة». */
  effectLabel: string | null;
  state: ChoiceState;
  /** لماذا لا يُطبَّق أو لماذا هو مقفل. */
  reason: string | null;
  /** موضعُ السجلّ أو موضعُ التغيير. */
  href: string | null;
  revoke: ChoiceRevoke | null;
}

/* ───────────────────── إقرارُ الضريبة ───────────────────── */

export interface VatTxChoiceInput {
  id: string;
  day: string;
  label: string;
  direction: "DEBIT" | "CREDIT";
  choice: boolean | null;
  /** أتُحسب الآن؟ — كما حكمت `isIncluded`. */
  included: boolean;
  /** ضريبتُها لو ضُمّت. */
  vatMinor: number;
  /** لماذا لا تُضمّ مهما اختير. */
  blocked: string | null;
  /** أكانت تُضمّ بلا اختيار؟ */
  includedByDefault: boolean;
  href: string;
}

/**
 * @param filedLabel اسمُ الإقرار المقدَّم الذي يقفل هذه الفترة — `null` لم يُقدَّم.
 */
export function vatTxChoiceRows(txs: readonly VatTxChoiceInput[], filedLabel: string | null): ChoiceRow[] {
  return txs.filter((t) => t.choice !== null).map((t): ChoiceRow => {
    const chosenIn = t.choice === true;
    const notApplied = chosenIn && !t.included;
    return {
      id: `vat-tx:${t.id}`,
      group: "vat-tx",
      subject: t.label,
      choice: chosenIn
        ? t.direction === "CREDIT" ? "عددتها بيعاً" : "أضفتها إلى خصم الضريبة"
        : t.direction === "CREDIT" ? "استبعدتها من المبيعات" : "استبعدتها من الخصم",
      decidedOn: t.day,
      /* المُخرَجةُ أثرُها ضريبةٌ لا تُحسب — وما لم يكن يُضمّ أصلاً فإخراجُه لا أثرَ له بالريال */
      effectMinor: notApplied ? 0 : chosenIn ? t.vatMinor : t.includedByDefault ? -t.vatMinor : null,
      effectLabel: t.direction === "CREDIT" ? "ضريبة مبيعات" : "ضريبة تُخصم",
      state: filedLabel ? "LOCKED" : notApplied ? "NOT_APPLIED" : "APPLIED",
      reason: filedLabel
        ? `${filedLabel} قُدّم${notApplied ? ` ولم تُحسب فيه: ${t.blocked ?? "تغيّرت حالتها"}` : ""}`
        : notApplied ? `${t.blocked ?? "تغيّرت حالتها"}. كان سيُخصم ${riyals(t.vatMinor)} ريال` : null,
      href: t.href,
      revoke: filedLabel ? null : {
        url: "/api/vat-choice",
        needs: "month:close",
        body: { kind: "tx", ids: [t.id], included: null },
        label: "أعدها إلى الأصل",
      },
    };
  });
}

export interface VatInvoiceChoiceInput {
  id: string;
  day: string;
  supplier: string;
  number: string;
  choice: boolean | null;
  included: boolean;
  /** ضريبتُها في الخصم إن حُسبت. */
  vatUsedMinor: number;
  /** الضريبةُ المقروءة — `null` لم تُقرأ. */
  vatMinor: number | null;
  /** أكانت الآلةُ تحسبها بلا إقرار؟ */
  machineEligible: boolean;
  href: string;
}

export function vatInvoiceChoiceRows(invoices: readonly VatInvoiceChoiceInput[], filedLabel: string | null): ChoiceRow[] {
  return invoices.filter((i) => i.choice !== null).map((i): ChoiceRow => {
    const chosenIn = i.choice === true;
    const notApplied = chosenIn && !i.included;
    return {
      id: `vat-invoice:${i.id}`,
      group: "vat-invoice",
      subject: `${i.supplier} — ${i.number || "بلا رقم"}`,
      choice: chosenIn ? "أكّدت أنها ضريبية فتُخصم" : "استبعدتها من الخصم",
      decidedOn: i.day,
      effectMinor: notApplied ? 0 : chosenIn ? i.vatUsedMinor : i.machineEligible ? -i.vatUsedMinor : null,
      effectLabel: "ضريبة تُخصم",
      state: filedLabel ? "LOCKED" : notApplied ? "NOT_APPLIED" : "APPLIED",
      reason: filedLabel
        ? `${filedLabel} قُدّم`
        : notApplied ? "قُرئت ضريبتها صفراً، فلا يُخصم منها شيء. صحّح الضريبة في الفاتورة إن كانت القراءة خاطئة" : null,
      href: i.href,
      revoke: filedLabel ? null : {
        url: "/api/vat-choice",
        needs: "month:close",
        body: { kind: "invoice", ids: [i.id], included: null },
        label: "أعدها إلى تقدير النظام",
      },
    };
  });
}

/* المبلغُ بلا إشارته — من منسِّق المال الواحد لا نسخةٍ منه */
function riyals(minor: number): string {
  return formatRiyalsDisplay(Math.abs(minor));
}

/* ───────────────────── الخلاصة ───────────────────── */

export interface ChoiceSummary {
  total: number;
  /** اختياراتٌ لا تُطبَّق الآن — أوّلُ ما يُقرأ في الصفحة. */
  notApplied: ChoiceRow[];
  byGroup: { group: ChoiceGroupId; rows: ChoiceRow[] }[];
}

const GROUP_ORDER: readonly ChoiceGroupId[] = ["vat-tx", "vat-invoice", "vat-cash", "hold", "alert", "supplier", "rule", "waiver"];

/** يرتّب الدفتر: ما لا يُطبَّق أوّلاً في كلّ باب، ثمّ الأحدث. والبابُ الفارغ لا يُعرض. */
export function summarizeChoices(rows: readonly ChoiceRow[]): ChoiceSummary {
  const rank: Record<ChoiceState, number> = { NOT_APPLIED: 0, APPLIED: 1, LOCKED: 2 };
  const sorted = [...rows].sort((a, b) =>
    rank[a.state] - rank[b.state]
    || (b.decidedOn ?? "").localeCompare(a.decidedOn ?? "")
    || a.id.localeCompare(b.id));
  return {
    total: rows.length,
    notApplied: sorted.filter((r) => r.state === "NOT_APPLIED"),
    byGroup: GROUP_ORDER
      .map((group) => ({ group, rows: sorted.filter((r) => r.group === group) }))
      .filter((g) => g.rows.length > 0),
  };
}
