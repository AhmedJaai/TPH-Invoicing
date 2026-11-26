/**
 * الإشعار الدائن.
 *
 * فاتورةٌ بخمسة آلاف وإشعارٌ دائن بسبعمئة يعني أنّ المستحقّ **٤٬٣٠٠**
 * لا ٥٬٠٠٠. وكان الإشعار يُذكَر في كشف المورّد ولا يُغيّر شيئاً في
 * رصيده عندنا — فيُطالَب بمالٍ ليس عليه، ويبدو الفرق «اختلافاً».
 *
 * ويُفصَل الإشعارُ عن السداد: كلاهما دائن، لكنّ السداد مالٌ خرج
 * والإشعار تخفيضٌ لم يخرج له مال. وخلطهما يجعل التدفّق النقديّ يكذب.
 */
import { latinDigits } from "./digits";
import { addDays } from "./riyadh-time";

export type CreditKind = "CREDIT_NOTE" | "PAYMENT";

export interface CreditLine {
  id: string;
  date: Date;
  amountMinor: number;
  description: string | null;
  reference: string | null;
}

/**
 * ما يدلّ على أنّ الدائن إشعارٌ لا سداد.
 *
 * والدليل من نصّ المورّد نفسه — لا يُخمَّن من المبلغ ولا من التاريخ.
 */
const CREDIT_MARKERS = [
  /اشعار\s*دائن/i, /إشعار\s*دائن/i, /credit\s*note/i,
  /مرتجع/i, /مردود/i, /خصم/i, /تسويه/i, /تسوية/i, /\bCN[-\s]?\d/i,
];

/*
  ما يقول صراحةً إنّه مالٌ دُفع. «تسوية بحوالة» و«سداد بعد الخصم» سدادٌ لا
  إشعار: الكلمةُ الصريحة تسبق — وإلّا عُدّ مالٌ خرج تخفيضاً لم يخرج له مال.
*/
const PAYMENT_MARKERS = [
  /حوال[ةه]/i, /تحويل/i, /سداد/i, /دفع[ةه]/i, /\bpayment\b/i, /\btransfer\b/i, /\breceipt\b/i, /سند\s*قبض/i,
];

export function classifyCredit(line: CreditLine): CreditKind {
  const text = `${line.description ?? ""} ${line.reference ?? ""}`;
  /* «إشعار دائن» باسمه يسبق كلَّ شيء: المورّدُ سمّاه. و«Reversal of INV/…» عكسٌ لفاتورةٍ صراحةً (أفال: RINV/2026/00016) */
  if (/[اإ]شعار\s*دائن|credit\s*note|\bCN[-\s]?\d|reversal\s+of\b|\bRINV[\/\-\s]?\d/i.test(text)) return "CREDIT_NOTE";
  if (PAYMENT_MARKERS.some((m) => m.test(text))) return "PAYMENT";
  return CREDIT_MARKERS.some((m) => m.test(text)) ? "CREDIT_NOTE" : "PAYMENT";
}

export interface SupplierBalance {
  billedMinor: number;
  paidMinor: number;
  creditNoteMinor: number;
  /** ما عليك فعلاً: المفوتر ناقص المسدَّد ناقص الإشعارات. */
  outstandingMinor: number;
}

/**
 * يحسب رصيد المورّد بالإشعارات.
 *
 * والإشعار يُطرَح من المستحقّ كالسداد، لكنّه لا يُعدّ سداداً: من ينظر
 * إلى «كم دفعتُ له» يجب ألّا يجد فيه تخفيضاً لم يخرج له مال.
 */
export function balanceWithCredits(input: {
  billedMinor: number;
  paidMinor: number;
  credits: readonly CreditLine[];
}): SupplierBalance {
  const creditNoteMinor = input.credits
    .filter((c) => classifyCredit(c) === "CREDIT_NOTE")
    .reduce((s, c) => s + Math.abs(c.amountMinor), 0);

  return {
    billedMinor: input.billedMinor,
    paidMinor: input.paidMinor,
    creditNoteMinor,
    outstandingMinor: Math.max(0, input.billedMinor - input.paidMinor - creditNoteMinor),
  };
}

