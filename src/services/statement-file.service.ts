/**
 * قراءة ملفّ كشف الحساب، أيّاً كانت صيغته.
 *
 * والترتيب مقصود ومكتوب:
 *
 *   ١. جدول (Excel/CSV) ← يُقرأ حسابياً.
 *   ٢. PDF نصّيّ        ← يُستخرَج نصّه ومواضعه ثمّ يُقرأ حسابياً.
 *   ٣. PDF مصوَّر       ← يُقرأ بصرياً **إن هُيّئ مزوّد**، وإلّا يُعلَن.
 *
 * ولا يُرمى ملفٌّ كامل إلى نموذج لغويّ ويُقال له افهمه: أكثر الكشوف
 * منظَّمة، وقراءتها حسابياً أدقّ وأرخص وأسرع. والنموذج للمصوَّر وحده.
 *
 * وكان المصوَّر يُرَدّ بالكامل — وهو صحيحٌ ما دام لا بديل، لكنّه يعني
 * أنّ من لا يعطيه بنكه إلّا صورةً لا يستطيع استعمال النظام أصلاً.
 * ورَدُّ الملفّ ليس حمايةً حين يكون البديل ألّا يُقرأ الكشف إطلاقاً.
 *
 * **والشروط هي الحماية لا الردّ**: كلّ مبلغٍ يُفحَص نصّاً، وكلّ تاريخٍ
 * يُفحَص مدىً، والرصيدُ يُختبَر بالمعادلة — فإن اختلّت رُدّ الكشف كلّه.
 * ولا يُطابَق ما قُرئ بصرياً تلقائياً أبداً.
 */
import { parseBankStatement, parseRowGrid, type BankStatementParse } from "@/lib/bank/parse";
import { extractPdfWords, groupIntoRows } from "@/lib/bank/parsers/pdf-text";
import { bankLabel, detectBank } from "@/lib/bank/parsers/detect";
import { adapterFor, adapterNotices } from "@/lib/bank/parsers/adapters";
import { MAX_VISION_PAGES, validateVision } from "@/lib/bank/vision-statement";
import { selectedVision } from "./statement-vision.service";

export type StatementSource = "SPREADSHEET" | "PDF_TEXT" | "PDF_SCANNED" | "PDF_VISION";

export interface StatementRead extends BankStatementParse {
  source: StatementSource;
  /** ما دلّ على البنك، إن عُرف — يُعرَض عند الشكّ. */
  bankEvidence?: string[];
  /**
   * حدود القراءة المعلومة سلفاً — تُعرَض دائماً لا عند الخطأ.
   *
   * العِلّة المعروفة ليست خطأً وقع بل حدٌّ يجب أن يُعرَف. وإخفاؤها حتى
   * يقع الخطأ يجعل من يقع فيه يظنّ أنّ النظام أخطأ، وإنّما هو يعمل
   * ضمن حدّه المعلَن.
   */
  notices?: string[];
  /** حين يتعذّر: سببٌ يُعرَض للمستخدم لا خطأ تقنيّ. */
  blocked?: string;
  /**
   * قُرئ بصرياً — فلا يُطابَق تلقائياً مهما بلغت الدرجة.
   *
   * وليست هذه احتياطاً زائداً: قراءةُ نموذجٍ للأرقام تُخطئ، وخطؤها في
   * المال لا يُغتفَر. فالمعادلة تكشف الخطأ الجسيم، ولا تكشف تبادلَ
   * وصفين بين سطرين متساويَي المبلغ.
   */
  visionRead?: {
    provider: string;
    model: string;
    rejectedRows: number;
    reasons: string[];
  };
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
      notices: adapterNotices(adapterFor(detected?.bankId)),
      source: "SPREADSHEET",
    };
  }

  const extracted = await extractPdfWords(buffer);

  if (!extracted.hasText) {
    /*
      مصوَّر: لا يُقرأ حسابياً. فإن هُيّئ مزوّدُ رؤيةٍ قُرئ بصرياً بشروطه،
      وإلّا أُعلن السبب صراحةً — إرجاع صفوفٍ فارغة هنا يقول «الكشف فارغ»
      وهو ليس كذلك.
    */
    const askForText =
      `هذا الملفّ صورةٌ لا نصّ (${extracted.pageCount} صفحة). ` +
      "اطلب من بنكك كشفاً بصيغة Excel أو PDF نصّيّ — أو صدّره من التطبيق لا صورةً.";

    const vision = selectedVision();
    if (!vision.isConfigured()) {
      return { bank: "غير محدَّد", rows: [], warnings: [], source: "PDF_SCANNED", blocked: askForText };
    }

    if (extracted.pageCount > MAX_VISION_PAGES) {
      return {
        bank: "غير محدَّد", rows: [], warnings: [], source: "PDF_SCANNED",
        blocked:
          `الكشف ${extracted.pageCount} صفحة، والقراءة البصرية تقف عند ${MAX_VISION_PAGES}. ` +
          "قسّمه أو اطلبه نصّاً.",
      };
    }

    const outcome = await vision.read(buffer);
    if (!outcome.ok || !outcome.value) {
      return {
        bank: "غير محدَّد", rows: [], warnings: [], source: "PDF_SCANNED",
        blocked: `تعذّرت القراءة البصرية: ${outcome.reason ?? "بلا سبب"}. ${askForText}`,
      };
    }

    const checked = validateVision(outcome.value);
    if (checked.blocked) {
      return {
        bank: "غير محدَّد", rows: [], warnings: [], source: "PDF_SCANNED",
        blocked: `${checked.blocked} ${askForText}`,
      };
    }

    const detectedVision = detectBank({
      text: checked.rows.slice(0, 12).map((r) => r.description).join(" "),
      fileName,
    });

    const dates = checked.rows.map((r) => r.valueDate.getTime());

    return {
      bank: bankLabel(detectedVision),
      accountNumber: outcome.value.accountNumber ?? undefined,
      bankEvidence: detectedVision?.matched,
      notices: [
        "قُرئ هذا الكشف بصرياً من صورة — لا يُطابَق منه شيء تلقائياً مهما بلغت الدرجة.",
        ...adapterNotices(adapterFor(detectedVision?.bankId)),
      ],
      rows: checked.rows.map((r) => ({
        rowNumber: r.rowNumber,
        valueDate: r.valueDate,
        transactionType: "",
        description: r.description,
        amountMinor: r.amountMinor,
        direction: r.direction,
      })),
      /* السطر المردود يُعلَن سطراً سطراً — لا يُبتلَع في عدّاد */
      warnings: checked.rejected.map((r) => ({
        rowNumber: r.rowNumber, reason: r.reason, raw: r.raw,
      })),
      periodStart: new Date(Math.min(...dates)),
      periodEnd: new Date(Math.max(...dates)),
      source: "PDF_VISION",
      visionRead: {
        provider: outcome.provider,
        model: outcome.model,
        rejectedRows: checked.rejected.length,
        reasons: [...new Set(checked.rejected.map((r) => r.reason))],
      },
    };
  }

  const grid = groupIntoRows(extracted.words);
  const detected = detectBank({
    text: grid.slice(0, 12).flat().join(" "),
    fileName,
  });
  const parsed = parseRowGrid(grid, { bank: bankLabel(detected) });
  return {
    ...parsed,
    bankEvidence: detected?.matched,
    notices: adapterNotices(adapterFor(detected?.bankId)),
    source: "PDF_TEXT",
  };
}
