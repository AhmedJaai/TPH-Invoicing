/**
 * مطابقة حركات البنك بالفواتير.
 *
 * الحقيقة التي تحكم التصميم: اسم المستفيد في البنك يخالف اسم المورّد غالباً.
 * «شركة أنس غالب حمزة خاشقجي» هي غاناش، و«شركة إيفال بي بي إس» هي أفال.
 * لذلك المطابقة تمرّ على الأسماء البديلة، وتتعلّم كل اسم جديد بعد إقراره.
 */
import { normalizeName } from "@/lib/suppliers-seed";
import { findRule, type BankRule, type TxCategory } from "./rules";

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
  /** صنّفها المالك بقاعدة: راتب أو إيجار أو زكاة… فلا تُطابَق بفاتورة */
  | "CLASSIFIED"
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
  category: TxCategory;
  /** القاعدة التي صنّفتها، إن وُجدت */
  ruleId?: string;
}

/** حركات لا علاقة لها بالمورّدين — نستبعدها قبل المطابقة لتصفو النتيجة. */
const INTERNAL_PATTERNS = [
  "نقاط بيع", "دفع الكتروني", "رسوم", "ضريبة عملية", "الرسوم الشهرية",
  "إيداع مبالغ نقاط البيع", "رسوم تحويل",
  /*
   * سطر تسوية شبكة البطاقات: «REFERENCE : 81140155 VS26 0812 000000».
   * مئات منها بمبالغ بالهللات، وليست مدفوعات لأحد. وتركها «مجهولة» يجعل
   * صاحب العمل يرى ثمانمئة سطر تنتظر قراره وهي لا تنتظره.
   */
  "REFERENCE :",
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
  // أدوات ربط وكلمات مصرفية ثابتة — ترد في كل حركة فلا تميّز أحداً
  "الي", "علي", "من", "عن", "لدي", "لصالح", "المستفيد", "مستفيد",
  "حساب", "بنك", "مصرف", "البنك", "فرع", "صادر", "وارد", "قيد",
  /*
   * ركام كشف الأهلي. «الأهلي» اسم البنك نفسه، يرد في كل سطر سداد
   * («هاتف الأهلي مرجع سداد…») — ولمّا التقطه مولّد الأسماء البديلة وحفظه
   * جزءاً من اسم مورّد، صارت كل حوالة في الكشف تُنسب إلى ذلك المورّد.
   */
  "الاهلي", "اهلي", "snb", "الراجحي", "راجحي", "rajhi", "sadad", "مرجع",
  "السداد", "هاتف", "رقم", "فاتوره", "صادره", "وارده", "بطاقه", "مدى", "mada",
  "atm", "pos", "bill", "payment", "channel", "digital", "city",
  // ركام وصف الراتب: «BV:Monthly Salary» — ليست من اسم أحد
  "monthly", "salary", "ben", "bv",
]);

