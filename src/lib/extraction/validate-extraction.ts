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
import { parseRiyals, checkInvoiceTotals, TOTAL_ROUNDING_TOLERANCE_MINOR, formatRiyals, formatRiyalsDisplay } from "@/lib/money";
import { parseLineQuantity } from "@/lib/line-pricing";
import { decimalToMilli } from "@/lib/inventory/units";
import { normalizeDocumentDate } from "@/lib/document-date";
import type { ExtractionResult } from "./schema";

export type ConflictCode =
  | "TOTAL_NOT_SUM"
  | "VAT_RATE_ODD"
  | "LINES_NOT_SUBTOTAL"
  | "LINE_MATH"
  | "DATE_INVALID"
  | "DATE_IMPLAUSIBLE"
  | "VAT_FORMAT"
  | "PARTIES_SWAPPED"
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
 * الكمّيّة بالمِلّي (عددٌ صحيح) — بقارئ القيد نفسه (`parseLineQuantity`).
 *
 * كان هنا قارئٌ ثانٍ يبحث عن `\d` وحدها: «٢» و«١٢٫٥» تعودان `null` فيُتخطّى
 * فحصُ السطر صامتاً، ويُضرَب العددُ عائماً. فصارت القاعدة واحدة والحساب صحيحاً.
 */
function quantityMilli(v: string): number | null {
  return decimalToMilli(parseLineQuantity(v));
}

/** نسبة الضريبة ١٥٪ — بسطاً ومقاماً صحيحين، لا `0.15` عائمة. */
const VAT_PERCENT = 15;

/** ما يُتوقَّع ضريبةً من صافٍ — للعرض في الرسالة وحده. */
function expectedVat(subtotal: number): number {
  return Math.floor((subtotal * VAT_PERCENT + 50) / 100);
}

/** سنةٌ هجريّة مكتوبةٌ بصيغة التاريخ: «1448-03-05». لا تُحوَّل ولا يُعاد عنها السؤال. */
export function looksHijri(value: string): boolean {
  return /^1[345]\d{2}-\d{2}-\d{2}$/.test(value.trim());
}

/** أقدمُ ما يُعدّ تاريخُ مستندٍ معقولاً: ثمانية عشر شهراً قبل اليوم */
const MAX_AGE_MONTHS = 18;

function monthsBefore(today: string, months: number): string {
  const [y, m, d] = today.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1 - months, d));
  return at.toISOString().slice(0, 10);
}

const SAUDI_VAT_RE = /^3\d{13}3$/;

export interface ConflictContext {
  /** «اليوم» بتوقيت الرياض `YYYY-MM-DD` — به تُفحص معقوليّة التاريخ. بلا قيمةٍ لا تُفحص. */
  today?: string;
  /** رقمُنا الضريبيّ — به يُكشف تبديلُ البائع والمشتري. */
  companyVat?: string;
}

