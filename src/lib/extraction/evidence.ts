/**
 * أدلّة القراءة — ما يُعرَف عن المستند من غير النموذج، وما وقع أثناء قراءته.
 *
 * النموذج يقترح. وهذا الملفّ يجمع ما **يُقابَل** به اقتراحُه: رمز الفاتورة
 * الضريبيّ (كتبه نظام المورّد)، واسم الملفّ، وما اشتُقّ حساباً — ومعه ما
 * يُضعف القراءة: تعارضٌ بقي بعد إعادة السؤال، ومبلغٌ تبدّل عند إعادته،
 * وصفحاتٌ لم تُقرأ.
 *
 * وقاعدته قاعدة المشروع: **الرمز يسدّ فراغاً ولا يكتب فوق قراءة.** فإن سكت
 * النموذج عن حقلٍ والرمز ينطق به أُخذ منه وعُلِّم مصدرُه؛ وإن خالفه لم
 * يُصحَّح شيء — يُعلَن الخلاف ويُمنع الدخول الآليّ حتى ينظر إنسان.
 */
import { z } from "zod";
import { formatRiyals, parseRiyals, TOTAL_ROUNDING_TOLERANCE_MINOR } from "@/lib/money";
import { normalizeDocumentDate } from "@/lib/document-date";
import type { ExtractionResult } from "./schema";
import type { ZatcaQrFacts } from "./zatca-tlv";

/** من أين جاء حقلٌ لم يقرأه النموذج. وما ليس هنا فمن النموذج. */
export const FIELD_SOURCES = ["QR", "FILENAME", "DERIVED"] as const;
export type FieldSource = (typeof FIELD_SOURCES)[number];

export const SOURCE_LABEL: Record<FieldSource, string> = {
  QR: "من رمز الفاتورة",
  FILENAME: "من اسم الملفّ",
  DERIVED: "محسوب",
};

export type QrField = "total" | "vat" | "sellerVat" | "date";

export const QR_FIELD_LABEL: Record<QrField, string> = {
  total: "الإجماليّ",
  vat: "الضريبة",
  sellerVat: "رقم البائع الضريبيّ",
  date: "التاريخ",
};

const qrFactsSchema = z.object({
  sellerName: z.string().nullable(),
  sellerVatNumber: z.string().nullable(),
  sellerVatRaw: z.string(),
  timestampRaw: z.string(),
  date: z.string().nullable(),
  totalMinor: z.number().int().nullable(),
  vatMinor: z.number().int().nullable(),
  phase2: z.boolean(),
  tags: z.array(z.number().int()),
});

const qrReadingSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("FOUND"), facts: qrFactsSchema, page: z.number().int() }),
  z.object({ status: z.literal("NOT_ZATCA"), reason: z.string() }),
  z.object({ status: z.literal("NONE") }),
  z.object({ status: z.literal("SKIPPED"), reason: z.string() }),
]);

const disagreementSchema = z.object({
  field: z.enum(["total", "vat", "sellerVat", "date"]),
  /** ما قرأه النموذج — كما يُعرض */
  read: z.string(),
  /** ما في الرمز — كما يُعرض */
  qr: z.string(),
  /** أيمنع الدخول الآليّ؟ فرقُ هللاتٍ في التقريب، أو يومٌ داخل الشهر نفسه، لا يمنع */
  blocking: z.boolean(),
});
export type QrDisagreement = z.infer<typeof disagreementSchema>;

export const extractionEvidenceSchema = z.object({
  qr: qrReadingSchema.nullable().default(null),
  provenance: z.record(z.string(), z.enum(FIELD_SOURCES)).default({}),
  agreements: z.array(z.enum(["total", "vat", "sellerVat", "date"])).default([]),
  disagreements: z.array(disagreementSchema).default([]),
  /** تعارضٌ حسابيّ بقي بعد إعادة السؤال — بنصّه */
  unresolvedConflicts: z.array(z.string()).default([]),
  /** حقولٌ ماليّة تبدّلت بين جواب النموذج الأوّل وجوابه بعد إعادة السؤال */
  reaskChanged: z.array(z.string()).default([]),
  /** كم صفحةً قُرئت من كم — `null` إن لم يُعرف */
  pages: z.object({ read: z.number().int(), total: z.number().int() }).nullable().default(null),
  promptVersion: z.string().nullable().default(null),
  schemaVersion: z.string().nullable().default(null),
  provider: z.string().nullable().default(null),
});
export type ExtractionEvidence = z.infer<typeof extractionEvidenceSchema>;

