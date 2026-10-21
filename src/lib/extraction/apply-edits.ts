/** ما صحّحه الإنسان في بطاقة الرفع فوق ما قرأه النموذج (`upload-review.service.ts`). */
import { formatRiyals, parseRiyals } from "@/lib/money";
import { settlePreVatDiscount } from "./discount";
import { normalizeDocumentDate } from "@/lib/document-date";
import type { ExtractionResult } from "./schema";

export interface ReviewEdits {
  supplierId?: string | null;
  invoiceNumber?: string;
  invoiceDate?: string;
  vat?: string;
  total?: string;
  /** الخصمُ قبل الضريبة كما كتبه الإنسان — «٠» أو فراغٌ مقصود: لا خصم */
  discount?: string;
}

/** ما كتبه الإنسان فوق ما قرأه النموذج — وثقتُه كاملة، فلا يبقى «راجِعه» على ما صحّحه. */
export function applyEdits(x: ExtractionResult, e: ReviewEdits): ExtractionResult {
  const out: ExtractionResult = { ...x, confidence: { ...x.confidence } };
  const clean = (v: string) => v.replace(/[,\s]/g, "");
  if (e.invoiceNumber !== undefined && e.invoiceNumber.trim() !== x.invoiceNumber.trim()) {
    out.invoiceNumber = e.invoiceNumber.trim();
    out.confidence.invoiceNumber = 1;
  }
  if (e.invoiceDate !== undefined) {
    const iso = normalizeDocumentDate(e.invoiceDate);
    if (iso && iso !== x.invoiceDate) { out.invoiceDate = iso; out.confidence.invoiceDate = 1; }
  }
  const amountChanged = (typed: string | undefined, read: string) => typed !== undefined && clean(typed) !== "" && clean(typed) !== clean(read);
  if (amountChanged(e.vat, x.vatAmount)) out.vatAmount = clean(e.vat!);
  if (amountChanged(e.total, x.totalAmount)) out.totalAmount = clean(e.total!);
  /*
    الخصم: الوعاءُ = المجموعُ قبل الخصم − ما كُتب. والمجموعُ من القراءة نفسها (قبل الخصم
    إن قُرئ كذلك، أو الوعاءُ + الخصمُ المقروء إن قُرئ بعده) — فلا يُخصم مرّتين.
  */
  if (e.discount !== undefined && clean(e.discount) !== clean(x.discountAmount ?? "")) {
    const read = settlePreVatDiscount(x);
    const gross = read.discount?.grossMinor ?? parseRiyals(x.subtotalAmount);
    const typed = parseRiyals(clean(e.discount) || "0") ?? 0;
    if (gross !== null && typed >= 0 && typed < gross) {
      out.discountAmount = typed > 0 ? formatRiyals(typed) : "";
      out.subtotalAmount = formatRiyals(gross - typed);
    }
  }
  if (out.vatAmount !== x.vatAmount || out.totalAmount !== x.totalAmount || out.discountAmount !== x.discountAmount) out.confidence.amounts = 1;
  return out;
}

