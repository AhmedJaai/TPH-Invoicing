/**
 * مشترياتُ فودكس أمام فواتيرنا — **شاهدان على واقعةٍ واحدة، ولا يغلب أحدُهما**.
 *
 * الفاتورةُ عندنا من مستندها في الدرايف؛ وحركةُ الشراء في فودكس يكتبها من استلم
 * البضاعة. فما اتّفقا عليه مؤكَّدٌ من جهتين، وما اختلفا فيه يُعرَض بطرفيه:
 *
 *   في فودكس ولا فاتورةَ عندنا   ← مستندٌ لم يصل الدرايف، أو أُدخل هناك خطأً
 *   عندنا وليست في فودكس         ← بضاعةٌ لم تُدخَل مخزونَه — فحسابُه للمخزون ناقص
 *   الاثنان والمبلغُ مختلف       ← أحدُهما قرأ خطأً، أو فاتورةٌ عُدّلت
 *
 * **ولا يُكتب من هنا شيء**: لا تُنشأ فاتورةٌ من حركة فودكس ولا يُصحَّح مبلغ. فودكس
 * يُخطئ في إدخاله كما نخطئ في قراءتنا، والحكمُ لصاحب المقهى أمام المستند.
 *
 * والمطابقةُ برقم الفاتورة أوّلاً (هو ما كتبه المورّد)، ثمّ بالمورّد والتاريخ
 * والمبلغ معاً. والاسمُ لا يُطابَق به: «مورد حبوب قهوة» عند فودكس خمسةُ مورّدين.
 */
import { TOTAL_ROUNDING_TOLERANCE_MINOR } from "@/lib/money";
import { daysBetween } from "@/lib/riyadh-time";

export interface PurchaseSide {
  id: string;
  /** `PUR-000183` */
  reference: string;
  businessDate: string;
  foodicsSupplierId: string | null;
  foodicsSupplierName: string | null;
  /** مورّدُنا الذي رُبط به مورّدُ فودكس بيد إنسان — `null` لم يُربَط. */
  linkedSupplierId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalMinor: number;
}

export interface InvoiceSide {
  id: string;
  supplierId: string;
  supplierName: string;
  invoiceNumber: string;
  /** يومُ الفاتورة بتوقيت الرياض. */
  day: string;
  totalMinor: number;
}

/** رقمُ الفاتورة بلا زخرفه: الحروفُ والأرقام وحدها، وبلا أصفارٍ في أوّله. */
export function normaliseInvoiceNumber(raw: string | null | undefined): string {
  return (raw ?? "").toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, "").replace(/^0+(?=.)/, "");
}

/** آخرُ سلسلةِ أرقامٍ في الرقم — «INV/2026/175629» و«INV175629» يلتقيان عند ‎175629‎. */
function digitTail(raw: string | null | undefined): string {
  const runs = (raw ?? "").match(/\d+/g);
  return runs ? runs[runs.length - 1].replace(/^0+(?=.)/, "") : "";
}

/** أقلُّ طولٍ لذيلِ الأرقام يُعتدّ به — ما دونه («003») يتكرّر بين المورّدين. */
const MIN_TAIL_DIGITS = 4;
/** كم يوماً يُتسامح به بين تاريخ الفاتورة عندنا وتاريخها في فودكس حين لا رقمَ يجمعهما. */
export const DATE_WINDOW_DAYS = 3;

export type MatchBasis =
  /** الرقمُ نفسُه. */
  | "NUMBER"
  /** ذيلُ الأرقام نفسُه والمبلغُ أو المورّدُ يؤيّده. */
  | "NUMBER_TAIL"
  /** لا رقمَ يجمعهما: المورّدُ المربوط والتاريخُ القريب والمبلغُ نفسُه. */
  | "SUPPLIER_DATE_AMOUNT";

export interface MatchedPair {
  purchase: PurchaseSide;
  invoice: InvoiceSide;
  basis: MatchBasis;
  /** فودكس − فاتورتُنا. داخل السماحة «متّفقان». */
  gapMinor: number;
  agrees: boolean;
  /** مورّدُ فودكس مربوطٌ بمورّدٍ غير مورّد هذه الفاتورة — يُقال، فقد يكون الربطُ خطأً. */
  supplierConflict: boolean;
}