/**
 * يومٌ في التقويم لا شكلُه وحده — «2026-13-01» كان يُفسد الشهر
 * («NaN-NaN»)، و«2026-02-30» ينقلب إلى مارس صامتاً.
 */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function findConflicts(x: ExtractionResult, ctx: ConflictContext = {}): ExtractionConflict[] {
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

  /*
    ── التاريخ ──

    الهجريّ المنقول كما طُبع ليس خطأَ قراءة: لا يُعاد عنه السؤال (فيُدفَع النموذج
    إلى تحويله ظنّاً) — يُعلَن مجهولاً في `extractDocument` ويسدّه رمزُ الفاتورة إن وُجد.
  */
  if (x.invoiceDate.trim() !== "" && !looksHijri(x.invoiceDate)) {
    if (!isCalendarDate(x.invoiceDate)) {
      /* «13/09/2026» يفهمه الخادم — فلا يُدفع نداءٌ لإعادة كتابته */
      if (normalizeDocumentDate(x.invoiceDate) === null) {
        conflicts.push({
          code: "DATE_INVALID",
          fields: ["invoiceDate"],
          message: DATE_RE.test(x.invoiceDate)
            ? `التاريخ «${x.invoiceDate}» ليس يوماً في التقويم`
            : `التاريخ «${x.invoiceDate}» لا يُفهَم — اكتبه YYYY-MM-DD كما طُبع`,
        });
      }
    } else if (ctx.today && isCalendarDate(ctx.today)) {
      /*
        يومٌ صحيحٌ في التقويم وليس معقولاً: «2062-09-13» أو «2016-09-13» رقمٌ
        مقلوبٌ في السنة يضع الفاتورة في شهرٍ ضريبيّ خاطئ. يُعاد السؤال، فإن عاد
        الجوابُ نفسُه بقي تنبيهاً لمن يراجع.
      */
      if (x.invoiceDate > ctx.today) {
        conflicts.push({
          code: "DATE_IMPLAUSIBLE",
          fields: ["invoiceDate"],
          message: `التاريخ «${x.invoiceDate}» بعد اليوم (${ctx.today})`,
        });
      } else if (x.invoiceDate < monthsBefore(ctx.today, MAX_AGE_MONTHS)) {
        conflicts.push({
          code: "DATE_IMPLAUSIBLE",
          fields: ["invoiceDate"],
          message: `التاريخ «${x.invoiceDate}» أقدم من سنةٍ ونصف — تحقّق من السنة`,
        });
      }
    }
  }

  /* ── الرقم الضريبيّ للبائع: شكلُه، وألّا يكون رقمَنا ── */
  if (!isStatement && !isPayment) {
    const sellerVat = x.sellerVatNumber.replace(/\s+/g, "");
    if (sellerVat !== "" && ctx.companyVat && sellerVat === ctx.companyVat) {
      conflicts.push({
        code: "PARTIES_SWAPPED",
        fields: ["sellerVatNumber", "buyerVatNumber"],
        message: `الرقم الضريبيّ للبائع «${sellerVat}» هو رقمُنا نحن — ونحن المشتري. اقرأ رقم البائع من موضعه`,
      });
    } else if (sellerVat !== "" && !SAUDI_VAT_RE.test(sellerVat)) {
      conflicts.push({
        code: "VAT_FORMAT",
        fields: ["sellerVatNumber"],
        message: `الرقم الضريبيّ للبائع «${sellerVat}» ليس ١٥ رقماً أوّلها وآخرها ٣`,
      });
    }
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
    /* الخصمُ والرسومُ المطبوعان بعد الضريبة يسدّان الفرق — إن سدّاه */
    if (checkInvoiceTotals(subtotal, vat, total, {
      discountMinor: money(x.discountAmount ?? ""), chargesMinor: money(x.chargesAmount ?? ""),
    }).verdict === "MISMATCH") {
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
      const expected = expectedVat(subtotal);
      /* بالأعداد الصحيحة: ‎|الضريبة×١٠٠ − الصافي×١٥| ≤ ريال×١٠٠ — كما في `auto-archive` */
      if (Math.abs(vat * 100 - subtotal * VAT_PERCENT) > TOTAL_ROUNDING_TOLERANCE_MINOR * 100) {
        conflicts.push({
          code: "VAT_RATE_ODD",
          fields: ["subtotalAmount", "vatAmount"],
          message:
            `الضريبة ${x.vatAmount} تخالف ١٥٪ من الصافي ` +
            `(المتوقَّع ${formatRiyalsDisplay(expected)})`,
        });
      }
    }
  }

  /* ── البنود ── */
  if (x.lines.length > 0) {
    for (const [i, line] of x.lines.entries()) {
      const qMilli = quantityMilli(line.quantity);
      const unit = money(line.unitPrice);
      const lineTotal = money(line.lineTotal);
      if (qMilli === null || unit === null || lineTotal === null) continue;

      /* الكمّيّة بالمِلّي × السعر بالهللات، يُقابَل بإجماليّ السطر × ١٠٠٠ — بلا عددٍ عشريّ */
      if (Math.abs(qMilli * unit - lineTotal * 1000) > TOTAL_ROUNDING_TOLERANCE_MINOR * 1000) {
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
            `مجموع البنود ${formatRiyalsDisplay(lineSum)} لا يوافق ` +
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

  return { ...x, subtotalAmount: formatRiyals(subtotal) };
}

/** يصوغ سؤال الإعادة — موجَّهاً إلى ما اختلّ وحده. */
export function describeConflicts(conflicts: readonly ExtractionConflict[]): string {
  const fields = [...new Set(conflicts.flatMap((c) => c.fields))];
  return (
    "في القراءة ما لا يستقيم:\n" +
    conflicts.map((c) => `- ${c.message}`).join("\n") +
    `\n\nأعد قراءة هذه الحقول من المستند وحدها: ${fields.join("، ")}. ` +
    "انسخ ما هو مطبوع حرفياً ولا تحسب ولا تصحّح، ولا تغيّر رقماً ليستقيم الجمع. " +
    "إن كان المطبوع نفسه لا يستقيم فأبقِه كما هو — ذلك جوابٌ مقبول. " +
    "أعد الكائن كاملاً بالمخطّط نفسه."
  );
}