/** الكلمات المميِّزة في اسم: ما ليس شائعاً وطوله ثلاثة أحرف فأكثر. */
export function distinctiveTokens(normalized: string): string[] {
  return normalized.split(" ").filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * هل ترد الكلمة في الوصف كلمةً مستقلّة؟
 *
 * الاحتواء في وسط كلمة أخرى يخدع: «jar» من «Sabea Jar» يقع داخل «EJAR»
 * — وهي منصّة الإيجار لا اسم العميل — فنُسب سداد الإيجار إلى «سبعة جرة».
 *
 * ونتسامح في لصق الأرقام وحده، لأنّ كشف البنك يلصقها بالكلمة بلا فاصل:
 * «السداد20904553589». فالكلمة تطابق ما يبدأ بها ثمّ أرقامٌ لا غير.
 */
function tokenAppears(token: string, haystackTokens: ReadonlySet<string>): boolean {
  if (haystackTokens.has(token)) return true;
  for (const h of haystackTokens) {
    if (h.length > token.length && h.startsWith(token) && /^\d+$/.test(h.slice(token.length))) {
      return true;
    }
  }
  return false;
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

      const matched = tokens.filter((t) => tokenAppears(t, haystackTokens));
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
  /** قواعد صنّفها المالك — تُقدَّم على التخمين لأنّها إقراره هو */
  rules: readonly BankRule[] = [],
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
      results.push({
        tx, kind: "INTERNAL", invoices: [], confidence: 1,
        category: "INTERNAL", note: "حركة تشغيلية لا سداد مورّد",
      });
      continue;
    }

    const text = `${tx.description} ${tx.transactionType}`;
    const rule = findRule(text, rules);

    /*
     * قاعدة المالك تسبق كل تخمين. فحوالة الإيجار إلى «سابع جار» تبدو
     * سداد مورّد، وتحويله إلى نفسه يبدو مستفيداً — ولا يُصحّح ذلك إلا هو.
     */
    if (rule && rule.category !== "SUPPLIER") {
      results.push({
        tx, kind: "CLASSIFIED", invoices: [], confidence: 1,
        category: rule.category, ruleId: rule.id,
        note: "صنّفتَها بقاعدة سابقة",
      });
      continue;
    }

    const supplier =
      (rule?.supplierId
        ? aliasIndex.find((a) => a.supplierId === rule.supplierId)
        : undefined) ?? findSupplierInText(text, aliasIndex);

    if (!supplier) {
      results.push({ tx, kind: "NONE", invoices: [], confidence: 0, category: "UNKNOWN" });
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
        category: "SUPPLIER",
        ruleId: rule?.id,
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
      category: "SUPPLIER",
      ruleId: rule?.id,
      note: "عُرف المورّد ولم تُطابَق فاتورة بعينها",
    });
  }

  return results;
}

/**
 * دفعتان لنفس الجهة بنفس المبلغ في نفس اليوم — نمط الدفع المكرر.
 *
 * تُستثنى الحركات المصنَّفة غير مورّدين: فاتورتا كهرباء لعدّادين في يوم
 * واحد ليستا دفعةً مكرّرة، والتنبيه عليهما يُفقد التنبيه معناه.
 */
export function findDuplicatePayments(
  transactions: readonly BankTx[],
  rules: readonly BankRule[] = [],
): BankTx[][] {
  const groups = new Map<string, BankTx[]>();
  for (const tx of transactions) {
    if (tx.direction !== "DEBIT" || isInternalNoise(tx)) continue;
    const rule = findRule(`${tx.description} ${tx.transactionType}`, rules);
    if (rule && rule.category !== "SUPPLIER") continue;
    const key = `${tx.valueDate.toISOString().slice(0, 10)}|${tx.amountMinor}|${normalizeName(tx.description).slice(0, 30)}`;
    const list = groups.get(key) ?? [];
    list.push(tx);
    groups.set(key, list);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/**
 * يقترح اسماً بديلاً من وصف حركة بنكية.
 *
 * وصف البنك يخلط اسم المستفيد بضجيج ثابت: «تحويل»، «شركة»، «التجارية»،
 * وأرقام مرجعية. والاسم البديل النافع هو ما تفرّد به المستفيد وحده.
 * فنُسقط الشائع والأرقام ونُبقي أوّل ما بقي — والمستخدم يصحّحه إن شاء،
 * لأنّ اقتراحاً يُعدَّل خير من حقل فارغ يُملأ من الصفر.
 */
export function suggestAlias(description: string, maxWords = 4): string {
  const tokens = normalizeName(description)
    .split(" ")
    .filter(
      (t) =>
        t.length >= 3 &&
        !STOPWORDS.has(t) &&
        // الأرقام وما لُصقت به ليست من اسم أحد: «مرجع100344323»
        !/\d/.test(t),
    );

  if (tokens.length <= maxWords) return tokens.join(" ");

  /*
   * الاقتصار على أوّل الكلمات يقطع الاسم في غير موضعه: «شركة أنس غالب حمزة
   * خاشقجي» تميّزها كلمتها الأخيرة لا أولاها. فنُبقي أطول الكلمات — والطول
   * دليل معقول على التفرّد في الأسماء العربية — ثم نعيدها إلى ترتيبها الأصلي
   * كي تُقرأ اسماً لا كلمات مبعثرة.
   */
  const keep = new Set(
    tokens
      .map((t, i) => ({ t, i }))
      .sort((a, b) => b.t.length - a.t.length || a.i - b.i)
      .slice(0, maxWords)
      .map((x) => x.i),
  );

  return tokens.filter((_, i) => keep.has(i)).join(" ");
}