export interface PurchaseComparison {
  matched: MatchedPair[];
  /** في فودكس ولا فاتورةَ تقابلها عندنا. */
  onlyFoodics: PurchaseSide[];
  /** فواتيرُ مورّدين يتابعهم فودكس، في مدّته، وليست فيه. */
  onlyOurs: InvoiceSide[];
  /** فواتيرُ خارج ما يتابعه فودكس (مورّدٌ غير مربوط، أو قبل أوّل حركة) — تُعدّ ولا تُسأل. */
  outOfScope: number;
  /** أوّلُ يومٍ فيه حركةُ شراءٍ عند فودكس — `null` لا حركات. */
  foodicsSince: string | null;
}

function within(gapMinor: number): boolean {
  return Math.abs(gapMinor) <= TOTAL_ROUNDING_TOLERANCE_MINOR;
}

/**
 * يقابل واحدةً بواحدة: الأقوى دليلاً أوّلاً، وما أُخذ لا يُؤخَذ ثانيةً.
 * وعند تعدّد المرشّحين يُقدَّم المورّدُ المربوط ثمّ الأقربُ مبلغاً ثمّ الأقربُ تاريخاً —
 * ترتيبٌ ثابت، فالنتيجةُ لا تتغيّر بترتيب الصفوف.
 */
export function comparePurchases(purchases: readonly PurchaseSide[], invoices: readonly InvoiceSide[]): PurchaseComparison {
  const takenInvoices = new Set<string>();
  const takenPurchases = new Set<string>();
  const matched: MatchedPair[] = [];

  const sortedPurchases = [...purchases].sort((a, b) => a.reference.localeCompare(b.reference));
  const dateOf = (p: PurchaseSide) => p.invoiceDate ?? p.businessDate;

  const pick = (p: PurchaseSide, candidates: InvoiceSide[]): InvoiceSide | null => {
    const free = candidates.filter((i) => !takenInvoices.has(i.id));
    if (free.length === 0) return null;
    return free.sort((a, b) =>
      Number(b.supplierId === p.linkedSupplierId) - Number(a.supplierId === p.linkedSupplierId)
      || Math.abs(a.totalMinor - p.totalMinor) - Math.abs(b.totalMinor - p.totalMinor)
      || Math.abs(daysBetween(a.day, dateOf(p))) - Math.abs(daysBetween(b.day, dateOf(p)))
      || a.id.localeCompare(b.id),
    )[0];
  };
  const take = (p: PurchaseSide, i: InvoiceSide, basis: MatchBasis) => {
    takenInvoices.add(i.id);
    takenPurchases.add(p.id);
    const gapMinor = p.totalMinor - i.totalMinor;
    matched.push({
      purchase: p, invoice: i, basis, gapMinor, agrees: within(gapMinor),
      supplierConflict: p.linkedSupplierId !== null && p.linkedSupplierId !== i.supplierId,
    });
  };

  /* ١. الرقمُ نفسُه — ولمورّدٍ مربوطٍ بغير مورّد الفاتورة يُشترط اتّفاقُ المبلغ */
  const byNumber = new Map<string, InvoiceSide[]>();
  for (const i of invoices) {
    const key = normaliseInvoiceNumber(i.invoiceNumber);
    if (key !== "") byNumber.set(key, [...(byNumber.get(key) ?? []), i]);
  }
  for (const p of sortedPurchases) {
    const key = normaliseInvoiceNumber(p.invoiceNumber);
    if (key === "") continue;
    const candidates = (byNumber.get(key) ?? []).filter((i) =>
      p.linkedSupplierId === null || i.supplierId === p.linkedSupplierId || within(p.totalMinor - i.totalMinor));
    const found = pick(p, candidates);
    if (found) take(p, found, "NUMBER");
  }

  /* ٢. ذيلُ الأرقام — يؤيّده المورّدُ المربوط أو المبلغُ نفسُه */
  const byTail = new Map<string, InvoiceSide[]>();
  for (const i of invoices) {
    const tail = digitTail(i.invoiceNumber);
    if (tail.length >= MIN_TAIL_DIGITS) byTail.set(tail, [...(byTail.get(tail) ?? []), i]);
  }
  for (const p of sortedPurchases) {
    if (takenPurchases.has(p.id)) continue;
    const tail = digitTail(p.invoiceNumber);
    if (tail.length < MIN_TAIL_DIGITS) continue;
    const candidates = (byTail.get(tail) ?? []).filter((i) =>
      i.supplierId === p.linkedSupplierId || within(p.totalMinor - i.totalMinor));
    const found = pick(p, candidates);
    if (found) take(p, found, "NUMBER_TAIL");
  }

  /* ٣. بلا رقمٍ يجمعهما: المورّدُ المربوط والتاريخُ القريب والمبلغُ نفسُه — الثلاثةُ معاً */
  for (const p of sortedPurchases) {
    if (takenPurchases.has(p.id) || p.linkedSupplierId === null) continue;
    const candidates = invoices.filter((i) =>
      i.supplierId === p.linkedSupplierId
      && within(p.totalMinor - i.totalMinor)
      && Math.abs(daysBetween(i.day, dateOf(p))) <= DATE_WINDOW_DAYS);
    const found = pick(p, candidates);
    if (found) take(p, found, "SUPPLIER_DATE_AMOUNT");
  }

  const foodicsSince = purchases.length === 0 ? null : purchases.map((p) => p.businessDate).sort()[0];
  /* مورّدٌ «يتابعه فودكس»: رُبط به مورّدُ فودكس، أو طابقت له فاتورةٌ فعلاً */
  const tracked = new Set<string>([
    ...purchases.flatMap((p) => (p.linkedSupplierId ? [p.linkedSupplierId] : [])),
    ...matched.map((m) => m.invoice.supplierId),
  ]);

  const onlyOurs: InvoiceSide[] = [];
  let outOfScope = 0;
  for (const i of invoices) {
    if (takenInvoices.has(i.id)) continue;
    if (foodicsSince !== null && i.day >= foodicsSince && tracked.has(i.supplierId)) onlyOurs.push(i);
    else outOfScope++;
  }

  return {
    matched: matched.sort((a, b) => b.purchase.businessDate.localeCompare(a.purchase.businessDate) || a.purchase.reference.localeCompare(b.purchase.reference)),
    onlyFoodics: sortedPurchases.filter((p) => !takenPurchases.has(p.id)).sort((a, b) => b.businessDate.localeCompare(a.businessDate)),
    onlyOurs: onlyOurs.sort((a, b) => b.day.localeCompare(a.day)),
    outOfScope,
    foodicsSince,
  };
}

