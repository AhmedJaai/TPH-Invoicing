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

/**
 * اسمُ الشهرة داخل الاسم النظاميّ — دليلٌ قويّ لا تشابهٌ ضعيف.
 *
 * المستندات تحمل الاسم النظاميّ كاملاً: «مؤسسة أوراق الزيتون التجارية».
 * والمخزَّن اسمُ الشهرة: «أوراق الزيتون». والتشابهُ الحرفيّ بينهما
 * ‏٠٫٦٧ — دون حدّ الترجيح، فيُردّ الكشفُ بـ«لم يُعرف المورّد» وهو
 * مذكورٌ في صدر صفحته.
 *
 * وقِيس على كشف أوراق الزيتون الحقيقيّ فوقع فعلاً.
 *
 * ولا تُحذَف صيغُ الشركات بقائمةٍ ثابتة — «محمصة» في «المحمصة الغربية»
 * أصلُ الاسم لا زائدة، وحذفُها يُنشئ خلطاً. وإنّما يُسأل سؤالٌ أضيق:
 * **أكلماتُ المخزَّن كلُّها واردةٌ في المستخرَج بترتيبها؟** فإن كانت،
 * فالمستخرَج هو نفسه موسَّعاً — لا اسمٌ آخر يشبهه.
 *
 * ويُشترَط طولٌ معتبَر للمخزَّن (كلمتان فأكثر، أو كلمةٌ من خمسة أحرف)
 * كي لا يبتلع اسمٌ قصيرٌ كلَّ ما احتواه.
 */
function containsWords(haystack: string, needle: string): boolean {
  const a = haystack.split(/\s+/).filter(Boolean);
  const b = needle.split(/\s+/).filter(Boolean);
  if (b.length === 0) return false;
  if (b.length === 1 && b[0].length < 5) return false;
  if (b.length > a.length) return false;

  for (let i = 0; i + b.length <= a.length; i++) {
    if (b.every((w, j) => a[i + j] === w)) return true;
  }
  return false;
}

/**
 * الاسمُ بلا فراغاته — لأنّ الأهليّ يقصّ الكلمة بفراغ.
 *
 * كشفُ الأهليّ يلفّ السطر عند عرضٍ ثابت **داخل الكلمة**، فيخرج اسم
 * المستفيد مقطوعاً: «المحد ودة» و«التجا رية» و«والتغل يف» و«ال محدود»
 * و«TRA DING». وهي أسماءٌ صحيحة في الواقع، مكسورةٌ في التصدير.
 *
 * فكان الاسمُ البديل المكتوب صواباً لا يلتقي بنفسه: «شركة أنس غالب حمزة
 * خاشقجي التجارية المحدودة» مخزَّنةً، و«…المحد ودة» في الكشف — فلا
 * مطابقة. وقيس على كشف أحمد: **أحدَ عشر مستفيداً من تسعةَ عشر** لا
 * يُعرَفون، وفيهم من له اسمٌ بديل مكتوبٌ عندنا منذ التأسيس.
 *
 * والفراغُ يُسقَط كلُّه لا الفراغُ المشبوه وحده: لا سبيل إلى معرفة أيّ
 * فراغٍ أصليّ وأيّه مقحَم، وإسقاطُ الجميع يجعل السؤال «أهما الحروفُ
 * نفسها بترتيبها؟» — وهو سؤالٌ لا يلتبس في أسماء المنشآت.
 */
const squash = (v: string) => v.replace(/\s+/g, "");

/**
 * اسمُ الشهرة داخل الاسم النظاميّ — دليلٌ قويّ لا تشابهٌ ضعيف.
 *
 * المستندات تحمل الاسم النظاميّ كاملاً: «مؤسسة أوراق الزيتون التجارية».
 * والمخزَّن اسمُ الشهرة: «أوراق الزيتون». والتشابهُ الحرفيّ بينهما
 * ‏٠٫٦٧ — دون حدّ الترجيح، فيُردّ الكشفُ بـ«لم يُعرف المورّد» وهو
 * مذكورٌ في صدر صفحته.
 *
 * وقِيس على كشف أوراق الزيتون الحقيقيّ فوقع فعلاً.
 *
 * ولا تُحذَف صيغُ الشركات بقائمةٍ ثابتة — «محمصة» في «المحمصة الغربية»
 * أصلُ الاسم لا زائدة، وحذفُها يُنشئ خلطاً. وإنّما يُسأل سؤالٌ أضيق:
 * **أكلماتُ أحدهما كلُّها واردةٌ في الآخر بترتيبها؟**
 *
 * **والاحتواء في الجهتين.** كان يُسأل في جهةٍ واحدة — أيحوي المستخرَجُ
 * المخزَّن؟ — فعُرفت «مؤسسة أوراق الزيتون التجارية» ولم تُعرف «الكوب
 * الذهبي» وهي مخزَّنةٌ «مصنع الكوب الذهبي». والبنكُ يكتب أحياناً أقصرَ
 * ممّا عندنا وأحياناً أطول، والاحتواءُ دليلٌ في الحالين.
 *
 * ويُشترَط طولٌ معتبَر للأقصر (كلمتان فأكثر، أو كلمةٌ من خمسة أحرف)
 * كي لا يبتلع اسمٌ قصيرٌ كلَّ ما احتواه.
 */
function containsTradeName(extracted: string, stored: string): boolean {
  return containsWords(extracted, stored) || containsWords(stored, extracted);
}

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

  /*
    ثمّ الاسمُ بلا فراغاته — والفراغُ المقحَم عيبُ تصديرٍ لا اسمٌ آخر.
    ويُقارَن بالاسم وبالبدائل معاً، فبدائلُ البنك كُتبت صحيحةً وجاءت
    من الكشف مكسورة.
  */
  for (const name of names) {
    const flat = squash(name);
    const bySquash = suppliers.filter(
      (s) => squash(normalizeName(s.nameAr)) === flat
        || (s.nameEn ? squash(normalizeName(s.nameEn)) === flat : false)
        || s.aliases.some((a) => squash(a.normalized) === flat),
    );
    if (bySquash.length === 1) {
      return { supplier: bySquash[0], method: "ALIAS", confidence: 0.93, candidates: [] };
    }
  }

  /*
    الاحتواء يسبق التشابه: «مؤسسة أوراق الزيتون التجارية» تحوي
    «أوراق الزيتون» كلمةً كلمة، وذلك أقوى من درجةِ تشابهٍ حرفيّة.
  */
  for (const name of names) {
    const byContain = suppliers.filter(
      (s) => containsTradeName(name, normalizeName(s.nameAr))
        || (s.nameEn ? containsTradeName(name, normalizeName(s.nameEn)) : false)
        /* والبدائلُ كذلك — «مقام الثقة» بديلٌ مكتوب، والكشف «شركة مقام الثقة» */
        || s.aliases.some((a) => containsTradeName(name, a.normalized)),
    );
    /* واحدٌ لا غير — فإن احتواها اسمان لم يعد الاحتواء دليلاً */
    if (byContain.length === 1) {
      return { supplier: byContain[0], method: "NAME", confidence: 0.88, candidates: [] };
    }
    if (byContain.length > 1) {
      return { method: "NONE", confidence: 0.6, candidates: byContain.slice(0, 4) };
    }
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
