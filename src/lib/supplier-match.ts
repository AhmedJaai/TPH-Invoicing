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
  /**
   * الاسمُ يطابق والرقمُ الضريبيّ المقروء يخالف المخزَّن — منشأتان باسمٍ متقارب
   * ورقمين مختلفين كيانان. فلا يُحسَم: المورّدُ في `candidates` ويقرّر إنسان.
   */
  vatConflict?: boolean;
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

/**
 * تشابهُ ثلاثيّات الحروف (Dice) — **للاقتراح وحده**.
 *
 * `similarity` تعرف الاحتواء وتقاطع الكلمات؛ فخطأُ حرفٍ في القراءة يُسقط
 * المرشّح كلَّه: «غاناش» و«غناش»، «Lorefa» و«Loreva» بلا كلمةٍ مشتركة = صفر،
 * فلا يظهر المورّدُ حتّى اقتراحاً ويُنشأ ثانٍ. وهذه لا تحسم شيئاً — الحسمُ
 * بـ`similarity` وحدها.
 */
export function trigramSimilarity(a: string, b: string): number {
  const grams = (v: string) => {
    const padded = `  ${v.replace(/\s+/g, " ").trim()} `;
    const out = new Set<string>();
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
    return out;
  };
  if (!a.trim() || !b.trim()) return 0;
  const x = grams(a);
  const y = grams(b);
  let shared = 0;
  for (const g of x) if (y.has(g)) shared++;
  return (2 * shared) / (x.size + y.size);
}

const digitsOnly = (v?: string | null) => (v ?? "").replace(/\D/g, "");

/** أكلماتُ `needle` كلُّها واردةٌ في `haystack` بترتيبها؟ — الشرحُ فوق `containsTradeName`. */
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

  /*
    ما بعد الرقم الضريبيّ مطابقةٌ بالاسم — ولا يُحسَم بها مورّدٌ رقمُه المخزَّن
    يخالف المقروء (كلاهما ١٥ خانة): تُخفَّض إلى اقتراح ويُقال لماذا.
  */
  const settle = (supplier: SupplierRecord, method: MatchMethod, confidence: number): SupplierMatch => {
    const stored = digitsOnly(supplier.vatNumber);
    if (vat.length === 15 && stored.length === 15 && stored !== vat) {
      return { method: "NONE", confidence: Math.min(confidence, 0.6), candidates: [supplier], vatConflict: true };
    }
    return { supplier, method, confidence, candidates: [] };
  };

  const names = [extracted.supplierNameAr, extracted.supplierNameEn]
    .filter((n): n is string => Boolean(n?.trim()))
    .map(normalizeName);

  if (names.length === 0) return { method: "NONE", confidence: 0, candidates: [] };

  for (const name of names) {
    /*
      واحدٌ لا غير: فرادةُ البديل في القاعدة لكلّ مورّدٍ لا عبرهم، فإن حمله
      مورّدان كان `find` يحسم لأوّلهما ترتيباً بثقة ٠٫٩٥ — وبقيّةُ الدالّة
      تشترط الواحد.
    */
    const byAlias = suppliers.filter((s) => s.aliases.some((a) => a.normalized === name));
    if (byAlias.length === 1) return settle(byAlias[0], "ALIAS", 0.95);
    if (byAlias.length > 1) return { method: "NONE", confidence: 0.6, candidates: byAlias.slice(0, 4) };
  }

  for (const name of names) {
    const byName = suppliers.find(
      (s) => normalizeName(s.nameAr) === name || (s.nameEn && normalizeName(s.nameEn) === name),
    );
    if (byName) return settle(byName, "NAME", 0.9);
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
      return settle(bySquash[0], "ALIAS", 0.93);
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
      return settle(byContain[0], "NAME", 0.88);
    }
    if (byContain.length > 1) {
      return { method: "NONE", confidence: 0.6, candidates: byContain.slice(0, 4) };
    }
  }

  const scored = suppliers
    .map((s) => {
      const stored = [normalizeName(s.nameAr), ...(s.nameEn ? [normalizeName(s.nameEn)] : []), ...s.aliases.map((a) => a.normalized)];
      const score = Math.max(...names.flatMap((n) => stored.map((v) => similarity(n, v))));
      /* خطأُ حرفٍ في القراءة: يُظهر المرشّحَ ولا يحسمه */
      const loose = Math.max(score, ...names.flatMap((n) => stored.map((v) => trigramSimilarity(n, v))));
      return { supplier: s, score, loose };
    })
    .filter((x) => x.loose >= 0.45)
    .sort((a, b) => b.loose - a.loose)
    .slice(0, 4);

  if (scored.length === 0) return { method: "NONE", confidence: 0, candidates: [] };

  // تشابه عالٍ جداً وبفارق واضح عن التالي ← نرجّحه، وما دونه اقتراح للمراجعة.
  const clear = scored[0].score >= 0.85 && (scored.length === 1 || scored[0].score - scored[1].loose >= 0.2);
  if (clear) {
    const settled = settle(scored[0].supplier, "FUZZY", scored[0].score);
    if (settled.supplier) return { ...settled, candidates: scored.map((x) => x.supplier) };
    return settled;
  }
  return {
    method: "NONE",
    confidence: scored[0].loose,
    candidates: scored.map((x) => x.supplier),
  };
}

/**
 * أهذا الاسمُ مورّدٌ مسجَّل، أم يشبه مسجَّلين؟ — دالّةٌ خالصة يُختبَر بها القرار.
 *
 * التطابقُ بالاسم المطبَّع أو ببديلٍ «هو نفسه». وما دونه (احتواءٌ، تشابهٌ،
 * خطأُ حرف) **سؤالٌ لا حسم**: «سرد كو» أُنشئ وعندنا «سرد للتجارة»، ولم يكشفه
 * إلّا `db:split-check` بعد أن انقسمت الفواتيرُ والدفعات بينهما.
 */
export function resolveNewSupplierName(
  list: readonly SupplierRecord[],
  input: { nameAr: string; nameEn?: string },
): { same: SupplierRecord } | { similar: SupplierRecord[] } {
  const names = [input.nameAr, input.nameEn].filter((n): n is string => Boolean(n?.trim())).map(normalizeName);
  const same = list.find((s) =>
    names.some((n) =>
      normalizeName(s.nameAr) === n
      || normalizeName(s.driveFolderName) === n
      || (s.nameEn ? normalizeName(s.nameEn) === n : false)));
  if (same) return { same };
  const m = matchSupplier(list, { supplierNameAr: input.nameAr, supplierNameEn: input.nameEn });
  /* بديلٌ مكتوبٌ بنصّه لمورّدٍ واحد: هو اسمُه الآخر */
  if (m.supplier && m.method === "ALIAS" && m.confidence >= 0.95) return { same: m.supplier };
  const similar = [...(m.supplier ? [m.supplier] : []), ...m.candidates.filter((c) => c.id !== m.supplier?.id)];
  return { similar: similar.slice(0, 4) };
}
