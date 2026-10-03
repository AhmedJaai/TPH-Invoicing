/**
 * يعيد حكمَ الرفع بعد تعديل الإنسان (`upload-review.service.ts`) — بلا قراءةٍ ثانية.
 * الطلبُ بصمةُ الملفّ وما صحّحه نصّاً؛ والقراءةُ من الخادم.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { guard, respondTo } from "@/services/guard";
import { readJson } from "@/lib/request-body";
import { reviewUpload, UploadReviewMissing } from "@/services/upload-review.service";

export const runtime = "nodejs";

const Text = (n: number) => z.string().max(n).optional();
const Body = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  originalFileName: z.string().min(1).max(300),
  supplierId: z.string().trim().min(1).max(64).nullish(),
  invoiceNumber: Text(120),
  invoiceDate: Text(40),
  vat: Text(40),
  total: Text(40),
}).strict();

export async function POST(request: Request) {
  try {
    await guard("analyze-review", "document:upload");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const { sha256, originalFileName, ...edits } = read.body;
    const result = await reviewUpload(sha256, originalFileName, edits);
    return NextResponse.json({
      result: {
        ...result,
        supplier: result.supplier ? { id: result.supplier.id, slug: result.supplier.slug, nameAr: result.supplier.nameAr } : undefined,
        supplierCandidates: result.supplierCandidates.map((c) => ({ id: c.id, slug: c.slug, nameAr: c.nameAr })),
      },
    });
  } catch (e) {
    if (e instanceof UploadReviewMissing) return NextResponse.json({ error: e.message }, { status: 409 });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