export function emptyEvidence(): ExtractionEvidence {
  return extractionEvidenceSchema.parse({});
}

/** يقرأ الدليل المحفوظ — `null` لما حُفظ قبل وجوده أو لا يطابق شكله. */
export function parseEvidence(stored: unknown): ExtractionEvidence | null {
  if (stored === null || stored === undefined) return null;
  const parsed = extractionEvidenceSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}

/** الفواتير وحدها تحمل رمزاً ضريبيّاً — وما لم يُصنَّف قد يكون فاتورة. */
const QR_KINDS = new Set(["TAX_INVOICE", "SIMPLIFIED_INVOICE", "UNKNOWN"]);
const VAT_RE = /^3\d{13}3$/;

/** «03-04» و«04-03»: اليوم والشهر مقلوبان في السنة نفسها */
function isDayMonthSwap(a: string, b: string): boolean {
  const [ay, am, ad] = a.split("-");
  const [by, bm, bd] = b.split("-");
  return ay === by && am === bd && ad === bm && am !== ad;
}

export interface QrReconciliation {
  value: ExtractionResult;
  provenance: Record<string, FieldSource>;
  agreements: QrField[];
  disagreements: QrDisagreement[];
}

/**
 * يقابل ما قرأه النموذج بما في الرمز.
 *
 * - الفراغ يُسدّ من الرمز ويُعلَّم `QR`.
 * - المبلغ المطابق بالهللة **اتّفاق** (شاهدٌ مستقلّ)، والمخالف بأكثر من ريال
 *   **خلافٌ مانع**، وما بينهما تقريبُ مورّدٍ يُعرَض ولا يمنع.
 * - رقم البائع: إن قرأ النموذج رقمَنا نحن أو رقماً لا يصحّ شكلُه أُخذ رقم
 *   الرمز؛ وإن قرأ رقماً صحيح الشكل يخالفه فخلافٌ مانع (أيّهما المورّد؟).
 * - التاريخ: يومٌ وشهرٌ مقلوبان يحسمهما الرمز (وقتُه ISO لا لبس فيه)؛
 *   وخلافٌ يغيّر الشهر مانع، وداخل الشهر يُعرَض.
 */
