/**
 * قرارُ صاحب العمل في اقتراحٍ من تحليل الذكاء: معاينة، أو إقرار، أو رفض.
 *
 * الإقرار الذي يكتب مالاً (سدادٌ من حساب المالك، أو خصمُ رصيد) يحتاج
 * صلاحية اعتماد السداد — كما يحتاجها العمل اليدويّ نفسه. ولا يأخذ الخادم
 * من المتصفّح إلّا معرّف الاقتراح: الفعلُ ومبلغه محفوظان عنده.
 */
import { z } from "zod";
import { readJson } from "@/lib/request-body";
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


export async function POST(request: Request) {
  let user;
  try {
    user = await guard("ai-findings", "supplier:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const read = await readJson(request, z.object({
    findingId: z.string().trim().min(1).max(64),
    decision: z.enum(["preview", "accept", "dismiss"]),
    /* الشاشةُ ترسل `null` حين لا ملاحظة */
    note: z.string().max(2000).nullish(),
  }));
  if (!read.ok) return read.response;
  const body = read.body;

  const decision = body.decision;

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
      note: body.note ?? null,
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
