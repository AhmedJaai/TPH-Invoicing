/** ما صحّحه الإنسان في بطاقة الرفع فوق ما قرأه النموذج (`upload-review.service.ts`). */
import { normalizeDocumentDate } from "@/lib/document-date";
import type { ExtractionResult } from "./schema";

export interface ReviewEdits {
  supplierId?: string | null;
  invoiceNumber?: string;
  invoiceDate?: string;
  vat?: string;
  total?: string;
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
  if (out.vatAmount !== x.vatAmount || out.totalAmount !== x.totalAmount) out.confidence.amounts = 1;
  return out;
}

