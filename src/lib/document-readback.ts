import { normalizeDocumentDate } from "@/lib/document-date";
import { formatRiyalsDisplay, parseRiyals } from "@/lib/money";
import { LOW_CONFIDENCE } from "@/lib/invoice-profile";

/**
 * ما قرأه النموذج بجانب ما سجّله الخادم — حقلاً حقلاً، ومع كلّ حقلٍ ثقةُ النموذج به.
 *
 * كان ملفُّ المستند يعرض القراءةَ في بطاقة، والمقيَّدَ في رأسه، وثقةَ النموذج
 * أشرطةً في آخر الصفحة بلا حقلٍ تحتها — فمن يسأل «هل هذا الرقم مقروءٌ بيقين،
 * وهل غيّره النظام؟» يجمع الجوابَ من ثلاثة مواضع. فصار صفّاً واحداً لكلّ حقل:
 * ما قرأه، وثقتُه بنفسه (رقمُ النموذج كما قاله، لا حكمُنا)، وما سُجّل، وهل اختلفا.
 *
 * دالّةٌ خالصة: لا قاعدة ولا متصفّح. والمالُ يُقارَن بالهللات لا بالنصّ.
 */

export type ReadbackField =
  | "kind" | "supplier" | "sellerVat" | "number" | "date" | "subtotal" | "vat" | "total" | "lines";

export interface ReadbackRow {
  field: ReadbackField;
  label: string;
  /** ما قرأه النموذج بنصّه — `null`: لم يُقرأ. */
  read: string | null;
  /** ما سجّله الخادم معروضاً — `null`: لا قيدَ لهذا الحقل (أو لا فاتورة). */
  recorded: string | null;
  /** ثقةُ النموذج بالحقل بين ٠ و١ كما قالها، أو `null` إن لم يقلها. */
  confidence: number | null;
  /** `low` تحت حدّ المراجعة، `ok` فوقه، `unknown` لم يقل النموذج شيئاً. */
  trust: "low" | "ok" | "unknown";
  /**
   * `same` المسجَّلُ هو المقروء · `changed` سُجّل غيرُه (صحّحه إنسانٌ أو أعاد الخادم حسابه)
   * · `unrecorded` لا قيد يُقارَن به · `unread` لم يُقرأ وسُجّل.
   */
  match: "same" | "changed" | "unrecorded" | "unread";
  money: boolean;
}

export interface ReadbackInput {
  reading: {
    kind: string | null;
    supplierName: string | null;
    sellerVat: string | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    subtotal: string | null;
    vat: string | null;
    total: string | null;
    lineCount: number;
  } | null;
  recorded: {
    kind: string;
    supplierName: string | null;
    invoice: { number: string; date: string | null; subtotalMinor: number | null; vatMinor: number | null; totalMinor: number } | null;
  };
  /** `documents.field_confidence` — مفاتيحُه `amounts` · `invoiceDate` · `invoiceNumber` · … */
  confidence: Record<string, number> | null;
  kindLabel: (kind: string) => string;
  showAmounts: boolean;
}

const CONFIDENCE_KEY: Record<ReadbackField, string> = {
  kind: "documentKind",
  supplier: "supplierName",
  sellerVat: "vatNumbers",
  number: "invoiceNumber",
  date: "invoiceDate",
  subtotal: "amounts",
  vat: "amounts",
  total: "amounts",
  lines: "lineItems",
};

const squash = (s: string) => s.replace(/[\s\-_/]/g, "").toUpperCase();

export function readback(input: ReadbackInput): ReadbackRow[] {
  const { reading: r, recorded, confidence, kindLabel, showAmounts } = input;
  const inv = recorded.invoice;

  const trustOf = (field: ReadbackField): Pick<ReadbackRow, "confidence" | "trust"> => {
    const v = confidence?.[CONFIDENCE_KEY[field]];
    if (typeof v !== "number" || !Number.isFinite(v)) return { confidence: null, trust: "unknown" };
    return { confidence: v, trust: v < LOW_CONFIDENCE ? "low" : "ok" };
  };

  const text = (field: ReadbackField, label: string, read: string | null, rec: string | null, same: (a: string, b: string) => boolean): ReadbackRow => ({
    field, label, read, recorded: rec, money: false, ...trustOf(field),
    match: rec === null ? "unrecorded" : read === null ? "unread" : same(read, rec) ? "same" : "changed",
  });

  const money = (field: ReadbackField, label: string, read: string | null, recMinor: number | null | undefined): ReadbackRow => {
    const rec = inv && recMinor !== null && recMinor !== undefined ? recMinor : null;
    const readMinor = read === null ? null : parseRiyals(read);
    return {
      field, label, read, money: true, ...trustOf(field),
      recorded: rec === null ? null : formatRiyalsDisplay(rec),
      match: rec === null ? "unrecorded" : read === null ? "unread" : readMinor === rec ? "same" : "changed",
    };
  };

  const rows: ReadbackRow[] = [
    text("kind", "النوع", r?.kind ? kindLabel(r.kind) : null, kindLabel(recorded.kind), (a, b) => a === b),
    text("supplier", "المورّد", r?.supplierName ?? null, recorded.supplierName, (a, b) => a.trim() === b.trim()),
    /* الرقمُ الضريبيّ لا يُقيَّد في الفاتورة بعمودٍ يُعرض هنا — فلا يُقارَن، ويُقال ما قُرئ وثقتُه */
    text("sellerVat", "الرقم الضريبي للبائع", r?.sellerVat ?? null, null, () => true),
    text("number", "رقم الفاتورة", r?.invoiceNumber ?? null, inv?.number || null, (a, b) => squash(a) === squash(b)),
    text("date", "التاريخ", r?.invoiceDate ?? null, inv?.date ?? null, (a, b) => (normalizeDocumentDate(a) ?? a) === b),
  ];
  if (showAmounts) {
    rows.push(
      money("subtotal", "قبل الضريبة", r?.subtotal ?? null, inv?.subtotalMinor),
      money("vat", "الضريبة", r?.vat ?? null, inv?.vatMinor),
      money("total", "الإجمالي", r?.total ?? null, inv?.totalMinor),
    );
  }
  rows.push({
    field: "lines", label: "البنود", money: false, ...trustOf("lines"),
    read: r && r.lineCount > 0 ? String(r.lineCount) : null, recorded: null, match: "unrecorded",
  });
  return rows;
}

/** ملخّصٌ في سطر: كم حقلاً ضعيفاً، وكم غيّره القيد — لرأس الجدول. */
export function readbackSummary(rows: readonly ReadbackRow[]): { low: number; changed: number; unknownTrust: boolean } {
  return {
    low: rows.filter((x) => x.trust === "low").length,
    changed: rows.filter((x) => x.match === "changed").length,
    unknownTrust: rows.every((x) => x.trust === "unknown"),
  };
}
