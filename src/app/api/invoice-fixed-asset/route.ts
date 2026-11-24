import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard, respondTo } from "@/services/guard";
import { readJson } from "@/lib/request-body";
import { InvoiceCorrectionRefused, setInvoiceFixedAsset } from "@/services/invoice-correction.service";
import { MonthClosedError } from "@/services/validation.service";

/**
 * «أصلٌ ثابت» أو «مشتريات» لفاتورةٍ مقيَّدة — حكمُ إنسان (`setInvoiceFixedAsset`).
 * الطلبُ معرّفٌ وحكمٌ وسبب؛ والشهرُ المقفل يرفض.
 */
export const runtime = "nodejs";

const Body = z.object({
  invoiceId: z.string().trim().min(1).max(64),
  isFixedAsset: z.boolean(),
  reason: z.string().trim().max(300).nullable().optional(),
}).strict();

export async function POST(request: Request) {
  try {
    const user = await guard("invoice-fixed-asset", "document:upload");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const out = await db.transaction((tx) => setInvoiceFixedAsset(tx, { ...read.body, reason: read.body.reason || null }, user.id));
    return NextResponse.json({
      ok: true,
      changed: out.changed,
      message: read.body.isFixedAsset ? "خرجت من تكلفة المبيعات (أصل ثابت أو رأس مال الافتتاح)" : "دخلت تكلفة المبيعات",
    });
  } catch (e) {
    if (e instanceof InvoiceCorrectionRefused) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof MonthClosedError) return NextResponse.json({ error: e.message }, { status: 409 });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
