/**
 * التحقّق من القراءة — قبل أن تبلغ القاعدة.
 *
 * ── لماذا هنا، ولماذا الآن ──
 *
 * `validation.ts` يفحص المرشَّح بعد أن صار هللاتٍ ونيّةَ أرشفة، ويُنتج
 * تنبيهاتٍ للمستخدم. وهذا الملفّ أسبق منه وغرضُه آخر: يسأل **أقرأ
 * النموذجُ صحيحاً؟** لا **أهذه الفاتورة سليمة؟**
 *
 * والفرق عمليّ: تنبيهُ `validation` يُعرَض لأحمد ليقرّر، وتعارضُ هذا
 * الملفّ يُعاد به السؤال إلى النموذج نفسه — فأكثرُه خطأُ قراءةٍ في رقم،
 * يُصلحه أن يُقال للنموذج «أعد قراءة هذه الحقول وحدها».
 *
 * وصار هذا لازماً لا مستحبّاً بعد الانتقال إلى DeepSeek: مزوّدٌ لا
 * يفرض مخطّطاً، فما لا تفرضه الواجهة يجب أن يُمسَك هنا.
 *
 * ── ولا يُصحَّح شيء ──
 *
 * لا يُحسَب مجموعٌ ناقص ولا تُستنتَج ضريبةٌ غائبة. **المجهول ليس
 * صفراً، والمحسوب عندنا ليس ما في المستند.** يُكشَف التعارض ويُعاد
 * السؤال؛ فإن بقي رُفع إلى إنسان.
 */
import { parseRiyals, isSupplierRounding, TOTAL_ROUNDING_TOLERANCE_MINOR } from "@/lib/money";
import { VAT_RATE } from "@/config/drive";
import type { ExtractionResult } from "./schema";

export type ConflictCode =
  | "TOTAL_NOT_SUM"
  | "VAT_RATE_ODD"
  | "LINES_NOT_SUBTOTAL"
  | "LINE_MATH"
  | "DATE_INVALID"
  | "AMOUNT_UNREADABLE";

