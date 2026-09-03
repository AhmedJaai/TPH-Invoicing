/**
 * سجل الموردين الابتدائي.
 *
 * المصدر: أسماء المجلدات الفعلية في الدرايف، والأسماء المختصرة المستخرجة من
 * أسماء الملفات، وبطاقة «_معلومات المورد.txt».
 *
 * هذا نقطة انطلاق لا مرجعاً نهائياً: الأرقام الضريبية وشروط السداد تُستكمل
 * من بطاقات الموردين في المرحلة الثالثة. والحقول المجهولة تُترك فارغة عمداً
 * بدل تخمينها — التخمين الصامت في البيانات المحاسبية أسوأ من الفراغ.
 */

export type SeedCategory =
  | "COFFEE" | "FOOD" | "PACKAGING" | "EQUIPMENT" | "WATER" | "UTILITIES" | "OTHER";

export interface SupplierSeed {
  slug: string;
  /** اسم المجلد في الدرايف حرفياً */
  driveFolderName: string;
  nameAr: string;
  nameEn?: string;
  category: SeedCategory;
  /** مورد لا يصدر فواتير ضريبية — يحتاج عقد توريد */
  issuesInvoices?: boolean;
  /** أسماء المستفيدين البنكية المعروفة، للمطابقة مع كشف البنك */
  bankAliases?: string[];
  notes?: string;
}

