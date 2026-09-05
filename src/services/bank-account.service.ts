/**
 * الحساب البنكيّ ككيان داخليّ، لا كنصٍّ في ترويسة ملفّ.
 *
 * كان `bank_imports.account_number` سلسلةَ حروفٍ تُقرأ من الملفّ وتُحفَظ
 * كما وردت — لا رصيدَ لها ولا عملة ولا فرع، ولا تُقارَن بحسابٍ آخر.
 * فلا يمكن أن يقال «كشف أغسطس لحساب الراجحي مغطّى وحساب الأهلي ناقص»،
 * ولا أن تُمنع حركتان متطابقتان في حسابين من أن تبتلع إحداهما الأخرى.
 *
 * وهنا يُترجَم النصّ إلى هويّة: يُوحَّد الرقم، ويُبحَث عنه، ويُنشأ إن
 * لم يوجد. والمجهول يبقى مجهولاً — لا يُخترَع له حساب.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bankAccounts } from "@/db/schema";
import { createId } from "@/lib/id";

/** أقلّ عددٍ من الخانات يصلح لتمييز حساب. */
export const MIN_ACCOUNT_DIGITS = 4;

/**
 * يوحّد رقم الحساب: الفراغات والشرَط والأقواس عرضٌ لا معنى.
 * والنجوم في الأرقام المحجوبة تُحذف — ثمّ يُحكَم على ما بقي.
 */
export function normalizeAccountNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  const digits = cleaned.replace(/[^0-9]/g, "");
  if (digits.length < MIN_ACCOUNT_DIGITS) return null;
  return cleaned;
}

export interface ResolveAccountInput {
  accountNumber: string | null | undefined;
  bankName: string | null | undefined;
  iban?: string | null;
}

/**
 * يعطي الحساب الداخليّ لهذا الكشف، منشئاً إيّاه عند أوّل ظهور.
 *
 * ولا يُرجع شيئاً حين لا يحمل الملفّ رقماً صالحاً: كشفٌ بلا رقم حساب
 * أمرٌ واقع، واختراعُ حسابٍ له يخلط كشوف حسابات لا يجمعها شيء.
 */
export async function resolveBankAccount(input: ResolveAccountInput): Promise<string | null> {
  const normalized = normalizeAccountNumber(input.accountNumber);
  if (!normalized) return null;

  const [existing] = await db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(eq(bankAccounts.accountNumber, normalized))
    .limit(1);
  if (existing) return existing.id;

  const bankName = input.bankName?.trim() || "بنك غير معروف";
  const id = createId();

  const [created] = await db
    .insert(bankAccounts)
    .values({
      id,
      bankName,
      /*
        الاسم المعروض يبدأ من آخر أربع خانات — هو ما يميّزه في عين
        صاحبه — ويُعدَّل بيده بعدها.
      */
      label: `${bankName} ····${normalized.slice(-4)}`,
      accountNumber: normalized,
      iban: input.iban?.replace(/\s+/g, "").toUpperCase() || null,
    })
    .onConflictDoNothing()
    .returning({ id: bankAccounts.id });

  if (created) return created.id;

  /* سبقنا إليه طلبٌ متزامن — نقرأ ما كتبه */
  const [raced] = await db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(eq(bankAccounts.accountNumber, normalized))
    .limit(1);
  return raced?.id ?? null;
}
