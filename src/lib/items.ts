/**
 * تطبيع أسماء الأصناف.
 *
 * المورّد يكتب الصنف نفسه بصيغ مختلفة بين فاتورة وأخرى: «حليب طازج ٢ لتر»
 * و«حليب طازج 2ل» و«Fresh Milk 2L». وبلا توحيدها لا يوجد تتبّع سعر ولا
 * تحليل استهلاك — تصير كل صيغة صنفاً مستقلاً.
 *
 * التطبيع محافظ عمداً: يوحّد الشكل ولا يحذف معنى. «حليب كامل الدسم» و«حليب
 * خالي الدسم» يبقيان صنفين مختلفين، لأنّ دمجهما يفسد تحليل الاستهلاك.
 */

/** وحدات القياس الشائعة في فواتير المقهى وصيغها المختلفة. */
const UNIT_FORMS: Record<string, string> = {
  كجم: "kg", كيلو: "kg", كيلوجرام: "kg", كغم: "kg", kg: "kg", kilo: "kg",
  جم: "g", جرام: "g", غرام: "g", g: "g", gm: "g",
  لتر: "l", ل: "l", liter: "l", litre: "l", l: "l", ltr: "l",
  مل: "ml", ml: "ml",
  حبة: "pc", حبه: "pc", قطعة: "pc", قطعه: "pc", pc: "pc", pcs: "pc", piece: "pc",
  كرتون: "ctn", كرتونة: "ctn", كرتونه: "ctn", ctn: "ctn", carton: "ctn", box: "ctn", علبة: "ctn", علبه: "ctn",
  كيس: "bag", bag: "bag",
  عبوة: "pack", عبوه: "pack", pack: "pack", pkt: "pack",
};

/** يحوّل الأرقام العربية الهندية إلى لاتينية. */
function latinDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * يطبّع وصف الصنف: حروف صغيرة، بلا تشكيل، همزات موحّدة، أرقام لاتينية،
 * وحدات موحّدة، ورموز محذوفة.
 */
export function normalizeItem(description: string): string {
  const base = latinDigits(description)
    .toLowerCase()
    /*
      الفاصلة العشرية العربية «٫» تُحوَّل قبل الحذف، وفاصل الآلاف «٬» يُسقَط —
      كان نطاق التشكيل يشملهما فيصير «١٫٥ لتر» «15 l».
    */
    .replace(/(\d)[\u066B.,](\d)/g, "$1.$2")
    .replace(/\u066C/g, "")
    .replace(/[\u064B-\u065F\u0670]/g, "") // التشكيل — لا الأرقام ولا الفواصل
    .replace(/ـ/g, "") // التطويل
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    /* النقطة تبقى بين رقمين وحدهما: «1.5» عددٌ واحد لا «1 5» */
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .trim();

  // يفصل الرقم عن الوحدة الملتصقة به: "2l" ← "2 l"
  const spaced = base.replace(/(\d)\s*([\p{L}]+)/gu, "$1 $2");

  const words = spaced.split(/\s+/).filter(Boolean).map((w) => UNIT_FORMS[w] ?? w);
  return words.join(" ");
}

/** مفتاح تتبّع السعر: الصنف عند مورّد بعينه. السعر يُقارَن داخل المورّد لا عبره. */
export function priceKey(supplierId: string, description: string): string {
  return `${supplierId}::${normalizeItem(description)}`;
}

export interface PricePoint {
  date: Date;
  unitPriceMinor: number;
  invoiceNumber?: string | null;
}

export interface PriceChange {
  /** آخر سعر مسجّل */
  currentMinor: number;
  /** السعر السابق له */
  previousMinor: number;
  deltaMinor: number;
  /** نسبة التغيّر: 0.15 تعني ارتفاعاً بخمسة عشر بالمئة — و`null` إن كان السابق صفراً */
  deltaRatio: number | null;
  direction: "up" | "down";
  currentDate: Date;
  previousDate: Date;
}

/**
 * يقارن آخر سعرين مختلفين فعلاً.
 *
 * تجاهل التكرارات مقصود: عشر فواتير بالسعر نفسه ثم ارتفاع يجب أن تُظهر
 * الارتفاع، لا أن تقارن آخر فاتورتين متطابقتين وتقول «لا تغيير».
 */
export function detectPriceChange(history: readonly PricePoint[]): PriceChange | null {
  if (history.length < 2) return null;

  const sorted = [...history].sort((a, b) => b.date.getTime() - a.date.getTime());
  const current = sorted[0];

  const previous = sorted.slice(1).find((p) => p.unitPriceMinor !== current.unitPriceMinor);
  if (!previous) return null;

  const deltaMinor = current.unitPriceMinor - previous.unitPriceMinor;
  return {
    currentMinor: current.unitPriceMinor,
    previousMinor: previous.unitPriceMinor,
    deltaMinor,
    /* النسبة من صفرٍ مجهولةٌ لا صفر — والصفر كان يُعرض «لا تغيير» */
    deltaRatio: previous.unitPriceMinor === 0 ? null : deltaMinor / previous.unitPriceMinor,
    direction: deltaMinor > 0 ? "up" : "down",
    currentDate: current.date,
    previousDate: previous.date,
  };
}

/** الأثر السنوي المقدَّر لتغيّر السعر، بناءً على الكمية المشتراة فعلاً. */
export function annualImpactMinor(change: PriceChange, quantityPerYear: number): number {
  return Math.round(change.deltaMinor * quantityPerYear);
}

/**
 * أقربُ أصناف المورّد نفسه إلى صنفٍ — لتقديمها في «هو نفسه…» لا لدمجها.
 *
 * الاسمُ ليس هويّة: هذا ترتيبٌ يقدّم المحتمل، والدمجُ يُقرّه إنسان. «عنب» داخل
 * «كولومبي عنب» كلمةً، و«كولومي» من «كولومبي» حرفاً — والأرقامُ إن اختلفت فصنفان
 * («كيس ١ كيلو» و«كيس ٢ كيلو»)، فلا يُقترح.
 */
export function similarItems(target: string, others: readonly string[]): string[] {
  const digits = (s: string) => (s.match(/\d+/g) ?? []).join(",");
  /* الكلمةُ القصيرة («بن»، «مل») تجمع ما لا يجتمع — فلا يُعتدّ إلّا بما يميّز */
  const words = (s: string) => s.split(" ").filter((w) => w.length >= 3);
  const near = (a: string, b: string) => a.length >= 4 && b.length >= 4 && editDistance(a, b) <= Math.max(1, Math.floor(Math.min(a.length, b.length) / 6));
  const score = (o: string): { s: number; shared: number } => {
    if (o === target || digits(o) !== digits(target)) return { s: 0, shared: 0 };
    const tw = words(target), ow = words(o);
    let shared = 0;
    for (const w of tw) if (ow.some((x) => x === w || near(x, w))) shared++;
    /* على الأقصر: «عنب» كلُّه في «كولومبي عنب» */
    return { s: tw.length === 0 || ow.length === 0 ? 0 : shared / Math.min(tw.length, ow.length), shared };
  };
  return others
    .map((o) => ({ o, ...score(o) }))
    .filter((x) => x.s >= 1)
    .sort((a, b) => b.s - a.s || b.shared - a.shared)
    .map((x) => x.o);
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}
