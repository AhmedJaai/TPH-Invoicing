/**
 * قيدُ فاتورةٍ من مستندٍ بيد — معاينةً (`preview`) ثمّ كتابة.
 * الحكمُ والكتابةُ في `recordDocumentByHand` وحدها؛ والمسارُ يفحص الطلب.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { guard, respondTo } from "@/services/guard";
import { RecordRefused, recordDocumentByHand } from "@/services/document-record.service";
import { MonthClosedError } from "@/services/validation.service";

export const runtime = "nodejs";

const Body = z.object({
  documentId: z.string().min(1, "لم يُذكر المستند"),
  kind: z.enum(["TAX_INVOICE", "SIMPLIFIED_INVOICE"]),
  supplierId: z.string().min(1, "اختر المورّد"),
  invoiceNumber: z.string().max(80),
  invoiceDate: z.string().max(40),
  subtotal: z.string().max(40).optional(),
  vat: z.string().max(40).optional(),
  total: z.string().min(1, "اكتب الإجماليّ").max(40),
  sellerVat: z.string().max(40).optional(),
  buyerVat: z.string().max(40).optional(),
  preview: z.boolean().default(true),
});

export async function POST(request: Request) {
  let user;
  try {
    /* القيدُ صلاحيةُ من يعتمد المستندات — كالرفع والاعتماد */
    user = await guard("document-record", "document:upload");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة." }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "طلبٌ غير مفهوم" }, { status: 400 });
  }
  const { preview, ...input } = parsed.data;

  try {
    const out = await recordDocumentByHand(user.id, input, preview);
    return NextResponse.json({
      ok: true,
      recorded: out.invoiceId !== null,
      invoiceId: out.invoiceId,
      month: out.month,
      totalMinor: out.totalMinor,
      taxStatus: out.review.taxStatus,
      inputVatStatus: out.review.inputVatStatus,
      blockers: out.review.blockers.map((b) => b.message),
      notes: out.review.findings.filter((f) => f.severity !== "BLOCKER").map((f) => f.message),
    });
  } catch (e) {
    if (e instanceof RecordRefused) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof MonthClosedError) return NextResponse.json({ error: e.message }, { status: 409 });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