/**
 * يفسّر فرقاً في كشف المورّد بإشعارٍ دائن.
 *
 * فإن كان الفرق يساوي إشعاراً في الكشف نفسه، فهو ليس اختلافاً بل
 * تخفيضٌ لم يُقيَّد عندنا — وتسميته اختلافاً تُرسل صاحب العمل يبحث عن
 * خطأٍ ليس موجوداً.
 */
export function explainByCredit(
  differenceMinor: number,
  credits: readonly CreditLine[],
): CreditLine | null {
  if (differenceMinor === 0) return null;
  const target = Math.abs(differenceMinor);
  return (
    credits
      .filter((c) => classifyCredit(c) === "CREDIT_NOTE")
      .find((c) => Math.abs(Math.abs(c.amountMinor) - target) <= 1) ?? null
  );
}

/* ───────────── دائنُ الكشف مقابلَ الإشعارات المسجَّلة ───────────── */

/** البادئةُ التي يُحفظ بها الإشعارُ على دفعته (`creditNoteLabel` في `credit-note.service.ts`). */
export const CREDIT_NOTE_LABEL_PREFIX = "إشعار دائن";

/** مرجعُ الإشعار من الاسم المحفوظ على دفعته: «إشعار دائن CN-12» ← «CN-12»، وبلا مرجعٍ `null`. */
export function creditNoteReferenceOf(label: string | null | undefined): string | null {
  const text = (label ?? "").trim();
  if (!text.startsWith(CREDIT_NOTE_LABEL_PREFIX)) return null;
  const rest = text.slice(CREDIT_NOTE_LABEL_PREFIX.length).trim();
  return rest.length > 0 ? rest : null;
}

/** سطرٌ دائنٌ من كشف المورّد صنّفه `classifyCredit` إشعاراً. */
export interface StatementCreditNoteLine {
  /** معرّفُ سطر الكشف المحفوظ — وبلا معرّفٍ (فحصٌ لم يُحفظ) لا يُقيَّد منه شيء. */
  id?: string;
  day: string;
  ref: string | null;
  description: string | null;
  amountMinor: number;
}

/** إشعارٌ قيّدناه (دفعةٌ بطريقة `CREDIT_NOTE` لم تُردّ ولم تُلغَ). */
export interface RecordedCreditNote {
  paymentId: string;
  day: string;
  amountMinor: number;
  reference: string | null;
}

export interface CreditNotePair {
  line: StatementCreditNoteLine;
  note: RecordedCreditNote;
  /** بالرقم والمبلغ معاً، أو بالمبلغ بالهللة وحده لأنّ أحدهما بلا رقم. */
  by: "REF" | "AMOUNT";
}

export interface CreditNoteReconciliation {
  /** يقابل إشعاراً مسجَّلاً واحداً لا يتنازعه سطرٌ آخر — مطابَق. */
  matched: CreditNotePair[];
  /** له أكثرُ من مرشّح، أو رقمُه رقمُ إشعارنا والمبلغُ غيرُه — اقتراحٌ لا مطابقة، يحسمه إنسان. */
  suggested: { line: StatementCreditNoteLine; candidates: RecordedCreditNote[]; why: string }[];
  /** «دائنٌ في الكشف بلا إشعار مسجَّل» — ما عندنا له أكبر من الحقيقة. */
  unrecorded: StatementCreditNoteLine[];
  /** إشعارٌ قيّدناه في مدّة الكشف ولم يرد فيه — خصمنا ما لم يخصمه المورّد. */
  notInStatement: RecordedCreditNote[];
  /**
   * يعكس فاتورةً ليست في سجلاتنا (أفال: «RINV/2026/00016 (Reversal of: INV/2026/00080)» وفاتورتُه
   * لم تُقيَّد عندنا قطّ) — المورّدُ حمّل وألغى، فلا أثرَ له على ما ندين به. وتسجيلُه إشعاراً يُنقص
   * المستحقَّ بما لم يُحمَّل علينا. فليس «بلا إشعار مسجَّل»، ولا يُقيَّد.
   */
  reversesUnknown: { line: StatementCreditNoteLine; invoiceNumber: string }[];
}

