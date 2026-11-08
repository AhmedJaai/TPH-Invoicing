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
 * **والمطابقةُ بالمورّد واليوم والمبلغ — لا برقم الفاتورة** (أحمد، ١١ أكتوبر ٢٠٢٦): الرقمُ
 * يُكتب في فودكس بيدٍ وعلى غير صيغة المورّد، فغيابُ تطابقه لا يعني غيابَ الفاتورة.
 * فاتورةٌ للمورّد نفسِه في اليوم نفسِه بالمبلغ نفسِه **موجودة**؛ والرقمُ إن طابق تأكيدٌ
 * زائد يُقال، وإن خالف لا يُسقِط شيئاً. والاسمُ لا يُطابَق به: «مورد حبوب قهوة» خمسةُ مورّدين.
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
/** كم يوماً يُتسامح به بين تاريخ الفاتورة عندنا وتاريخها في فودكس حين لا يتّفق اليوم. */
export const DATE_WINDOW_DAYS = 3;

export type MatchBasis =
  /** المورّدُ المربوط واليومُ والمبلغُ — القاعدة. */
  | "SUPPLIER_DAY_AMOUNT"
  /** المورّدُ المربوط والمبلغُ، والتاريخُ يبعد أيّاماً (أُدخلت في فودكس بعد وصولها). */
  | "SUPPLIER_DATE_AMOUNT"
  /** الرقمُ نفسُه — لمورّدٍ لم يُربَط، أو حين اختلف المبلغ. */
  | "NUMBER"
  /** ذيلُ الأرقام نفسُه والمبلغُ أو المورّدُ يؤيّده. */
  | "NUMBER_TAIL"
  /**
   * مورّدُ فودكس غيرُ مربوط، وفاتورةٌ واحدةٌ لا غيرُها عندنا بمبلغها بالهللة في يومها أو قريباً منه.
   * «مورد حبوب قهوة» حمل فواتيرَ «أفال» قبل أن يُنشأ «Aval» في فودكس — ولا يُربط، فهو اسمٌ جامع.
   */
  | "DAY_AMOUNT";

