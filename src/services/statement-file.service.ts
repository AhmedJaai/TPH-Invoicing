/**
 * قراءة ملفّ كشف الحساب، أيّاً كانت صيغته.
 *
 * والترتيب مقصود ومكتوب:
 *
 *   ١. جدول (Excel/CSV) ← يُقرأ حسابياً.
 *   ٢. PDF نصّيّ        ← يُستخرَج نصّه ومواضعه ثمّ يُقرأ حسابياً.
 *   ٣. PDF مصوَّر       ← **يُعلَن** أنّه يحتاج قراءةً بصرية، ولا يُقرأ.
 *
 * ولا يُرمى ملفٌّ كامل إلى نموذج لغويّ ويُقال له افهمه: أكثر الكشوف
 * منظَّمة، وقراءتها حسابياً أدقّ وأرخص وأسرع. والنموذج للمصوَّر وحده.
 */
import { parseBankStatement, parseRowGrid, type BankStatementParse } from "@/lib/bank/parse";
import { extractPdfWords, groupIntoRows } from "@/lib/bank/parsers/pdf-text";

export type StatementSource = "SPREADSHEET" | "PDF_TEXT" | "PDF_SCANNED";

export interface StatementRead extends BankStatementParse {
  source: StatementSource;
  /** حين يتعذّر: سببٌ يُعرَض للمستخدم لا خطأ تقنيّ. */
  blocked?: string;
}

const PDF_TYPES = ["application/pdf"];
const PDF_EXT = /\.pdf$/i;

export function isPdf(fileName: string, mimeType?: string): boolean {
  return PDF_EXT.test(fileName) || (mimeType !== undefined && PDF_TYPES.includes(mimeType));
}

export async function readStatementFile(
  buffer: Buffer,
  fileName: string,
  mimeType?: string,
): Promise<StatementRead> {
  if (!isPdf(fileName, mimeType)) {
    return { ...parseBankStatement(buffer), source: "SPREADSHEET" };
  }

  const extracted = await extractPdfWords(buffer);

  if (!extracted.hasText) {
    /*
      مصوَّر: لا يُقرأ حسابياً ولا يُخمَّن. ويُعلَن السبب صراحةً — إرجاع
      صفوفٍ فارغة هنا يقول «الكشف فارغ» وهو ليس كذلك.
    */
    return {
      bank: "غير محدَّد",
      rows: [],
      warnings: [],
      source: "PDF_SCANNED",
      blocked:
        `هذا الملفّ صورةٌ لا نصّ (${extracted.pageCount} صفحة). ` +
        "اطلب من بنكك كشفاً بصيغة Excel أو PDF نصّيّ — أو صدّره من التطبيق لا صورةً.",
    };
  }

  const grid = groupIntoRows(extracted.words);
  return { ...parseRowGrid(grid, { bank: "PDF" }), source: "PDF_TEXT" };
}
