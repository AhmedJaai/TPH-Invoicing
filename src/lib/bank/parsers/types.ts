/**
 * موائم كشف الحساب.
 *
 * كان القارئ واحداً مبنيّاً على صيغة الأهلي، فأيّ بنكٍ آخر أو أيّ تغيّر
 * في تصديره يعني تعديل الملفّ نفسه. وهذا لا يتوسّع.
 *
 * فصار لكل بنك موائم يُعلن ما يعرفه، ويُخرج الصفوف بالنموذج المعياريّ
 * وحده — وما بعده لا يسأل من أيّ بنك جاء.
 */
import type { BankRow, ParseWarning } from "../parse";

export interface StatementFile {
  buffer: Buffer;
  fileName: string;
  mimeType?: string;
}

export interface AdapterResult {
  bank: string;
  accountNumber?: string;
  rows: BankRow[];
  warnings: ParseWarning[];
  periodStart?: Date;
  periodEnd?: Date;
}

export interface BankAdapter {
  /** اسمٌ يُعرَض. */
  name: string;
  /**
   * ثقة الموائم بأنّ هذا الملفّ له، من صفر إلى واحد.
   *
   * تُرجَع درجةٌ لا نعم/لا: ملفّان قد يصلحان لموائمين، فيُختار الأوثق.
   * والصفر يعني «ليس لي» قطعاً.
   */
  detect(file: StatementFile): number;
  parse(file: StatementFile): AdapterResult;
}

/** أدنى ثقةٍ يُقبَل بها موائم — ما دونها يُعدّ عاماً. */
export const MIN_CONFIDENCE = 0.3;