export const SUPPLIER_SEED: SupplierSeed[] = [
  { slug: "OliveLeaves", driveFolderName: "Olive Leaves", nameAr: "أوراق الزيتون", nameEn: "Olive Leaves", category: "FOOD" },
  {
    slug: "AVAL", driveFolderName: "AVAL (Badr)", nameAr: "أفال — بدر", nameEn: "AVAL", category: "COFFEE",
    bankAliases: ["شركة إيفال بي بي إس", "إيفال", "ايفال"],
    notes: "تظهر في البنك باسم «شركة إيفال بي بي إس»",
  },
  { slug: "Zacopack", driveFolderName: "Zacopack", nameAr: "زاكوباك", nameEn: "Zacopack", category: "PACKAGING" },
  { slug: "GoldenCup", driveFolderName: "Golden Cup Factory", nameAr: "مصنع الكوب الذهبي", nameEn: "Golden Cup Factory", category: "PACKAGING" },
  { slug: "WesternRoastery", driveFolderName: "Western Roastery", nameAr: "المحمصة الغربية", nameEn: "Western Roastery", category: "COFFEE" },
  { slug: "SardTrading", driveFolderName: "Sard Trading (سرد - معدات)", nameAr: "سرد للتجارة — معدات", nameEn: "Sard Trading", category: "EQUIPMENT" },
  { slug: "CoffeeLabs", driveFolderName: "Coffee Labs (مختبرات القهوة)", nameAr: "مختبرات القهوة", nameEn: "Coffee Labs", category: "COFFEE" },
  {
    slug: "BeCof", driveFolderName: "BeCof (بيكوف)", nameAr: "بيكوف", nameEn: "BeCof", category: "COFFEE",
    bankAliases: ["KHALID SAED BN MAHFUS TRADING", "خالد سعيد بن محفوظ", "محفوظ"],
    notes: "تظهر في البنك باسم «خالد سعيد بن محفوظ للتجارة»",
  },
  {
    slug: "Loreva", driveFolderName: "Loreva Cake", nameAr: "لوريفا كيك", nameEn: "Loreva Cake", category: "FOOD",
    bankAliases: ["MaqamAlThiqa", "مقام الثقة", "الثقة"],
    notes: "تظهر في البنك باسم «مقام الثقة»",
  },
  {
    slug: "Ganache", driveFolderName: "Ganache (AGK)", nameAr: "غاناش", nameEn: "Ganache AGK", category: "FOOD",
    bankAliases: ["Khashoggi", "شركة أنس غالب حمزة خاشقجي التجارية المحدودة", "خاشقجي"],
    notes: "تظهر في البنك باسم «شركة أنس غالب حمزة خاشقجي التجارية» — لا باسم غاناش",
  },
  { slug: "KohiRoastary", driveFolderName: "Kohi Roastary", nameAr: "كوهي روستري", nameEn: "Kohi Roastary", category: "COFFEE" },
  { slug: "Rawnah", driveFolderName: "Rawnah (رونة)", nameAr: "رونة", nameEn: "Rawnah", category: "FOOD" },
  { slug: "AtlasRoastery", driveFolderName: "Atlas Roastery (عمار بن صديق)", nameAr: "محمصة أطلس — عمار بن صديق", nameEn: "Atlas Roastery", category: "COFFEE" },
  { slug: "AwaniAlMaida", driveFolderName: "Awani Al-Maida (ملتقى الأواني)", nameAr: "ملتقى الأواني", nameEn: "Awani Al-Maida", category: "EQUIPMENT" },
  { slug: "LavaKombucha", driveFolderName: "Lava of Kombucha", nameAr: "لافا كمبوتشا", nameEn: "Lava of Kombucha", category: "FOOD" },
  {
    slug: "SardCo", driveFolderName: "Sard Co", nameAr: "سرد كو", nameEn: "Sard Co", category: "PACKAGING",
    bankAliases: ["شركة الصرد للتعبئة", "الصرد"],
  },
  { slug: "MoodCoffee", driveFolderName: "Mood Coffee (مود القهوة)", nameAr: "مود القهوة", nameEn: "Mood Coffee", category: "COFFEE" },
  {
    slug: "PURE-Oska", driveFolderName: "PURE - Oska Water", nameAr: "أوسكا — شركة المشروبات النقية", nameEn: "PURE Oska Water",
    category: "WATER", issuesInvoices: false,
    notes: "لا يصدر فواتير — يحتاج عقد توريد. مذكور في بطاقة المورد في الدرايف",
  },
  {
    slug: "WaterFilters", driveFolderName: "Water Filters (الرعاية المتناهية)", nameAr: "الرعاية المتناهية — فلاتر مياه",
    category: "WATER", issuesInvoices: false,
    notes: "غير مذكور في قائمة الأسماء المختصرة الأصلية — الاسم المختصر مقترح ويحتاج تأكيد المالك",
  },
  {
    slug: "Mariah", driveFolderName: "Mariah (براونيز)", nameAr: "مريم — براونيز",
    category: "FOOD", issuesInvoices: false,
    notes: "غير مذكور في قائمة الأسماء المختصرة الأصلية — الاسم المختصر مقترح ويحتاج تأكيد المالك",
  },
  {
    slug: "HungryMan", driveFolderName: "Hungry Man Bakery", nameAr: "هنقري مان بيكري", nameEn: "Hungry Man Bakery", category: "FOOD",
  },
  {
    slug: "HungryManBakery", driveFolderName: "Hungry Man Bakery ", nameAr: "هنقري مان بيكري (صيغة ثانية)",
    nameEn: "Hungry Man Bakery", category: "FOOD",
    notes: "صيغة اسم ثانية ظهرت في الأرشيف — تُدمج مع HungryMan عند التوحيد",
  },
  {
    slug: "Ganache-AGK", driveFolderName: "Ganache (AGK) ", nameAr: "غاناش (صيغة ثانية)", nameEn: "Ganache AGK",
    category: "FOOD",
    notes: "صيغة اسم ثانية في كشوف مايو — تُدمج مع Ganache عند التوحيد",
  },
  {
    slug: "SabeaJar", driveFolderName: "Sales - Sabea Jar (فاتورة صادرة)", nameAr: "سبعة جرة — عميل",
    nameEn: "Sabea Jar", category: "OTHER",
    notes: "عميل لا مورّد — فواتيرنا الصادرة إليه. لا تدخل المشتريات",
  },
];

/** الأسماء المختصرة المعروفة — يعتمد عليها مفكّك أسماء الملفات لفصل المستفيد عن المورد. */
export const KNOWN_SLUGS: readonly string[] = SUPPLIER_SEED.map((s) => s.slug);

/** يطبّع نصاً لمطابقة الأسماء: حروف صغيرة، بلا تشكيل، بلا رموز. */
export function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, "") // التشكيل
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