export interface MatchedPair {
  purchase: PurchaseSide;
  invoice: InvoiceSide;
  basis: MatchBasis;
  /** رقمُ الفاتورة عند الطرفين واحد — تأكيدٌ زائد، لا شرط. */
  numberConfirms: boolean;
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

/** بُعدُ الفاتورة عن الحركة بالأيّام: عن أقرب تاريخَيها — تاريخِ فاتورتها أو يومِ إدخالها في فودكس. */
function daysOff(p: PurchaseSide, i: InvoiceSide): number {
  return Math.min(
    Math.abs(daysBetween(i.day, p.businessDate)),
    p.invoiceDate ? Math.abs(daysBetween(i.day, p.invoiceDate)) : Infinity,
  );
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

  const pick = (p: PurchaseSide, candidates: InvoiceSide[]): InvoiceSide | null => {
    const free = candidates.filter((i) => !takenInvoices.has(i.id));
    if (free.length === 0) return null;
    return free.sort((a, b) =>
      Number(b.supplierId === p.linkedSupplierId) - Number(a.supplierId === p.linkedSupplierId)
      /* الرقمُ المطابق يرجّح بين متساويَين — تأكيدٌ زائد */
      || Number(normaliseInvoiceNumber(b.invoiceNumber) === normaliseInvoiceNumber(p.invoiceNumber) && normaliseInvoiceNumber(p.invoiceNumber) !== "")
        - Number(normaliseInvoiceNumber(a.invoiceNumber) === normaliseInvoiceNumber(p.invoiceNumber) && normaliseInvoiceNumber(p.invoiceNumber) !== "")
      || Math.abs(a.totalMinor - p.totalMinor) - Math.abs(b.totalMinor - p.totalMinor)
      || daysOff(p, a) - daysOff(p, b)
      || a.id.localeCompare(b.id),
    )[0];
  };
  const sameNumber = (p: PurchaseSide, i: InvoiceSide) => {
    const key = normaliseInvoiceNumber(p.invoiceNumber);
    return key !== "" && key === normaliseInvoiceNumber(i.invoiceNumber);
  };
  const take = (p: PurchaseSide, i: InvoiceSide, basis: MatchBasis) => {
    takenInvoices.add(i.id);
    takenPurchases.add(p.id);
    const gapMinor = p.totalMinor - i.totalMinor;
    matched.push({
      purchase: p, invoice: i, basis, gapMinor, agrees: within(gapMinor), numberConfirms: sameNumber(p, i),
      supplierConflict: p.linkedSupplierId !== null && p.linkedSupplierId !== i.supplierId,
    });
  };
  /** يومُ الفاتورة عندنا هو يومُها في فودكس — تاريخُ فاتورتها أو يومُ إدخالها. */
  const sameDay = (p: PurchaseSide, i: InvoiceSide) => i.day === p.invoiceDate || i.day === p.businessDate;

  const byNumber = new Map<string, InvoiceSide[]>();
  for (const i of invoices) {
    const key = normaliseInvoiceNumber(i.invoiceNumber);
    if (key !== "") byNumber.set(key, [...(byNumber.get(key) ?? []), i]);
  }
  const numberCandidates = (p: PurchaseSide) => byNumber.get(normaliseInvoiceNumber(p.invoiceNumber)) ?? [];

  /*
    ١. ما اجتمع فيه الرقمُ والمبلغ — أقوى دليل، فيُحجَز أوّلاً: وإلّا أخذت حركةٌ أخرى
       بالمبلغ نفسِه في اليوم نفسِه فاتورةً هي لغيرها رقماً ومبلغاً.
  */
  for (const p of sortedPurchases) {
    if (normaliseInvoiceNumber(p.invoiceNumber) === "") continue;
    const found = pick(p, numberCandidates(p).filter((i) =>
      within(p.totalMinor - i.totalMinor) && (p.linkedSupplierId === null || i.supplierId === p.linkedSupplierId)));
    if (found) take(p, found, p.linkedSupplierId !== null && sameDay(p, found) ? "SUPPLIER_DAY_AMOUNT" : "NUMBER");
  }

  /* ٢. القاعدة: المورّدُ المربوط واليومُ نفسُه والمبلغُ نفسُه — والرقمُ لا يُسأل عنه */
  for (const p of sortedPurchases) {
    if (takenPurchases.has(p.id) || p.linkedSupplierId === null) continue;
    const found = pick(p, invoices.filter((i) =>
      i.supplierId === p.linkedSupplierId && within(p.totalMinor - i.totalMinor) && sameDay(p, i)));
    if (found) take(p, found, "SUPPLIER_DAY_AMOUNT");
  }

  /* ٣. والمبلغُ نفسُه للمورّد نفسِه بتاريخٍ يبعد أيّاماً — فاتورةٌ أُدخلت في فودكس بعد يومها */
  for (const p of sortedPurchases) {
    if (takenPurchases.has(p.id) || p.linkedSupplierId === null) continue;
    const found = pick(p, invoices.filter((i) =>
      i.supplierId === p.linkedSupplierId
      && within(p.totalMinor - i.totalMinor)
      && daysOff(p, i) <= DATE_WINDOW_DAYS));
    if (found) take(p, found, "SUPPLIER_DATE_AMOUNT");
  }

  /*
    ٤. الرقمُ نفسُه والمبلغُ مختلف — يُقرَن ليُعرَض الفرق. ولمورّدٍ مربوط يُشترط أن تكون
       الفاتورةُ فاتورتَه: رقمٌ يتكرّر بين المورّدين لا يجمع حركةً بفاتورة غيره.
  */
  for (const p of sortedPurchases) {
    if (takenPurchases.has(p.id) || normaliseInvoiceNumber(p.invoiceNumber) === "") continue;
    const found = pick(p, numberCandidates(p).filter((i) => p.linkedSupplierId === null || i.supplierId === p.linkedSupplierId));
    if (found) take(p, found, "NUMBER");
  }

  /* ٥. ذيلُ الأرقام — يؤيّده المورّدُ المربوط أو المبلغُ نفسُه */
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

  /*
    ٦. مورّدُ فودكس غيرُ مربوط ورقمُه لا يلتقي: يُقرَن بفاتورةٍ **واحدةٍ لا غيرُها** بمبلغه في يومه،
       ثمّ في أيّامٍ قريبة. فإن وقع المبلغُ على فاتورتَين فلا يُختار — المبلغُ وحده لا يفرّق بينهما.
       (أحمد، ٨ نوفمبر ٢٠٢٦: «نفس الفاتورة بنفس المبلغ بنفس اليوم، والفرقُ في كتابة الرقم».)
  */
  for (const near of [(p: PurchaseSide, i: InvoiceSide) => daysOff(p, i) === 0, (p: PurchaseSide, i: InvoiceSide) => daysOff(p, i) <= DATE_WINDOW_DAYS]) {
    for (const p of sortedPurchases) {
      if (takenPurchases.has(p.id) || p.linkedSupplierId !== null) continue;
      /* المبلغُ بالهللة لا بسماحة الريال: «١٤٠» من البقالة ليست «١٤١» من المطبعة */
      const free = invoices.filter((i) => !takenInvoices.has(i.id) && i.totalMinor === p.totalMinor && near(p, i));
      if (free.length !== 1) continue;
      /* وحركةٌ أخرى غيرُ مربوطة تطلب الفاتورةَ نفسَها بالشرط نفسِه — لا يُحسَم بينهما */
      const rivals = sortedPurchases.filter((o) => o.id !== p.id && !takenPurchases.has(o.id) && o.linkedSupplierId === null
        && o.totalMinor === free[0].totalMinor && near(o, free[0]));
      if (rivals.length === 0) take(p, free[0], "DAY_AMOUNT");
    }
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
  /** كم حركةً طابقت فاتورةً لهذا المورّد — برقمها ومبلغها، أو بمبلغها في يومها. الدليل. */
  evidence: number;
  /** وكم حركةً لمورّد فودكس هذا طابقت مورّداً آخر — ما ينقض الاقتراح. */
  against: number;
}

/** أقلُّ دليلٍ يُقترَح به ربط. */
export const LINK_MIN_EVIDENCE = 2;

/**
 * يقترح لمورّد فودكس غير المربوط مورّدَنا — **من الفواتير التي طابقت لا من الاسم**.
 *
 * الدليلُ حركةٌ طابقت فاتورةً لمورّدٍ عندنا بأحد بابين:
 *   - رقمُها ومبلغُها (`matched` بتأكيد الرقم)؛
 *   - أو **مبلغُها في يومها أو قريباً منه** ولا فاتورةَ بهذا المبلغ في هذه الأيّام لمورّدٍ غيره
 *     (أحمد، ٨ نوفمبر ٢٠٢٦: «Aval» يكتب في فودكس ‎S000102‎ وفاتورتُه ‎INV-2026-00080‎ —
 *     الرقمُ يُكتب بيدٍ فلا يلتقي، والمبلغُ بالهللة في اليوم نفسِه لا يتّفق مصادفةً).
 *
 * حركتان فأكثر لمورّدٍ واحد، والدليلُ ثلاثةُ أضعاف ما ينقضه. ومن توزّعت حركاتُه على
 * مورّدين («مورد حبوب قهوة») لا يُقترَح له: هو اسمٌ جامعٌ لا مورّد.
 * **والاقتراحُ يُعرَض، والربطُ بضغطة إنسان** — وبعده يطابق المورّدُ واليومُ والمبلغ.
 */
export function suggestSupplierLinks(comparison: Pick<PurchaseComparison, "matched" | "onlyFoodics">, invoices: readonly InvoiceSide[] = []): SupplierLinkSuggestion[] {
  const tally = new Map<string, Map<string, { name: string; n: number }>>();
  const count = (foodicsSupplierId: string, i: InvoiceSide) => {
    let of = tally.get(foodicsSupplierId);
    if (!of) tally.set(foodicsSupplierId, (of = new Map()));
    const cell = of.get(i.supplierId) ?? { name: i.supplierName, n: 0 };
    cell.n++;
    of.set(i.supplierId, cell);
  };

  for (const m of comparison.matched) {
    const f = m.purchase.foodicsSupplierId;
    if (!f || m.purchase.linkedSupplierId !== null || !m.agrees || !(m.numberConfirms || m.basis === "DAY_AMOUNT")) continue;
    count(f, m.invoice);
  }

  /* الحركاتُ التي لم تجد فاتورةً لأنّ مورّدَها غيرُ مربوط ورقمَها لا يلتقي — يُسأل مبلغُها في يومها */
  const taken = new Set(comparison.matched.map((m) => m.invoice.id));
  const free = invoices.filter((i) => !taken.has(i.id));
  for (const p of comparison.onlyFoodics) {
    if (!p.foodicsSupplierId || p.linkedSupplierId !== null) continue;
    const near = free.filter((i) => i.totalMinor === p.totalMinor && daysOff(p, i) <= DATE_WINDOW_DAYS);
    const owners = new Set(near.map((i) => i.supplierId));
    /* مبلغٌ يقع عند مورّدَين في الأيّام نفسها لا يشهد لأحدهما */
    if (owners.size === 1) count(p.foodicsSupplierId, near[0]);
  }

  const candidates: SupplierLinkSuggestion[] = [];
  for (const [foodicsSupplierId, of] of tally) {
    const ranked = [...of.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
    const [supplierId, top] = ranked[0];
    const against = ranked.slice(1).reduce((s, [, c]) => s + c.n, 0);
    /* الأغلبيّةُ الساحقة: الدليلُ ثلاثةُ أضعاف ما ينقضه على الأقلّ */
    if (top.n >= LINK_MIN_EVIDENCE && top.n >= against * 3) {
      candidates.push({ foodicsSupplierId, supplierId, supplierName: top.name, evidence: top.n, against });
    }
  }

  /*
    مورّدُنا يُقترَح لمورّد فودكس واحد — الأقوى دليلاً — ولا يُقترَح وقد رُبط بغيره. فـ«مورد حبوب
    قهوة» حملت حركاتُه الأولى فواتيرَ «أفال» قبل أن يُنشأ «Aval» في فودكس، وحركاتٍ لغيره؛
    وربطُه بـ«أفال» ينسب إليه ما ليس له. والاسمان لمورّدٍ واحد يُربط ثانيهما بيدٍ من القائمة.
  */
  const claimed = new Set(
    [...comparison.matched.map((m) => m.purchase), ...comparison.onlyFoodics].flatMap((p) => (p.linkedSupplierId ? [p.linkedSupplierId] : [])),
  );
  const out: SupplierLinkSuggestion[] = [];
  for (const c of candidates.sort((a, b) => b.evidence - a.evidence || a.foodicsSupplierId.localeCompare(b.foodicsSupplierId))) {
    if (claimed.has(c.supplierId)) continue;
    claimed.add(c.supplierId);
    out.push(c);
  }
  return out;
}