export interface ExtractionConflict {
  code: ConflictCode;
  /** الحقول التي يُعاد سؤال النموذج عنها وحدها. */
  fields: string[];
  message: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** تسامحٌ في مجموع البنود: المورّد يقرّب كسور الريال في كل سطر. */
const LINES_TOLERANCE_MINOR = 5 * TOTAL_ROUNDING_TOLERANCE_MINOR;

function money(v: string): number | null {
  return v.trim() === "" ? null : parseRiyals(v);
}

/**
 * الكميّة قد تُكتب «2» أو «2.5» أو «2 كجم».
 * ويُقرأ منها العدد وحده؛ وما لا عدد فيه لا يُفحَص حسابُه.
 */
function quantity(v: string): number | null {
  const m = v.replace(/[،,]/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

export function findConflicts(x: ExtractionResult): ExtractionConflict[] {
  const conflicts: ExtractionConflict[] = [];

  const isStatement = x.documentKind === "STATEMENT";
  const isPayment = x.documentKind === "RECEIPT" || x.documentKind === "CASH_RECEIPT";

  /* ── المبالغ تُقرأ أصلاً؟ ── */
  for (const [field, raw] of [
    ["subtotalAmount", x.subtotalAmount],
    ["vatAmount", x.vatAmount],
    ["totalAmount", x.totalAmount],
  ] as const) {
    if (raw.trim() !== "" && parseRiyals(raw) === null) {
      conflicts.push({
        code: "AMOUNT_UNREADABLE",
        fields: [field],
        message: `الحقل ${field} فيه «${raw}» وليس مبلغاً يُقرأ`,
      });
    }
  }

  /* ── التاريخ ── */
  if (x.invoiceDate.trim() !== "" && !DATE_RE.test(x.invoiceDate)) {
    conflicts.push({
      code: "DATE_INVALID",
      fields: ["invoiceDate"],
      message: `التاريخ «${x.invoiceDate}» ليس بصيغة YYYY-MM-DD`,
    });
  }

  const subtotal = money(x.subtotalAmount);
  const vat = money(x.vatAmount);
  const total = money(x.totalAmount);

  /*
    ── صافي + ضريبة = إجمالي ──

    ولا يُفحَص في الكشف ولا الإيصال: الكشف مجموعُ حركاتٍ لا فاتورة،
    والإيصال مبلغٌ واحد محوَّل. وفرضُ معادلة الفاتورة عليهما يُنتج
    تعارضاً كاذباً يُعيد السؤال بلا سبب.
  */
  if (!isStatement && !isPayment && subtotal !== null && vat !== null && total !== null) {
    if (subtotal + vat !== total && !isSupplierRounding(subtotal, vat, total)) {
      conflicts.push({
        code: "TOTAL_NOT_SUM",
        fields: ["subtotalAmount", "vatAmount", "totalAmount"],
        message:
          `الإجمالي ${x.totalAmount} لا يساوي الصافي ${x.subtotalAmount} ` +
          `زائد الضريبة ${x.vatAmount}`,
      });
    } else if (subtotal > 0 && vat > 0) {
      /*
        نسبة الضريبة — تنبيهاً لا حكماً.

        قد تحمل الفاتورة بنوداً معفاة فتصحّ نسبةٌ دون ١٥٪. فلا يُطلَب
        تصحيحٌ بل إعادةُ قراءة: إن عاد الرقم نفسه فهو ما في المستند،
        ويُترَك لـ`validation.ts` أن ينبّه أحمد.
      */
      const expected = Math.round(subtotal * VAT_RATE);
      if (Math.abs(expected - vat) > TOTAL_ROUNDING_TOLERANCE_MINOR) {
        conflicts.push({
          code: "VAT_RATE_ODD",
          fields: ["subtotalAmount", "vatAmount"],
          message:
            `الضريبة ${x.vatAmount} تخالف ١٥٪ من الصافي ` +
            `(المتوقَّع ${(expected / 100).toFixed(2)})`,
        });
      }
    }
  }

  /* ── البنود ── */
  if (x.lines.length > 0) {
    for (const [i, line] of x.lines.entries()) {
      const q = quantity(line.quantity);
      const unit = money(line.unitPrice);
      const lineTotal = money(line.lineTotal);
      if (q === null || unit === null || lineTotal === null) continue;

      const expected = Math.round(q * unit);
      if (Math.abs(expected - lineTotal) > TOTAL_ROUNDING_TOLERANCE_MINOR) {
        conflicts.push({
          code: "LINE_MATH",
          fields: [`lines[${i}]`],
          message:
            `البند ${i + 1} «${line.description.slice(0, 30)}»: ` +
            `${line.quantity} × ${line.unitPrice} لا يساوي ${line.lineTotal}`,
        });
      }
    }

    const lineSum = x.lines.reduce<number | null>((acc, l) => {
      if (acc === null) return null;
      const v = money(l.lineTotal);
      return v === null ? null : acc + v;
    }, 0);

    if (lineSum !== null && subtotal !== null && subtotal > 0) {
      if (Math.abs(lineSum - subtotal) > LINES_TOLERANCE_MINOR) {
        conflicts.push({
          code: "LINES_NOT_SUBTOTAL",
          fields: ["lines", "subtotalAmount"],
          message:
            `مجموع البنود ${(lineSum / 100).toFixed(2)} لا يوافق ` +
            `الصافي ${x.subtotalAmount}`,
        });
      }
    }
  }

  /*
    ولا تُفحَص أكثر من ثلاثة تعارضات في سؤال الإعادة.

    الرسالة الطويلة تُشتّت النموذج كما يُشتّته المخطّط الضخم، وأكثرُ
    التعارضات يتبع بعضُه بعضاً: خطأُ رقمٍ واحد يُظهر ثلاثة.
  */
  return conflicts.slice(0, 3);
}

/**
 * يشتقّ الصافي حسابياً حين لا يكون مطبوعاً.
 *
 * ── لماذا لا يُسأل النموذج عنه ──
 *
 * ٥٦ فاتورةً في الأرشيف بلا ضريبة، و**في السّتّ والخمسين جميعاً الصافي
 * يساوي الإجمالي** — لأنّ الفاتورة التي لا ضريبة فيها لا تطبع سطر
 * «الإجمالي قبل الضريبة» أصلاً. فالحقل غير موجودٍ في الورقة.
 *
 * وقياسُ الأرشيف كشف ما يترتّب على ذلك: ترك DeepSeek الصافي فارغاً في
 * ٤٨ منها — **وهو مطيعٌ في ذلك**، فالتعليمات تقول له «لا تحسب ولا
 * تستنتج مبلغاً غائباً». بينما ملأه جيميني بصدى الإجمالي، أي أنّه
 * استنتج. فبدا الأوّل أضعف في المقياس وهو الأدقّ التزاماً.
 *
 * ── فالحساب يقع عندنا ──
 *
 * `الصافي = الإجمالي − الضريبة` **هويّةٌ حسابية لا استنتاج**. والقاعدة
 * المعلَنة في هذا المشروع أنّ الشيفرة الحتمية هي صاحبة الحساب، لا
 * النموذج. فيُطلَب من النموذج النقلُ وحده، ويُشتقّ ما يُشتقّ هنا —
 * بدقّةٍ تامّة وبلا كلفة وبلا خطأ قراءة.
 *
 * ولا يُشتقّ العكس: لو حُسبت الضريبة من `الإجمالي − الصافي` لكُتب صفرٌ
 * حين يتساويان — وذلك يقول «لا ضريبة» بينما قد يكون سطرُها لم يُقرأ.
 * **والمجهول ليس صفراً**، فالاشتقاق في اتجاهٍ واحد عمداً.
 */
export function deriveAmounts(x: ExtractionResult): ExtractionResult {
  if (x.subtotalAmount.trim() !== "") return x;

  const total = money(x.totalAmount);
  const vat = money(x.vatAmount);
  if (total === null || vat === null) return x;

  const subtotal = total - vat;
  if (subtotal < 0) return x;

  return { ...x, subtotalAmount: (subtotal / 100).toFixed(2) };
}

/** يصوغ سؤال الإعادة — موجَّهاً إلى ما اختلّ وحده. */
export function describeConflicts(conflicts: readonly ExtractionConflict[]): string {
  const fields = [...new Set(conflicts.flatMap((c) => c.fields))];
  return (
    "القراءة لا تستقيم حسابياً:\n" +
    conflicts.map((c) => `- ${c.message}`).join("\n") +
    `\n\nأعد قراءة هذه الحقول من المستند وحدها: ${fields.join("، ")}. ` +
    "انسخ ما هو مطبوع حرفياً ولا تحسب ولا تصحّح. " +
    "إن كان المطبوع نفسه لا يستقيم فأبقِه كما هو. " +
    "أعد الكائن كاملاً بالمخطّط نفسه."
  );
}
