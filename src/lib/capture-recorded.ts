/**
 * أمسجّلةٌ هذه الصورةُ من قبل؟ — لصاحب العمل أمام مئة صورةٍ من الفريق.
 *
 * القراءةُ محفوظةٌ لكلّ صورة منذ وصلت، فيُقابَل مورّدُها ورقمُها بما في الدفاتر بالقاعدة
 * نفسها التي تمنع التكرار عند الأرشفة (`matchSupplier` · `sameInvoiceNumber`). وأربعةُ أحوال
 * لا تُخلط:
 *
 *   RECORDED          قُيِّدت بملفّها — تكرارٌ يُترك (أو يُرفض «وصلت من قبل»).
 *   STATEMENT_NO_FILE قُيِّدت من كشف المورّد **بلا ملف** — لا تُترك: اعتمادُها يربط الملفَّ
 *                     بقيدها ولا يسجّلها ثانيةً (057).
 *   LIKELY            مورّدُها لم يُعرف، وفي الدفاتر فاتورةٌ بالرقم نفسه والإجماليّ نفسه —
 *                     ترجيحٌ يُرى بعين صاحبه، لا حكم.
 *   TWIN              صُوّرت مرّتين: صورةٌ أقدمُ منها تنتظر بالمورّد والرقم نفسيهما.
 *
 * دالّةٌ خالصة — والمالُ بالهللات.
 */
import { matchSupplier, type SupplierRecord } from "./supplier-match";
import { normalizeInvoiceNumber, sameInvoiceNumber } from "./invoice-number";
import { parseRiyals } from "./money";

export type RecordedKind = "RECORDED" | "STATEMENT_NO_FILE" | "LIKELY" | "TWIN";

export interface RecordedLabel {
  kind: RecordedKind;
  invoiceNumber: string;
  supplierName: string | null;
  /** الفاتورةُ المقيَّدة — تُفتح من الوسم */
  invoiceId: string | null;
  /** الصورةُ الأقدم ذاتُ المورّد والرقم (`TWIN`) */
  twinOf: string | null;
}

export interface CaptureReading {
  id: string;
  sellerVatNumber: string;
  supplierNameAr: string;
  supplierNameEn: string;
  invoiceNumber: string;
  totalAmount: string;
}

export interface RecordedInvoice {
  id: string;
  supplierId: string;
  supplierName: string;
  invoiceNumber: string;
  totalMinor: number;
  /** قُيِّدت من كشف المورّد ولا ملفَّ لها بعد */
  fromStatement: boolean;
}

/** الصورُ مرتّبةً من الأقدم — فالأولى بين التوأمين هي الأصل، والثانيةُ «صُوّرت مرّتين». */
export function labelRecorded(
  captures: readonly CaptureReading[],
  suppliers: readonly SupplierRecord[],
  invoices: readonly RecordedInvoice[],
): Map<string, RecordedLabel> {
  const out = new Map<string, RecordedLabel>();
  const bySupplier = new Map<string, RecordedInvoice[]>();
  for (const inv of invoices) {
    const list = bySupplier.get(inv.supplierId) ?? [];
    list.push(inv);
    bySupplier.set(inv.supplierId, list);
  }
  /** المورّدُ + الرقمُ موحَّداً ← أوّلُ صورةٍ بهما */
  const seen = new Map<string, string>();

  for (const c of captures) {
    const number = c.invoiceNumber.trim();
    if (!normalizeInvoiceNumber(number)) continue;
    const match = matchSupplier(suppliers, {
      sellerVatNumber: c.sellerVatNumber,
      supplierNameAr: c.supplierNameAr,
      supplierNameEn: c.supplierNameEn,
    });

    if (match.supplier) {
      const hit = (bySupplier.get(match.supplier.id) ?? []).find((inv) => sameInvoiceNumber(inv.invoiceNumber, number));
      if (hit) {
        out.set(c.id, {
          kind: hit.fromStatement ? "STATEMENT_NO_FILE" : "RECORDED",
          invoiceNumber: hit.invoiceNumber, supplierName: hit.supplierName, invoiceId: hit.id, twinOf: null,
        });
        continue;
      }
      const key = `${match.supplier.id}|${normalizeInvoiceNumber(number)}`;
      const first = seen.get(key);
      if (first) {
        out.set(c.id, { kind: "TWIN", invoiceNumber: number, supplierName: match.supplier.nameAr, invoiceId: null, twinOf: first });
      } else {
        seen.set(key, c.id);
      }
      continue;
    }

    /* مورّدٌ لم يُعرف: الرقمُ وحده لا يكفي (أرقامُ المورّدين تتشابه) — ومعه الإجماليُّ بالهللة */
    const total = parseRiyals(c.totalAmount);
    if (total === null || total <= 0) continue;
    const hit = invoices.find((inv) => inv.totalMinor === total && sameInvoiceNumber(inv.invoiceNumber, number));
    if (hit) {
      out.set(c.id, { kind: "LIKELY", invoiceNumber: hit.invoiceNumber, supplierName: hit.supplierName, invoiceId: hit.id, twinOf: null });
    }
  }
  return out;
}
