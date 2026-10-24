/**
 * دمجُ مورّدٍ في آخر، وحذفُ مورّدٍ بلا مال، و«مورّدون قد يكونون واحداً» — القواعدُ الخالصة.
 *
 * (أحمد، ٢٤ أكتوبر ٢٠٢٦): فعلان للمالك من صفحة المورّد لا نصّان. **الاسمُ ليس هويّة**:
 * التلميحُ يقترح ولا يدمج، والدمجُ يُعاين أوّلاً بما ينتقل فعلاً، ورقمان ضريبيّان
 * مختلفان أو آيبانان مختلفان يُقالان قبل التأكيد.
 *
 * والقراءةُ والكتابة في `services/supplier-merge.service.ts`.
 */
import { supplierBalance, type SupplierBalance } from "./supplier-balances";
import { normalizeName } from "./suppliers-seed";
import { similarity, trigramSimilarity } from "./supplier-match";

/** الجداولُ التي يُنقل فيها `supplier_id` من المصدر إلى الهدف — بالترتيب الذي يُعرض به. */
export const MERGE_TABLES = [
  "invoices", "invoice_lines", "payments", "statements", "bank_transactions", "documents",
  "supplier_aliases", "supplier_products", "supplier_item_aliases", "counterparties",
  "bank_rules", "inventory_receipts", "foodics_suppliers", "ai_findings",
] as const;
export type MergeTable = (typeof MERGE_TABLES)[number];

export const MERGE_TABLE_LABEL: Record<MergeTable, string> = {
  invoices: "فواتير",
  invoice_lines: "بنود فواتير",
  payments: "دفعات (ومعها تخصيصاتها)",
  statements: "كشوف حساب",
  bank_transactions: "حركات بنك منسوبة إليه",
  documents: "مستندات",
  supplier_aliases: "أسماء بديلة",
  supplier_products: "أصناف وتاريخ أسعارها",
  supplier_item_aliases: "صيغ أسماء أصناف",
  counterparties: "جهات في كشف البنك (ومعها حساباتها)",
  bank_rules: "قواعد تصنيف",
  inventory_receipts: "استلامات مخزون",
  foodics_suppliers: "مورّدو فودكس المربوطون",
  ai_findings: "ملاحظات التحليل",
};

/** «عليك» بعد الدمج — بالمعادلة نفسها على مجموع الطرفين، وبسياسة الهدف في الفواتير. */
export function mergedBalance(source: SupplierBalance | undefined, target: SupplierBalance | undefined, targetIssuesInvoices: boolean): SupplierBalance {
  const z = { billedMinor: 0, openMinor: 0, openCount: 0, paidNetMinor: 0, creditNotesMinor: 0, creditMinor: 0 };
  const a = source ?? z;
  const b = target ?? z;
  return supplierBalance({
    supplierId: target?.supplierId ?? source?.supplierId ?? "",
    billedMinor: a.billedMinor + b.billedMinor,
    openMinor: a.openMinor + b.openMinor,
    openCount: a.openCount + b.openCount,
    paidNetMinor: a.paidNetMinor + b.paidNetMinor,
    creditNotesMinor: (a.creditNotesMinor ?? 0) + (b.creditNotesMinor ?? 0),
    creditMinor: a.creditMinor + b.creditMinor,
    issuesInvoices: targetIssuesInvoices,
  });
}

export interface IdentityFields {
  vatNumber: string | null;
  iban: string | null;
}

export interface MergeConflict {
  field: "VAT" | "IBAN";
  label: string;
  source: string;
  target: string;
}

const clean = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, "").toUpperCase();

/**
 * ما يختلف بين هويّتَي الطرفين — رقمان ضريبيّان مختلفان منشأتان في الغالب. يُقال ولا
 * يُمنع: صاحبُ المقهى يعرف إن كان المورّدُ غيّر سجلّه. وما يملكه أحدُهما وحده يُنسخ للهدف.
 */
export function mergeConflicts(source: IdentityFields, target: IdentityFields): { conflicts: MergeConflict[]; copy: { vatNumber: string | null; iban: string | null } } {
  const conflicts: MergeConflict[] = [];
  const sv = clean(source.vatNumber), tv = clean(target.vatNumber);
  const si = clean(source.iban), ti = clean(target.iban);
  if (sv && tv && sv !== tv) conflicts.push({ field: "VAT", label: "رقمان ضريبيان مختلفان، وهذا يعني غالباً منشأتين لا منشأة واحدة. يبقى رقم المورّد الباقي", source: sv, target: tv });
  if (si && ti && si !== ti) conflicts.push({ field: "IBAN", label: "آيبانان مختلفان. يبقى آيبان المورّد الباقي، وآيبان المدموج يبقى دليلاً في حركاته", source: si, target: ti });
  return {
    conflicts,
    copy: { vatNumber: sv && !tv ? source.vatNumber : null, iban: si && !ti ? source.iban : null },
  };
}

/** ما يمنع الحذف — مالٌ مقيَّد له. وما سواه (مستندات · أسماء) يُفكّ ويُقال. */
export interface MoneyCounts {
  invoices: number;
  payments: number;
  statements: number;
  bankTransactions: number;
  inventoryReceipts: number;
}

