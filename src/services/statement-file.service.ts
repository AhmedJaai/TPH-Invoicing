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
import { bankLabel, detectBank } from "@/lib/bank/parsers/detect";

export type StatementSource = "SPREADSHEET" | "PDF_TEXT" | "PDF_SCANNED";

export interface StatementRead extends BankStatementParse {
  source: StatementSource;
  /** ما دلّ على البنك، إن عُرف — يُعرَض عند الشكّ. */
  bankEvidence?: string[];
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
    const parsed = parseBankStatement(buffer);
    /*
      البنك يُكشَف من محتوى الملفّ لا يُفترَض. وحين لا يُعرَف لا
      يُنسَب إلى الأهليّ لأنّه الأكثر — القراءة تمضي على بنية الأعمدة،
      واسم البنك للعرض والأثر.
    */
    const detected = detectBank({
      text: [...parsed.rows.slice(0, 5).map((r) => r.description), parsed.accountNumber ?? ""].join(" "),
      fileName,
    });
    return {
      ...parsed,
      bank: detected ? detected.bankName : parsed.bank,
      bankEvidence: detected?.matched,
      source: "SPREADSHEET",
    };
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
  const detected = detectBank({
    text: grid.slice(0, 12).flat().join(" "),
    fileName,
  });
  const parsed = parseRowGrid(grid, { bank: bankLabel(detected) });
  return { ...parsed, bankEvidence: detected?.matched, source: "PDF_TEXT" };
}