/**
 * الإشعارُ يُكتب في كشف المورّد يومَ صدوره، ويُقيَّد عندنا بتاريخ ورقته — فالنافذةُ نافذةُ الفواتير
 * نفسُها (`STATEMENT_DATE_WINDOW_DAYS`): أسبوعٌ قبل مدّة الكشف وبعدها للمرشّحين، والمدّةُ وحدها للدعوى.
 */
export const CREDIT_NOTE_WINDOW_DAYS = 7;

/**
 * رقمُ الفاتورة التي يعكسها الإشعار، إن قاله نصُّه: «Reversal of: INV/2026/00080»، «عكس فاتورة 123».
 * وبلا ذلك `null` — الإشعارُ على فاتورةٍ لا تُسمّى لا يُخمَّن رقمُها.
 */
export function reversedInvoiceOf(line: Pick<StatementCreditNoteLine, "ref" | "description">): string | null {
  const text = latinDigits(`${line.ref ?? ""} ${line.description ?? ""}`);
  const m = /(?:reversal\s+of|عكس(?:\s+فاتورة)?)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9/_-]*\d[A-Za-z0-9/_-]*)/i.exec(text);
  return m ? m[1] : null;
}

/** توحيدُ الرقم للمقارنة: لاتينيّ، بلا رموزٍ ولا فراغ، بحروفٍ كبيرة — والاستعلامُ يوحّد بالقاعدة نفسها. */
export function normalizeCreditRef(value: string | null | undefined): string {
  return latinDigits(value ?? "").replace(/[^\p{L}\p{N}]+/gu, "").toUpperCase();
}

/** رقمٌ يصلح هويّةً: أربعُ خاناتٍ فأكثر وفيه رقم — «مرتجع» وحده ليس رقماً. */
function looksNumbered(norm: string): boolean {
  return norm.length >= 4 && /\d/.test(norm);
}

function refAgrees(line: StatementCreditNoteLine, noteRef: string): boolean {
  if (!looksNumbered(noteRef)) return false;
  const theirRef = normalizeCreditRef(line.ref);
  const theirText = normalizeCreditRef(`${line.ref ?? ""} ${line.description ?? ""}`);
  if (theirRef === noteRef || theirText.includes(noteRef)) return true;
  return looksNumbered(theirRef) && noteRef.includes(theirRef);
}

/**
 * يقابل إشعاراتِ كشف المورّد بالإشعارات التي قيّدناها — واحداً بواحد.
 *
 * ١ · **بالرقم** إن كان لإشعارنا رقم: يطابق إن ساواه المبلغُ بالهللة ولم يتنازعه سطرٌ آخر،
 *     وإلّا اقتراحٌ («الرقم نفسه والمبلغ غيره» قد يكون مرتجعاً جزئياً أو قراءةً خاطئة).
 * ٢ · **بالمبلغ بالهللة** في نافذة الكشف لما بقي: مرشّحٌ واحدٌ لا يتنازعه سطرٌ آخر يطابق، وأكثرُ
 *     من مرشّح اقتراح. ورقمان مختلفان لا يتطابقان لأنّ المبلغ واحد — ورقتان لا ورقة.
 *
 * لا تسامحَ بريال كما في السداد: الإشعارُ لا تقتطع منه رسومُ تحويل، فالفرقُ هللةً فرق.
 * والنتيجةُ لا تتغيّر بترتيب الصفوف. قراءةٌ وحدها: لا تكتب شيئاً، فالتراجعُ عنها ردُّ الإشعار.
 */
