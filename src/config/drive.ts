/**
 * إعدادات الدرايف — المعرّفات تأتي من متغيرات البيئة ولا تُكتب داخل الكود.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`متغير البيئة ${name} غير مضبوط. راجع .env.example`);
  return value;
}

export const driveConfig = {
  get accountsFolderId() { return required("DRIVE_ACCOUNTS_FOLDER_ID"); },
  get yearFolderIds(): Record<string, string> {
    return {
      "2026": required("DRIVE_YEAR_2026_FOLDER_ID"),
      "2027": required("DRIVE_YEAR_2027_FOLDER_ID"),
    };
  },
};

/** المجلدات الخدمية داخل كل شهر — أسماؤها حرفية كما في الدرايف. */
export const SERVICE_FOLDERS = {
  RECEIPTS: "_إيصالات السداد",
  CASH: "_نقدي - Cash receipts",
  UTILITIES: "_مرافق وحكومي - Utilities & Gov",
  OTHER: "_أخرى - Other suppliers",
} as const;

export const SERVICE_FOLDER_NAMES: string[] = Object.values(SERVICE_FOLDERS);

/** بطاقة المورد التي تُنشأ مسبقاً في كل مجلد — ليست مستنداً محاسبياً. */
export const SUPPLIER_INFO_CARD = "_معلومات المورد.txt";

export const companyConfig = {
  get nameAr() { return process.env.COMPANY_NAME_AR ?? "مؤسسة ذا بوبليك هاوس"; },
  get vatNumber() { return required("COMPANY_VAT_NUMBER"); },
  get crNumber() { return process.env.COMPANY_CR_NUMBER ?? ""; },
};

/** حد رسملة الأصل الثابت: ٣٬٠٠٠ ريال. */
export const FIXED_ASSET_THRESHOLD_MINOR = 300_000;

/** نسبة ضريبة القيمة المضافة في السعودية. */
export const VAT_RATE = 0.15;
