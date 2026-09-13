/**
 * قرارُ صاحب العمل في اقتراحٍ من تحليل الذكاء: معاينة، أو إقرار، أو رفض.
 *
 * الإقرار الذي يكتب مالاً (سدادٌ من حساب المالك، أو خصمُ رصيد) يحتاج
 * صلاحية اعتماد السداد — كما يحتاجها العمل اليدويّ نفسه. ولا يأخذ الخادم
 * من المتصفّح إلّا معرّف الاقتراح: الفعلُ ومبلغه محفوظان عنده.
 */
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import { can } from "@/lib/permissions";
import {
  actionTouchesMoney,
  decideFinding,
  FindingDecisionError,
  loadFinding,
} from "@/services/supplier-analysis.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DECISIONS = new Set(["preview", "accept", "dismiss"]);

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("ai-findings", "supplier:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  let body: { findingId?: unknown; decision?: unknown; note?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "تعذّرت قراءة الطلب" }, { status: 400 });
  }

  if (typeof body.findingId !== "string" || typeof body.decision !== "string" || !DECISIONS.has(body.decision)) {
    return NextResponse.json({ error: "طلبٌ ناقص" }, { status: 400 });
  }
  const decision = body.decision as "preview" | "accept" | "dismiss";

  try {
    if (decision === "accept") {
      const finding = await loadFinding(body.findingId);
      if (actionTouchesMoney(finding.action) && !can(user.role, "payment:approve")) {
        return NextResponse.json(
          { error: "إقرار هذا الاقتراح يكتب سداداً، وهو لمن يعتمد السداد — اطلبه من المالك" },
          { status: 403 },
        );
      }
    }

    const result = await decideFinding({
      findingId: body.findingId,
      decision,
      note: typeof body.note === "string" ? body.note : null,
      userId: user.id,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof FindingDecisionError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[ai-findings]", e);
    return NextResponse.json({ error: "تعذّر حفظ القرار — لم يُكتب شيء" }, { status: 500 });
  }
}
