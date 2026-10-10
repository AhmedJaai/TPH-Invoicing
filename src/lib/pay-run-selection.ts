/**
 * اختيارُ صاحب الدفعة — مَن يُدفَع له، وأيُّ فواتيره، وكم.
 *
 * دالّاتٌ خالصة تقرؤها الشاشةُ لتعرض أثرَ الاختيار فوراً: المجموعُ، وما يبقى،
 * ومتى يكون المبلغُ الجزئيّ أكبرَ ممّا يُحوَّل. **والعرضُ عونٌ لا حُكم**: الملفُّ
 * يُبنى في الخادم من المعرّفات، والمبلغُ الجزئيّ يُفحَص هناك على ما يُقرأ من
 * القاعدة — وهذه الدالّاتُ تستعمل قاعدةَ الخادم نفسَها (`transferAfterCredit`).
 *
 * والاختيارُ يُحفَظ في المتصفّح بالشهر: كان تحديثُ الصفحة يعيد «الكلّ» فيُنزَّل
 * ملفٌّ بغير ما قُصد. وما حُفظ يُقرأ بفحصٍ لا بتحويل نوع.
 */
import { parseRiyals } from "./money";
import { transferAfterCredit } from "./payment-run";

export interface PayRunSelection {
  /** مورّدون أُخرجوا من هذه الدفعة. */
  skipSuppliers: string[];
  /** فواتيرُ أُخرجت وحدها. */
  skipInvoices: string[];
  /** «ادفع كذا فقط» — بالريال نصّاً كما كُتب، بمعرّف المورّد. */
  partial: Record<string, string>;
}

export const EMPTY_SELECTION: PayRunSelection = { skipSuppliers: [], skipInvoices: [], partial: {} };

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64).slice(0, 1000) : [];

/** ما حُفظ في المتصفّح — وما لا يُفهَم «لا اختيار»، لا خطأ. */
export function readSelection(raw: unknown): PayRunSelection {
  if (typeof raw !== "object" || raw === null) return EMPTY_SELECTION;
  const partial: Record<string, string> = {};
  if ("partial" in raw && typeof raw.partial === "object" && raw.partial !== null) {
    for (const [id, amount] of Object.entries(raw.partial)) {
      if (typeof amount === "string" && amount.trim() !== "" && amount.length <= 20 && id.length <= 64) partial[id] = amount;
    }
  }
  return {
    skipSuppliers: strings("skipSuppliers" in raw ? raw.skipSuppliers : []),
    skipInvoices: strings("skipInvoices" in raw ? raw.skipInvoices : []),
    partial,
  };
}

export function isEmptySelection(s: PayRunSelection): boolean {
  return s.skipSuppliers.length === 0 && s.skipInvoices.length === 0 && Object.keys(s.partial).length === 0;
}

export interface SelectableSupplier {
  supplierId: string;
  /** رصيدٌ لنا عنده كلُّه — يُخصم ممّا اختير من فواتيره. */
  creditMinor: number;
  invoices: readonly { id: string; openMinor: number }[];
}

export interface SupplierPlan {
  /** أفي الدفعة هو؟ — لم يُخرَج، وبقيت له فاتورةٌ مختارة. */
  on: boolean;
  invoiceIds: string[];
  skippedInvoices: number;
  /** المفتوحُ على ما اختير من فواتيره. */
  openMinor: number;
  creditAppliedMinor: number;
  /** ما يُحوَّل لو دُفع المختارُ كلُّه. */
  fullMinor: number;
  /** ما كُتب جزئيّاً وصحّ — وإلّا `null`. */
  partialMinor: number | null;
  /** لِمَ لا يصحّ المبلغُ الجزئيّ المكتوب — يُعرَض تحته ولا يُرسَل. */
  partialError: string | null;
  /** ما سيخرج فعلاً بهذا الاختيار. */
  payingMinor: number;
}

export function planSupplier(s: SelectableSupplier, selection: PayRunSelection): SupplierPlan {
  const skipped = new Set(selection.skipInvoices);
  const chosen = s.invoices.filter((i) => !skipped.has(i.id));
  const openMinor = chosen.reduce((sum, i) => sum + i.openMinor, 0);
  const { transferMinor, creditAppliedMinor } = transferAfterCredit(openMinor, s.creditMinor);
  const on = !selection.skipSuppliers.includes(s.supplierId) && chosen.length > 0;

  let partialMinor: number | null = null;
  let partialError: string | null = null;
  const written = selection.partial[s.supplierId];
  if (on && written !== undefined) {
    const minor = parseRiyals(written);
    if (minor === null || minor <= 0) partialError = "ليس مبلغاً — اكتبه بالريال مثل 1500.00";
    else if (minor > transferMinor) partialError = "أكبر ممّا يُحوَّل له";
    /* مبلغٌ يساوي الكلّ ليس جزئيّاً */
    else if (minor < transferMinor) partialMinor = minor;
  }

  return {
    on,
    invoiceIds: chosen.map((i) => i.id),
    skippedInvoices: s.invoices.length - chosen.length,
    openMinor,
    creditAppliedMinor,
    fullMinor: transferMinor,
    partialMinor,
    partialError,
    payingMinor: on ? partialMinor ?? transferMinor : 0,
  };
}

/* ─────────────────────────── الحفظُ في المتصفّح ─────────────────────────── */

/*
  الاختيارُ مخزنٌ خارجيّ يُقرأ بـ`useSyncExternalStore`: الخادمُ يرسم «الكلّ»، والمتصفّحُ
  يقرأ ما حُفظ بعد الترطيب بلا حالةٍ تُكتب في مؤثِّر. والتخزينُ قد يُمنَع (تصفّحٌ خاصّ)
  — فالذاكرةُ تحمله ما دامت الصفحة، والحفظُ تحسينٌ لا شرط. و«النقد القادم» يكتب فيه
  حين يُعتمَد ترتيبُ تجربةٍ فيها تأجيلُ مورّد.
*/
const SELECTION_EVENT = "tph:payrun";
const memory = new Map<string, string>();
const storageKey = (month: string) => `tph:payrun:${month}`;

export function rawSelection(month: string): string {
  const key = storageKey(month);
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? "";
  } catch {
    return memory.get(key) ?? "";
  }
}

export function parseSelection(raw: string): PayRunSelection {
  if (raw === "") return EMPTY_SELECTION;
  try {
    const parsed: unknown = JSON.parse(raw);
    return readSelection(parsed);
  } catch {
    return EMPTY_SELECTION;
  }
}

export function saveSelection(month: string, selection: PayRunSelection): void {
  const key = storageKey(month);
  const raw = isEmptySelection(selection) ? "" : JSON.stringify(selection);
  memory.set(key, raw);
  try {
    if (raw === "") window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, raw);
  } catch { /* بلا حفظ — يبقى في الذاكرة */ }
  window.dispatchEvent(new Event(SELECTION_EVENT));
}

export function subscribeSelection(onChange: () => void): () => void {
  window.addEventListener(SELECTION_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SELECTION_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
