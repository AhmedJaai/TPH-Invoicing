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
 *
 * ولا تدخل البصمةَ خصائصُ **الملف**، بل خصائص **الحركة** وحدها.
 * كان رقم الحساب جزءاً منها، فاستُورد كشفان لنفس الحساب من مصدرين:
 * أحدهما يحمل رقم الحساب في ترويسته والآخر لا يحمله. فاختلفت البصمتان
 * لحركة واحدة بعينها — نفس التاريخ ونفس المبلغ ونفس الوصف حرفاً بحرف —
 * ودخلت مرّتين. ألفٌ وأربعمئة واثنتان وأربعون حركةً زائدة، ومعها نصف
 * «إيراد» لم يدخل الحساب قطّ.
 *
 * والدرس: ما يتغيّر بتغيّر صيغة التصدير لا يصلح جزءاً من هوية الحركة.
 */
import { createHash } from "node:crypto";

export interface TransactionIdentityInput {
  /** التاريخ بصيغة YYYY-MM-DD */
  valueDate: string;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  description?: string | null;
  /** ترتيب هذه الحركة بين الحركات المطابقة لها في الملف نفسه، من صفر */
  occurrence: number;
}

/**
 * يوحّد الوصف قبل أن يدخل البصمة.
 *
 * صيغتا التصدير تختلفان في الفراغات وحالة الأحرف لنفس الحركة، وهذا
 * اختلاف عرضٍ لا اختلاف معنى.
 */
export function normalizeDescription(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function transactionIdentity(input: TransactionIdentityInput): string {
  /*
    رقم الحساب مقصودٌ خروجه: هو خاصّية ملفٍ لا خاصّية حركة، ويغيب في
    بعض صيغ التصدير فيفرّق بصمةَ حركةٍ واحدة. وتمييزُ الحسابات يقع في
    نطاق القيد (`identityScope`) لا في البصمة.
  */
  const parts = [
    input.valueDate,
    String(input.amountMinor),
    input.direction,
    normalizeDescription(input.description),
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
): (T & { externalId: string })[] {
  const seen = new Map<string, number>();

  return rows.map((row) => {
    const valueDate = row.valueDate.toISOString().slice(0, 10);
    /*
      التطبيع نفسه في العدّ وفي البصمة.

      كان العدّ يستعمل الوصف خاماً والبصمة تستعمله موحَّداً. فحركتان
      لا يفرّقهما إلّا فراغٌ مزدوج — وهذا اختلاف تصديرٍ لا اختلاف
      حركة — تأخذان الترتيب صفراً كلتاهما، ثمّ يوحّدهما التطبيع فتخرج
      لهما بصمةٌ واحدة، فتُبتلَع إحداهما بوصفها «مكرّرة». وهي حركة
      حقيقية بمال حقيقي، تختفي بلا أثر ولا شكوى.

      والقاعدة: تمثيلٌ واحد للهوية، يُعدّ به ويُبصَم به.
    */
    const key = [
      valueDate,
      row.amountMinor,
      row.direction,
      normalizeDescription(row.description),
    ].join("|");
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);

    return {
      ...row,
      externalId: transactionIdentity({
        valueDate,
        amountMinor: row.amountMinor,
        direction: row.direction,
        description: row.description,
        occurrence,
      }),
    };
  });
}

/**
 * نطاق الهوية: الحساب الداخليّ.
 *
 * البصمة تصف **الحركة**، ولا تصف أين وقعت. فحوالتان بالمبلغ نفسه في
 * اليوم نفسه بالوصف نفسه، إحداهما من حساب الراجحي والأخرى من حساب
 * الأهلي، لهما البصمة نفسها — وكان القيد الفريد على البصمة وحدها،
 * فتُقبَل الأولى وتُرَدّ الثانية بوصفها «مستوردة مسبقاً». حركةٌ حقيقية
 * تُمحى لأنّ حساباً آخر سبقها.
 *
 * فالنطاق جزء من القيد لا من البصمة: الحساب المجهول يأخذ نطاقاً واحداً
 * ثابتاً كي يبقى منع التكرار عاملاً قبل أن تُعرف الحسابات.
 */
export const UNSCOPED = "~";

export function identityScope(bankAccountId: string | null | undefined): string {
  return bankAccountId ?? UNSCOPED;
}

/** المفتاح الكامل كما يفرضه القيد في القاعدة. */
export function scopedIdentity(
  bankAccountId: string | null | undefined,
  externalId: string,
): string {
  return `${identityScope(bankAccountId)}::${externalId}`;
}

/** بصمة الملف كاملاً — استيراده ثانيةً يُعرف بها قبل قراءة صفوفه. */
export function fileFingerprint(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
