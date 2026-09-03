/**
 * مطابقة حركات البنك بالفواتير.
 *
 * الحقيقة التي تحكم التصميم: اسم المستفيد في البنك يخالف اسم المورّد غالباً.
 * «شركة أنس غالب حمزة خاشقجي» هي غاناش، و«شركة إيفال بي بي إس» هي أفال.
 * لذلك المطابقة تمرّ على الأسماء البديلة، وتتعلّم كل اسم جديد بعد إقراره.
 */
import { normalizeName } from "@/lib/suppliers-seed";

export interface BankTx {
  id: string;
  valueDate: Date;
  description: string;
  transactionType: string;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
}

export interface OpenInvoice {
  invoiceId: string;
  supplierId: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: Date;
  periodMonth: string;
  outstandingMinor: number;
}

export interface SupplierAliasIndex {
  supplierId: string;
  supplierName: string;
  /** كل الأسماء المطبَّعة التي يُعرف بها: اسمه ومجلده وأسماؤه البنكية */
  normalizedNames: string[];
}

export type BankMatchKind =
  | "EXACT_INVOICE"
  | "INVOICE_GROUP"
  | "SUPPLIER_ONLY"
  | "INTERNAL"
  | "NONE";

export interface BankMatch {
  tx: BankTx;
  kind: BankMatchKind;
  supplierId?: string;
  supplierName?: string;
  /** الفواتير التي تفسّر هذه الحركة */
  invoices: OpenInvoice[];
  confidence: number;
  note?: string;
}

/** حركات لا علاقة لها بالمورّدين — نستبعدها قبل المطابقة لتصفو النتيجة. */
const INTERNAL_PATTERNS = [
  "نقاط بيع", "دفع الكتروني", "رسوم", "ضريبة عملية", "الرسوم الشهرية",
  "إيداع مبالغ نقاط البيع", "رسوم تحويل",
];

export function isInternalNoise(tx: BankTx): boolean {
  const t = `${tx.transactionType} ${tx.description}`;
  return INTERNAL_PATTERNS.some((p) => t.includes(p));
}

/**
 * كلمات لا تميّز مورّداً عن آخر — كل الشركات تحملها.
 * مطابقتها تعني مطابقة الجميع، فتُهمَل.
 */
const STOPWORDS = new Set([
  "شركه", "مؤسسه", "التجاريه", "تجاريه", "المحدوده", "محدوده", "للتجاره", "تجاره",
  "مصنع", "معرض", "وشركاه", "واولاده", "الوطنيه", "العربيه", "السعوديه",
  "company", "co", "ltd", "limited", "est", "establishment", "trading", "factory", "for",
  "ben", "id", "bv", "bb", "ref", "transfer", "تحويل", "حواله", "سداد", "مدفوعات",
]);