export function matchCreditNotes(
  lines: readonly StatementCreditNoteLine[],
  notes: readonly RecordedCreditNote[],
  period: { from: string; to: string },
  /**
   * أرقامُ فواتير المورّد عندنا (موحَّدةً بـ`normalizeCreditRef`) التي يعكسها إشعارٌ في الكشف — ليُعرف
   * أيُّ عكسٍ يلغي فاتورةً لم نقيّدها. وبلاها لا يُحكم بشيء: الغائبُ لا يُعدّ «ليست عندنا».
   */
  options: { knownInvoices?: ReadonlySet<string> } = {},
): CreditNoteReconciliation {
  const ls = [...lines]
    .filter((l) => l.amountMinor > 0)
    .sort((a, b) => a.day.localeCompare(b.day) || a.amountMinor - b.amountMinor
      || (a.ref ?? "").localeCompare(b.ref ?? "") || (a.description ?? "").localeCompare(b.description ?? "") || (a.id ?? "").localeCompare(b.id ?? ""));
  const from = addDays(period.from, -CREDIT_NOTE_WINDOW_DAYS);
  const to = addDays(period.to, CREDIT_NOTE_WINDOW_DAYS);
  const ns = [...notes]
    .filter((n) => n.amountMinor > 0 && n.day >= from && n.day <= to)
    .sort((a, b) => a.day.localeCompare(b.day) || a.paymentId.localeCompare(b.paymentId));
  const noteRef = ns.map((n) => normalizeCreditRef(n.reference));

  const lineTaken = new Set<number>();
  const noteTaken = new Set<number>();
  const matched: CreditNotePair[] = [];
  const suggested: CreditNoteReconciliation["suggested"] = [];

  /* ١ · بالرقم */
  const byRef = ls.map((l) => ns.flatMap((_, ni) => (refAgrees(l, noteRef[ni]) ? [ni] : [])));
  const refClaims = new Map<number, number>();
  byRef.forEach((c) => c.forEach((ni) => refClaims.set(ni, (refClaims.get(ni) ?? 0) + 1)));
  byRef.forEach((c, li) => {
    if (c.length === 0) return;
    lineTaken.add(li);
    c.forEach((ni) => noteTaken.add(ni));
    const only = c.length === 1 && refClaims.get(c[0]) === 1 ? c[0] : null;
    if (only !== null && ns[only].amountMinor === ls[li].amountMinor) {
      matched.push({ line: ls[li], note: ns[only], by: "REF" });
    } else {
      suggested.push({
        line: ls[li],
        candidates: c.map((ni) => ns[ni]),
        why: only !== null ? "الرقم نفسه والمبلغ مختلف" : "الرقم يطابق أكثر من إشعار أو سطر",
      });
    }
  });

  /* ٢ · بالمبلغ بالهللة — ورقمان مختلفان ورقتان */
  const conflict = (li: number, ni: number) => {
    const theirs = normalizeCreditRef(ls[li].ref);
    return looksNumbered(theirs) && looksNumbered(noteRef[ni]) && !refAgrees(ls[li], noteRef[ni]);
  };
  const byAmount = ls.map((l, li) => (lineTaken.has(li) ? [] : ns.flatMap((n, ni) => (
    !noteTaken.has(ni) && n.amountMinor === l.amountMinor && !conflict(li, ni) ? [ni] : []
  ))));
  const amountClaims = new Map<number, number>();
  byAmount.forEach((c) => c.forEach((ni) => amountClaims.set(ni, (amountClaims.get(ni) ?? 0) + 1)));
  const suggestedNotes = new Set<number>();
  byAmount.forEach((c, li) => {
    if (c.length === 0) return;
    lineTaken.add(li);
    if (c.length === 1 && amountClaims.get(c[0]) === 1) {
      noteTaken.add(c[0]);
      matched.push({ line: ls[li], note: ns[c[0]], by: "AMOUNT" });
    } else {
      c.forEach((ni) => suggestedNotes.add(ni));
      suggested.push({ line: ls[li], candidates: c.map((ni) => ns[ni]), why: "أكثر من إشعار أو سطر بالمبلغ نفسه" });
    }
  });
  suggestedNotes.forEach((ni) => noteTaken.add(ni));

  const left = ls.filter((_, li) => !lineTaken.has(li));
  const reversesUnknown: CreditNoteReconciliation["reversesUnknown"] = [];
  const unrecorded: StatementCreditNoteLine[] = [];
  for (const l of left) {
    const target = reversedInvoiceOf(l);
    if (target && options.knownInvoices && !options.knownInvoices.has(normalizeCreditRef(target))) reversesUnknown.push({ line: l, invoiceNumber: target });
    else unrecorded.push(l);
  }

  return {
    matched,
    suggested,
    unrecorded,
    reversesUnknown,
    notInStatement: ns.filter((n, ni) => !noteTaken.has(ni) && n.day >= period.from && n.day <= period.to),
  };
}
