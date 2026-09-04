/**
 * هوية الحركة البنكية.
 *
 * البنك لا يعطي معرّفاً ثابتاً لكل حركة، فنبنيه من محتواها. وبدونه كان
 * استيراد الكشف نفسه مرّتين يضاعف حركاته — ووجدنا في القاعدة الحقيقية
 * كشفاً استُورد ثلاث مرّات، فصارت كل حركة ثلاثاً وصار كل تقرير مبنيّ
 * عليها مضاعفاً ثلاث مرّات.
 *
 * وترتيب التكرار داخل المجموعة جزء من الهوية عمداً: الكشف الواحد قد يحمل
 * حركتين متطابقتين تماماً في اليوم — رسمَين، أو فاتورتَي كهرباء لعدّادين —
 * وهما حقيقيتان. فلو أُهمل الترتيب لابتلعت البصمة إحداهما. ومعه: الملف
 * نفسه يعطي البصمات نفسها فلا يتكرّر، والحركتان الحقيقيتان تبقيان اثنتين.
 */
import { createHash } from "node:crypto";

export interface TransactionIdentityInput {
  accountNumber?: string | null;
  /** التاريخ بصيغة YYYY-MM-DD */
  valueDate: string;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  description?: string | null;
  /** ترتيب هذه الحركة بين الحركات المطابقة لها في الملف نفسه، من صفر */
  occurrence: number;
}

export function transactionIdentity(input: TransactionIdentityInput): string {
  const parts = [
    input.accountNumber ?? "",
    input.valueDate,
    String(input.amountMinor),
    input.direction,
    input.description ?? "",
    String(input.occurrence),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export interface RowForIdentity {
  valueDate: Date;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  description?: string | null;
}

/**
 * يعطي كل صفّ هويته، محتسباً ترتيب تكراره داخل الملف.
 * الترتيب يُحسب على الصفوف كما وردت، فيثبت ما دام الملف نفسه.
 */
export function assignIdentities<T extends RowForIdentity>(
  rows: readonly T[],
  accountNumber?: string | null,
): (T & { externalId: string })[] {
  const seen = new Map<string, number>();

  return rows.map((row) => {
    const valueDate = row.valueDate.toISOString().slice(0, 10);
    const key = [valueDate, row.amountMinor, row.direction, row.description ?? ""].join("|");
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);

    return {
      ...row,
      externalId: transactionIdentity({
        accountNumber,
        valueDate,
        amountMinor: row.amountMinor,
        direction: row.direction,
        description: row.description,
        occurrence,
      }),
    };
  });
}

/** بصمة الملف كاملاً — استيراده ثانيةً يُعرف بها قبل قراءة صفوفه. */
export function fileFingerprint(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
