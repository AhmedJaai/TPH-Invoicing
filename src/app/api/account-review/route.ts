/**
 * «راجِع الحسابات» — المعاينةُ أوّلاً ولا تكتب، ثمّ التنفيذ.
 *
 * الطلبُ لا يحمل مالاً: معاينةٌ، أو مفاتيحُ الأزواج التي أقرّها صاحبُها.
 * والخادمُ يعيد اشتقاق كلّ زوجٍ ويقيّد الفواتير بشروطه (`account-review.service.ts`).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { guard, respondTo } from "@/services/guard";
import { previewAccountReview, runAccountReview } from "@/services/account-review.service";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  preview: z.boolean().default(true),
  echoKeys: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_-]{1,64}$/)).max(100).default([]),
});

export async function POST(request: Request) {
  try {
    const user = await guard("account-review", "payment:approve");

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "تعذّرت قراءة الطلب." }, { status: 400 });
    }
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "طلبٌ غير مفهوم." }, { status: 400 });

    if (parsed.data.preview) {
      return NextResponse.json({ ok: true, preview: await previewAccountReview(user.id) });
    }
    return NextResponse.json({ ok: true, result: await runAccountReview(user.id, parsed.data.echoKeys) });
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