/* ─────────────────────────── اقتراحُ ربط المورّد ─────────────────────────── */

export interface SupplierLinkSuggestion {
  foodicsSupplierId: string;
  supplierId: string;
  supplierName: string;
  /** كم حركةً طابقت فاتورةً لهذا المورّد برقمها ومبلغها — الدليل. */
  evidence: number;
  /** وكم حركةً لمورّد فودكس هذا طابقت مورّداً آخر — ما ينقض الاقتراح. */
  against: number;
}

/** أقلُّ دليلٍ يُقترَح به ربط. */
export const LINK_MIN_EVIDENCE = 2;

/**
 * يقترح لمورّد فودكس غير المربوط مورّدَنا — **من الفواتير التي طابقت لا من الاسم**.
 *
 * حركتان فأكثر لمورّد فودكس طابقتا رقماً ومبلغاً فواتيرَ مورّدٍ واحد عندنا، ولم
 * يطابق غيرَه أكثرُ منها. ومن توزّعت حركاتُه على مورّدين («مورد حبوب قهوة») لا
 * يُقترَح له: هو اسمٌ جامعٌ لا مورّد. والاقتراحُ يُعرَض، والربطُ بضغطة إنسان.
 */
export function suggestSupplierLinks(matched: readonly MatchedPair[]): SupplierLinkSuggestion[] {
  const tally = new Map<string, Map<string, { name: string; n: number }>>();
  for (const m of matched) {
    const f = m.purchase.foodicsSupplierId;
    if (!f || m.purchase.linkedSupplierId !== null || !m.agrees || m.basis === "SUPPLIER_DATE_AMOUNT") continue;
    let of = tally.get(f);
    if (!of) tally.set(f, (of = new Map()));
    const cell = of.get(m.invoice.supplierId) ?? { name: m.invoice.supplierName, n: 0 };
    cell.n++;
    of.set(m.invoice.supplierId, cell);
  }
  const out: SupplierLinkSuggestion[] = [];
  for (const [foodicsSupplierId, of] of tally) {
    const ranked = [...of.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
    const [supplierId, top] = ranked[0];
    const against = ranked.slice(1).reduce((s, [, c]) => s + c.n, 0);
    /* الأغلبيّةُ الساحقة: الدليلُ ثلاثةُ أضعاف ما ينقضه على الأقلّ */
    if (top.n >= LINK_MIN_EVIDENCE && top.n >= against * 3) {
      out.push({ foodicsSupplierId, supplierId, supplierName: top.name, evidence: top.n, against });
    }
  }
  return out;
}