/** الكلمات المميِّزة في اسم: ما ليس شائعاً وطوله ثلاثة أحرف فأكثر. */
function distinctiveTokens(normalized: string): string[] {
  return normalized.split(" ").filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * يتعرّف على المورّد من وصف الحركة.
 *
 * وصف البنك مقطوع ومشوّش غالباً: «شركة انس غالب حمزه خاشقجي  التجارية المحد ودة».
 * فاشتراط ورود الاسم البديل كاملاً يفشل. المعوّل على الكلمات المميِّزة:
 * «خاشقجي» وحدها تكفي، و«شركة التجارية» لا تكفي مهما تكرّرت.
 */
export function findSupplierInText(
  text: string,
  index: readonly SupplierAliasIndex[],
  minScore = 0.5,
): SupplierAliasIndex | undefined {
  const haystack = normalizeName(text);
  if (!haystack) return undefined;
  const haystackTokens = new Set(haystack.split(" "));

  // كلمة لا ترد إلا عند مورّد واحد تدلّ عليه وحدها ولو جاءت مقطوعة عن سياقها
  const owners = new Map<string, Set<string>>();
  for (const s of index) {
    for (const name of s.normalizedNames) {
      for (const t of distinctiveTokens(name)) {
        const set = owners.get(t) ?? new Set<string>();
        set.add(s.supplierId);
        owners.set(t, set);
      }
    }
  }
  const isUnique = (t: string) => (owners.get(t)?.size ?? 0) === 1;

  let best: SupplierAliasIndex | undefined;
  let bestScore = 0;

  for (const s of index) {
    for (const name of s.normalizedNames) {
      if (name.length < 3) continue;

      // تطابق نصّي كامل: أقوى دليل ممكن
      if (haystack.includes(name)) {
        const score = 2 + name.length / 100;
        if (score > bestScore) { best = s; bestScore = score; }
        continue;
      }

      const tokens = distinctiveTokens(name);
      if (tokens.length === 0) continue;

      const matched = tokens.filter((t) => haystackTokens.has(t) || haystack.includes(t));
      if (matched.length === 0) continue;

      const ratio = matched.length / tokens.length;
      // كلمة متفرّدة طويلة تكفي وحدها — وصف البنك يُقطع فلا نشترط الاسم كاملاً
      const strongUnique = matched.some((t) => t.length >= 5 && isUnique(t));
      const weight = matched.reduce((a, t) => a + t.length, 0) / 40;
      const score = ratio + Math.min(weight, 0.5) + (strongUnique ? 0.5 : 0);

      if ((ratio >= minScore || strongUnique) && score > bestScore) {
        best = s;
        bestScore = score;
      }
    }
  }

  return best;
}

/** مجموعات الفواتير التي يساوي مجموعها المبلغ — لدفعة تسدّد عدة فواتير. */
export function findInvoiceCombination(
  invoices: readonly OpenInvoice[],
  targetMinor: number,
  tolerance = 100,
): OpenInvoice[] | null {
  const pool = invoices.filter((i) => i.outstandingMinor > 0).slice(0, 14);

  for (const inv of pool) {
    if (Math.abs(inv.outstandingMinor - targetMinor) <= tolerance) return [inv];
  }
  // مجموع كامل المجموعة أوّلاً — النمط الشائع: سداد كل فواتير الشهر دفعةً
  const all = pool.reduce((s, i) => s + i.outstandingMinor, 0);
  if (pool.length > 1 && Math.abs(all - targetMinor) <= tolerance) return [...pool];

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      if (Math.abs(pool[i].outstandingMinor + pool[j].outstandingMinor - targetMinor) <= tolerance) {
        return [pool[i], pool[j]];
      }
      for (let k = j + 1; k < pool.length; k++) {
        const sum = pool[i].outstandingMinor + pool[j].outstandingMinor + pool[k].outstandingMinor;
        if (Math.abs(sum - targetMinor) <= tolerance) return [pool[i], pool[j], pool[k]];
      }
    }
  }
  return null;
}

export function matchBankTransactions(
  transactions: readonly BankTx[],
  openInvoices: readonly OpenInvoice[],
  aliasIndex: readonly SupplierAliasIndex[],
): BankMatch[] {
  const bySupplier = new Map<string, OpenInvoice[]>();
  for (const inv of openInvoices) {
    const list = bySupplier.get(inv.supplierId) ?? [];
    list.push(inv);
    bySupplier.set(inv.supplierId, list);
  }

  const claimed = new Set<string>();
  const results: BankMatch[] = [];

  for (const tx of transactions) {
    if (tx.direction === "CREDIT" || isInternalNoise(tx)) {
      results.push({ tx, kind: "INTERNAL", invoices: [], confidence: 1, note: "حركة تشغيلية لا سداد مورّد" });
      continue;
    }

    const supplier = findSupplierInText(`${tx.description} ${tx.transactionType}`, aliasIndex);
    if (!supplier) {
      results.push({ tx, kind: "NONE", invoices: [], confidence: 0 });
      continue;
    }

    const candidates = (bySupplier.get(supplier.supplierId) ?? [])
      .filter((i) => !claimed.has(i.invoiceId) && i.invoiceDate <= tx.valueDate);

    const combo = findInvoiceCombination(candidates, tx.amountMinor);
    if (combo) {
      for (const i of combo) claimed.add(i.invoiceId);
      results.push({
        tx,
        kind: combo.length === 1 ? "EXACT_INVOICE" : "INVOICE_GROUP",
        supplierId: supplier.supplierId,
        supplierName: supplier.supplierName,
        invoices: combo,
        confidence: combo.length === 1 ? 0.98 : 0.9,
        note: combo.length > 1 ? `تسدّد ${combo.length} فواتير` : undefined,
      });
      continue;
    }

    results.push({
      tx,
      kind: "SUPPLIER_ONLY",
      supplierId: supplier.supplierId,
      supplierName: supplier.supplierName,
      invoices: [],
      confidence: 0.6,
      note: "عُرف المورّد ولم تُطابَق فاتورة بعينها",
    });
  }

  return results;
}

/** دفعتان لنفس الجهة بنفس المبلغ في نفس اليوم — نمط الدفع المكرر. */
export function findDuplicatePayments(transactions: readonly BankTx[]): BankTx[][] {
  const groups = new Map<string, BankTx[]>();
  for (const tx of transactions) {
    if (tx.direction !== "DEBIT" || isInternalNoise(tx)) continue;
    const key = `${tx.valueDate.toISOString().slice(0, 10)}|${tx.amountMinor}|${normalizeName(tx.description).slice(0, 30)}`;
    const list = groups.get(key) ?? [];
    list.push(tx);
    groups.set(key, list);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}
