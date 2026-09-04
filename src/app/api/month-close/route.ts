/**
 * إقفال الشهر.
 *
 * الإقفال ليس زرّاً بل قائمة تحقّق تُقرأ. والمانع يُفرَّق عن التنبيه:
 * المانع خللٌ في البيانات لا يجوز إقفال شهر عليه، والتنبيه واقعٌ يقرّ به
 * المالك ويمضي.
 *
 * وبعد الإقفال يُقفَل الشهر فعلاً: واجهة الأرشفة ترفض إضافة مستند إليه.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { monthCloses } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { buildMonthClose } from "@/lib/month-close";
import { gatherMonthFacts } from "@/lib/month-close-facts";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

const MONTH_RE = /^\d{4}-\d{2}$/;

interface Body {
  month: string;
  action?: "check" | "close" | "reopen";
  /** سبب مكتوب حين يُقفل الشهر وفيه تنبيهات */
  note?: string;
}

export async function POST(request: Request) {  let user;
  try {
    user = await guard("month-close", "month:close");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  if (!MONTH_RE.test(body.month ?? "")) {
    return NextResponse.json({ error: "شهر غير صالح" }, { status: 400 });
  }

  const action = body.action ?? "check";
  const facts = await gatherMonthFacts(body.month);
  const report = buildMonthClose(facts);

  const [existing] = await db
    .select({ id: monthCloses.id, status: monthCloses.status, closedAt: monthCloses.closedAt })
    .from(monthCloses)
    .where(eq(monthCloses.month, body.month))
    .limit(1);

  if (action === "check") {
    return NextResponse.json({ ok: true, report, facts, status: existing?.status ?? "OPEN" });
  }

  if (action === "reopen") {
    if (!existing || existing.status !== "CLOSED") {
      return NextResponse.json({ error: "هذا الشهر ليس مقفلاً" }, { status: 409 });
    }
    await db.update(monthCloses)
      .set({ status: "OPEN", closedAt: null, closedById: null })
      .where(eq(monthCloses.id, existing.id));

    await recordAudit({
      actorId: user.id,
      action: "MONTH_CLOSED",
      entityType: "month_close",
      entityId: body.month,
      before: { الحالة: "CLOSED" },
      after: { الحالة: "OPEN", السبب: body.note ?? null, ملاحظة: "أُعيد فتح الشهر" },
    });

    return NextResponse.json({ ok: true, report, status: "OPEN", message: `أُعيد فتح ${body.month}` });
  }

  // ── الإقفال ──
  if (existing?.status === "CLOSED") {
    return NextResponse.json({ error: "الشهر مقفل بالفعل" }, { status: 409 });
  }

  if (!report.canClose) {
    return NextResponse.json(
      {
        error: `لا يمكن الإقفال: ${report.blockers[0].detail}`,
        report,
        blockers: report.blockers.map((b) => b.detail),
      },
      { status: 409 },
    );
  }

  const checklist = {
    بنود: report.items.map((i) => ({ البند: i.label, الحالة: i.state, التفصيل: i.detail })),
    تنبيهات_أُقرَّت: report.warnings.length,
    ملاحظة: body.note ?? null,
  };

  if (existing) {
    await db.update(monthCloses)
      .set({ status: "CLOSED", checklist: checklist as never, closedById: user.id, closedAt: new Date() })
      .where(eq(monthCloses.id, existing.id));
  } else {
    await db.insert(monthCloses).values({
      month: body.month,
      status: "CLOSED",
      checklist: checklist as never,
      closedById: user.id,
      closedAt: new Date(),
    });
  }

  await recordAudit({
    actorId: user.id,
    action: "MONTH_CLOSED",
    entityType: "month_close",
    entityId: body.month,
    after: { ...checklist, حقائق: facts },
  });

  return NextResponse.json({
    ok: true,
    report,
    status: "CLOSED",
    message: `أُقفل ${body.month}${report.warnings.length ? ` مع إقرار ${report.warnings.length} تنبيهاً` : ""}`,
  });
}
