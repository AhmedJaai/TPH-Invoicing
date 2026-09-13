/**
 * تحليلُ حساب مورّدٍ بالذكاء.
 *
 * يُستدعى لمورّدٍ واحد في كلّ طلب — فيبقى تحت عمر المسار. و«حلّل الكلّ»
 * في الشاشة يمرّ على المورّدين واحداً واحداً، فلا يُقتل طلبٌ طويل صامتاً.
 * والنتيجة اقتراحاتٌ تُحفَظ، ولا يُكتب في المال شيءٌ هنا.
 */
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import { analyzeSupplier } from "@/services/supplier-analysis.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("ai-analysis", "supplier:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  let body: { supplierId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "تعذّرت قراءة الطلب" }, { status: 400 });
  }
  if (typeof body.supplierId !== "string" || body.supplierId.length === 0 || body.supplierId.length > 64) {
    return NextResponse.json({ error: "حدّد المورّد" }, { status: 400 });
  }

  const outcome = await analyzeSupplier(body.supplierId, { persist: true, actorId: user.id, deadlineMs: 48_000 });
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.reason }, { status: outcome.status });
  }

  return NextResponse.json({
    ok: true,
    summary: outcome.summary,
    count: outcome.findings.length,
    skipped: outcome.skipped ?? null,
    model: outcome.model,
    costUsd: Number(outcome.costUsd.toFixed(5)),
  });
}