export function reconcileWithQr(
  value: ExtractionResult,
  facts: ZatcaQrFacts,
  companyVat: string,
): QrReconciliation {
  const out: ExtractionResult = { ...value };
  const provenance: Record<string, FieldSource> = {};
  const agreements: QrField[] = [];
  const disagreements: QrDisagreement[] = [];

  if (!QR_KINDS.has(value.documentKind)) {
    return { value: out, provenance, agreements, disagreements };
  }

  /* ── المبلغان ── */
  for (const [field, key, qrMinor] of [
    ["total", "totalAmount", facts.totalMinor],
    ["vat", "vatAmount", facts.vatMinor],
  ] as const) {
    if (qrMinor === null) continue;
    const raw = value[key];
    if (raw.trim() === "") {
      out[key] = formatRiyals(qrMinor);
      provenance[key] = "QR";
      continue;
    }
    const read = parseRiyals(raw);
    /* ما لا يُقرأ مبلغاً يبقى كما هو — يمسكه `findConflicts` ولا يُكتب فوقه */
    if (read === null) continue;
    if (read === qrMinor) agreements.push(field);
    else {
      disagreements.push({
        field,
        read: formatRiyals(read),
        qr: formatRiyals(qrMinor),
        blocking: Math.abs(read - qrMinor) > TOTAL_ROUNDING_TOLERANCE_MINOR,
      });
    }
  }

  /* ── رقم البائع الضريبيّ ── */
  if (facts.sellerVatNumber && facts.sellerVatNumber !== companyVat) {
    const read = value.sellerVatNumber.replace(/\s+/g, "");
    if (read === facts.sellerVatNumber) agreements.push("sellerVat");
    else if (read === "" || !VAT_RE.test(read) || read === companyVat) {
      out.sellerVatNumber = facts.sellerVatNumber;
      provenance.sellerVatNumber = "QR";
    } else {
      disagreements.push({ field: "sellerVat", read, qr: facts.sellerVatNumber, blocking: true });
    }
  }

  /* ── التاريخ ── */
  if (facts.date) {
    const read = normalizeDocumentDate(value.invoiceDate);
    if (value.invoiceDate.trim() === "" || read === null) {
      /* فارغٌ أو لا يُفهَم (هجريّ مثلاً): الرمز ميلاديٌّ بنظام المورّد */
      if (value.invoiceDate.trim() === "") {
        out.invoiceDate = facts.date;
        provenance.invoiceDate = "QR";
      }
    } else if (read === facts.date) agreements.push("date");
    else if (isDayMonthSwap(read, facts.date)) {
      out.invoiceDate = facts.date;
      provenance.invoiceDate = "QR";
    } else {
      disagreements.push({
        field: "date",
        read,
        qr: facts.date,
        blocking: read.slice(0, 7) !== facts.date.slice(0, 7),
      });
    }
  }

  /* ── الاسم: يُسدّ إن سكت النموذج عن الاسمين معاً ── */
  if (facts.sellerName && value.supplierNameAr.trim() === "" && value.supplierNameEn.trim() === "") {
    if (/[؀-ۿ]/.test(facts.sellerName)) {
      out.supplierNameAr = facts.sellerName;
      provenance.supplierNameAr = "QR";
    } else {
      out.supplierNameEn = facts.sellerName;
      provenance.supplierNameEn = "QR";
    }
  }

  return { value: out, provenance, agreements, disagreements };
}

/** ما تأخذه `autoArchive` من الدليل — بلا أن تعرف شكله. */
export interface QrArchiveFacts {
  qrTotalMinor: number | null;
  qrVatMinor: number | null;
  /** خلافٌ مانع في غير المبلغ: رقم البائع، أو تاريخٌ في شهرٍ آخر */
  qrOtherConflict: boolean;
  /** مبلغٌ تبدّل عند إعادة السؤال */
  reaskChangedMoney: boolean;
}

const MONEY_FIELDS = new Set(["subtotalAmount", "vatAmount", "totalAmount", "discountAmount", "chargesAmount"]);

export function qrArchiveFacts(evidence: ExtractionEvidence | null): QrArchiveFacts {
  const facts = evidence?.qr?.status === "FOUND" ? evidence.qr.facts : null;
  return {
    qrTotalMinor: facts?.totalMinor ?? null,
    qrVatMinor: facts?.vatMinor ?? null,
    qrOtherConflict: (evidence?.disagreements ?? []).some((d) => d.blocking && (d.field === "sellerVat" || d.field === "date")),
    reaskChangedMoney: (evidence?.reaskChanged ?? []).some((f) => MONEY_FIELDS.has(f)),
  };
}

/** ما يُقال لمن يراجع — جملةً لكلّ دليلٍ يستحقّ نظره. */
export function evidenceWarnings(evidence: ExtractionEvidence | null): string[] {
  if (!evidence) return [];
  const out: string[] = [];
  for (const d of evidence.disagreements) {
    out.push(
      `${QR_FIELD_LABEL[d.field]} في رمز الفاتورة «${d.qr}» والمقروء «${d.read}»` +
        (d.blocking ? " — طابِقه بالورقة قبل الاعتماد" : " — فرقٌ يسير، تحقّق منه"),
    );
  }
  if (evidence.reaskChanged.length > 0) {
    out.push("تبدّل مبلغٌ بين قراءة النموذج الأولى وقراءته بعد إعادة السؤال — طابِق المبالغ بالورقة");
  }
  for (const c of evidence.unresolvedConflicts) out.push(`بقي بعد إعادة القراءة: ${c}`);
  if (evidence.pages && evidence.pages.read < evidence.pages.total) {
    out.push(`قُرئت ${evidence.pages.read} من ${evidence.pages.total} صفحات — قد تنقص البنود`);
  }
  return out;
}