const MONEY_LABEL: Record<keyof MoneyCounts, string> = {
  invoices: "فواتير",
  payments: "دفعات أو تخصيصات",
  statements: "كشوف حساب",
  bankTransactions: "حركات بنك",
  inventoryReceipts: "استلامات مخزون بتكلفتها",
};

export function deleteBlockers(c: MoneyCounts): { label: string; count: number }[] {
  return (Object.keys(MONEY_LABEL) as (keyof MoneyCounts)[])
    .filter((k) => c[k] > 0)
    .map((k) => ({ label: MONEY_LABEL[k], count: c[k] }));
}

/* ─────────────── مورّدون قد يكونون واحداً — تلميحٌ للقراءة، لا دمج ─────────────── */

export interface SupplierIdentity {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string | null;
  vatNumber: string | null;
  iban: string | null;
}

export type DuplicateReason = "VAT" | "IBAN" | "NAME";

export interface DuplicateHint {
  a: SupplierIdentity;
  b: SupplierIdentity;
  reason: DuplicateReason;
  /** للاسم وحده: كم يتشابهان (٠–١) */
  score: number | null;
}

export const DUPLICATE_REASON_LABEL: Record<DuplicateReason, string> = {
  VAT: "الرقم الضريبي نفسه",
  IBAN: "الآيبان نفسه",
  NAME: "اسمان متقاربان جداً",
};

/** حدُّ «متقاربان جداً» — والتلميحُ لا يدمج، فالحدُّ يُخطئ نحو الإظهار قليلاً لا كثيراً. */
export const NAME_HINT_MIN = 0.85;

/** أقصى ما يُعرض — تلميحٌ لا قائمة عمل. */
export const DUPLICATE_HINT_LIMIT = 8;

export function duplicateHints(list: readonly SupplierIdentity[]): DuplicateHint[] {
  const out: DuplicateHint[] = [];
  const seen = new Set<string>();
  const add = (a: SupplierIdentity, b: SupplierIdentity, reason: DuplicateReason, score: number | null) => {
    const [x, y] = a.id < b.id ? [a, b] : [b, a];
    const key = `${x.id}|${y.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ a: x, b: y, reason, score });
  };
  const names = list.map((s) => ({ s, n: normalizeName(s.nameAr), e: normalizeName(s.nameEn ?? "") }));
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i], b = names[j];
      if (clean(a.s.vatNumber) && clean(a.s.vatNumber) === clean(b.s.vatNumber)) { add(a.s, b.s, "VAT", null); continue; }
      if (clean(a.s.iban) && clean(a.s.iban) === clean(b.s.iban)) { add(a.s, b.s, "IBAN", null); continue; }
      /* رقمان ضريبيّان مختلفان كيانان — لا يُلمَّح باسمهما */
      if (clean(a.s.vatNumber) && clean(b.s.vatNumber)) continue;
      const score = Math.max(nameScore(a.n, b.n), nameScore(a.e, b.e));
      if (score >= NAME_HINT_MIN) add(a.s, b.s, "NAME", Math.round(score * 100) / 100);
    }
  }
  const rank: Record<DuplicateReason, number> = { VAT: 0, IBAN: 1, NAME: 2 };
  return out
    .sort((x, y) => rank[x.reason] - rank[y.reason] || (y.score ?? 1) - (x.score ?? 1) || x.a.nameAr.localeCompare(y.a.nameAr))
    .slice(0, DUPLICATE_HINT_LIMIT);
}

function nameScore(a: string, b: string): number {
  if (a.length < 3 || b.length < 3) return 0;
  /* الاحتواءُ وتقاطعُ الكلمات حَكَمان، والثلاثيّاتُ لخطأ حرفٍ في القراءة — وكلاهما يلزمه الآخر قليلاً */
  const s = similarity(a, b);
  const t = trigramSimilarity(a, b);
  return s >= NAME_HINT_MIN ? Math.max(s, t) : t >= 0.9 ? t : Math.min(s, t);
}

/* ─────────────── ما يُعرض قبل التأكيد — يملؤه الخادم (`supplier-merge.service.ts`) ─────────────── */

export interface MergePreview {
  source: { id: string; slug: string; name: string };
  target: { id: string; slug: string; name: string };
  /** كم صفّاً ينتقل من كلّ جدول */
  counts: Record<MergeTable, number>;
  /** ما يحمله الهدفُ أصلاً فيُحذف من المصدر بدل نقله (ويُحفظ صفُّه للتراجع) */
  duplicates: { aliases: number; products: number; itemAliases: number };
  conflicts: MergeConflict[];
  /** ما يُنسخ إلى الهدف لأنّه يخلو منه */
  copies: { vatNumber: string | null; iban: string | null };
  balance: { source: number; target: number; after: number; creditAfter: number };
  /** أشهرٌ مقفلة يمسّها الدمج — وجودُها يردّه */
  closedMonths: string[];
  /** لماذا لا يُدمج أصلاً — `null` يُدمج */
  refused: string | null;
}


export interface DeletePreview {
  supplier: { id: string; slug: string; name: string };
  money: MoneyCounts;
  blockers: { label: string; count: number }[];
  /** ما يُفكّ أو يُحذف معه — يُقال قبل التأكيد */
  detach: { documents: number; aliases: number; products: number; itemAliases: number; counterparties: number; rules: number; foodics: number; findings: number };
  refused: string | null;
}

