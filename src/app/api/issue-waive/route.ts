/**
 * «تجاوزه مع كتابة السبب» — لتنبيهٍ مانعٍ مفتوح على مستند.
 *
 * كان الإقفالُ و«يحتاج قرارك» يقولان «عالجه أو تجاوزه مع كتابة السبب» ولا بابَ للتجاوز:
 * وعدٌ بلا زرّ. لا يمسّ مالاً ولا فاتورة: يُغلق التنبيهَ وحده بسببه واسمِ من تجاوزه،
 * والحكمُ الضريبيّ للفاتورة باقٍ كما هو. والقرارُ في سجلّ التدقيق.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { issues } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { readJson } from "@/lib/request-body";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

const Body = z.object({
  issueId: z.string().trim().min(1).max(64),
  reason: z.string().trim().min(3, "اكتب سبب التجاوز").max(300),
}).strict();

export async function POST(request: Request) {
  try {
    const user = await guard("issue-waive", "document:upload");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const { issueId, reason } = read.body;
    const done = await db.transaction(async (t) => {
      const [row] = await t.update(issues)
        .set({ status: "WAIVED", resolvedById: user.id, resolvedAt: new Date(), waiverReason: reason })
        .where(and(eq(issues.id, issueId), eq(issues.status, "OPEN")))
        .returning({ id: issues.id, code: issues.code, message: issues.message, entityType: issues.entityType, entityId: issues.entityId });
      if (!row) return null;
      await recordAudit({
        actorId: user.id, action: "ISSUE_WAIVED", entityType: row.entityType, entityId: row.entityId,
        before: { التنبيه: row.message, الرمز: row.code, الحال: "مفتوح" },
        after: { الحال: "متجاوَز", السبب: reason },
      }, t);
      return row;
    });
    if (!done) return NextResponse.json({ error: "لم يعد هذا التنبيه مفتوحاً، فربما قُرّر فيه. حدّث الصفحة." }, { status: 409 });
    return NextResponse.json({ ok: true, message: "تُجووز التنبيه، وسببه في سجل التدقيق" });
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
