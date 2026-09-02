/**
 * مطابقة المورد.
 *
 * الترتيب مقصود: الرقم الضريبي أولاً لأنه المعرّف الوحيد الذي لا يلتبس،
 * ثم الأسماء البديلة، ثم الاسم المطبَّع، ثم الاقتراح بالتشابه.
 * ولا نطابق تلقائياً على تشابه ضعيف — نعرض اقتراحات ويقرر الإنسان.
 */
import { normalizeName } from "./suppliers-seed";

export interface SupplierRecord {
  id: string;
  slug: string;
  nameAr: string;
  nameEn?: string | null;
  driveFolderName: string;
  vatNumber?: string | null;
  issuesInvoices: boolean;
  contractOnFile: boolean;
  aliases: { normalized: string }[];
}

export type MatchMethod = "VAT" | "ALIAS" | "NAME" | "FUZZY" | "NONE";

export interface SupplierMatch {
  supplier?: SupplierRecord;
  method: MatchMethod;
  confidence: number;
  /** مرشّحون للعرض حين لا تكون المطابقة قاطعة */
  candidates: SupplierRecord[];
}

/** مسافة تشابه بسيطة بين نصّين مطبَّعين، من ٠ إلى ١. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  // نسبة الاحتواء وحدها تعاقب الاسم الطويل لطوله: «سرد» داخل «سرد للتجارة»
  // تعطي 0.27 فقط. لذلك نأخذ الأعلى بينها وبين تقاطع الكلمات.
  const containment = longer.includes(shorter) ? shorter.length / longer.length : 0;

  const tokensA = new Set(a.split(" ").filter(Boolean));
  const tokensB = new Set(b.split(" ").filter(Boolean));
  let overlap = 0;
  if (tokensA.size > 0 && tokensB.size > 0) {
    let shared = 0;
    for (const t of tokensA) if (tokensB.has(t)) shared++;
    overlap = (2 * shared) / (tokensA.size + tokensB.size);
  }

  return Math.max(containment, overlap);
}

const digitsOnly = (v?: string | null) => (v ?? "").replace(/\D/g, "");

export function matchSupplier(
  suppliers: readonly SupplierRecord[],
  extracted: { sellerVatNumber?: string; supplierNameAr?: string; supplierNameEn?: string },
): SupplierMatch {
  const vat = digitsOnly(extracted.sellerVatNumber);
  if (vat.length === 15) {
    const byVat = suppliers.find((s) => digitsOnly(s.vatNumber) === vat);
    if (byVat) return { supplier: byVat, method: "VAT", confidence: 1, candidates: [] };
  }

  const names = [extracted.supplierNameAr, extracted.supplierNameEn]
    .filter((n): n is string => Boolean(n?.trim()))
    .map(normalizeName);

  if (names.length === 0) return { method: "NONE", confidence: 0, candidates: [] };

  for (const name of names) {
    const byAlias = suppliers.find((s) => s.aliases.some((a) => a.normalized === name));
    if (byAlias) return { supplier: byAlias, method: "ALIAS", confidence: 0.95, candidates: [] };
  }

  for (const name of names) {
    const byName = suppliers.find(
      (s) => normalizeName(s.nameAr) === name || (s.nameEn && normalizeName(s.nameEn) === name),
    );
    if (byName) return { supplier: byName, method: "NAME", confidence: 0.9, candidates: [] };
  }

  const scored = suppliers
    .map((s) => {
      const best = Math.max(
        ...names.flatMap((n) => [
          similarity(n, normalizeName(s.nameAr)),
          s.nameEn ? similarity(n, normalizeName(s.nameEn)) : 0,
          ...s.aliases.map((a) => similarity(n, a.normalized)),
        ]),
      );
      return { supplier: s, score: best };
    })
    .filter((x) => x.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  if (scored.length === 0) return { method: "NONE", confidence: 0, candidates: [] };

  // تشابه عالٍ جداً وبفارق واضح عن التالي ← نرجّحه، وما دونه اقتراح للمراجعة.
  const clear = scored[0].score >= 0.85 && (scored.length === 1 || scored[0].score - scored[1].score >= 0.2);
  return {
    supplier: clear ? scored[0].supplier : undefined,
    method: clear ? "FUZZY" : "NONE",
    confidence: scored[0].score,
    candidates: scored.map((x) => x.supplier),
  };
}
