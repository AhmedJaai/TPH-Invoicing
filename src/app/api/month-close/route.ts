/**
 * إقفال الشهر.
 *
 * الإقفال ليس زرّاً بل قائمة تحقّق تُقرأ. والمانع يُفرَّق عن التنبيه:
 * المانع خللٌ في البيانات لا يجوز إقفال شهر عليه، والتنبيه واقعٌ يقرّ به
 * المالك ويمضي.
 *
 * وبعد الإقفال يُقفَل الشهر فعلاً: كلُّ ما يكتب مالاً فيه يُرفض — في طبقة
 * الخدمات (`month-guard.ts`) وفي القاعدة (الهجرة ٠٢٨).
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bankAccounts, monthCloses, reconciliationPeriods } from "@/db/schema";
import { parseRiyals } from "@/lib/money";
import { guard, respondTo } from "@/services/guard";
import { can } from "@/lib/permissions";
import { buildMonthClose } from "@/lib/month-close";
import { gatherMonthFacts } from "@/lib/month-close-facts";
import { recordAudit } from "@/lib/audit";
import { WARNING, countNoun } from "@/lib/arabic";

export const runtime = "nodejs";
export const maxDuration = 60;

const MONTH_RE = /^\d{4}-\d{2}$/;

interface Body {
  month: string;
  action?: "check" | "close" | "reopen" | "balances";
  /** رصيدا الشهر كما في كشف البنك — نصّاً يُقرأ في الخادم. */
  openingBalance?: string;
  closingBalance?: string;
  /** سبب مكتوب حين يُقفل الشهر وفيه تنبيهات */
  note?: string;
}

export async function POST(request: Request) {
  let user;
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
    return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة، فإن تكرّر فأبلِغ مالك الحساب." }, { status: 400 });
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

  /*
    ── رصيدا الشهر ──

    «أدخل رصيدَي أوّل المدّة» كان بلا مكانٍ يُدخلان فيه، و`reconciliation_periods`
    بلا كاتب — فالمعادلة «لا تُفحَص» كلّ شهر. والإدخال اليدويّ يغلب ما
    قُرئ من الكشف، ويُسجَّل باسم من أدخله.
  */
  if (action === "balances") {
    const openingMinor = parseRiyals(body.openingBalance ?? "");
    const closingMinor = parseRiyals(body.closingBalance ?? "");
    if (openingMinor === null || closingMinor === null) {
      return NextResponse.json({ error: "اكتب الرصيدين كما في كشف البنك — أرقاماً" }, { status: 400 });
    }
    if (existing?.status === "CLOSED") {
      return NextResponse.json({ error: "الشهر مقفل — أعِد فتحه قبل تغيير رصيديه" }, { status: 409 });
    }
    const [account] = await db.select({ id: bankAccounts.id }).from(bankAccounts).orderBy(bankAccounts.id).limit(1);
    if (!account) {
      return NextResponse.json({ error: "لا حساب بنكيّ معروف بعد — استورد كشفاً أوّلاً" }, { status: 409 });
    }
    const [y, m] = body.month.split("-").map(Number);
    const periodEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

    await db.transaction(async (t) => {
      await t.insert(reconciliationPeriods).values({
        bankAccountId: account.id,
        periodStart: `${body.month}-01`,
        periodEnd,
        openingBalanceMinor: openingMinor,
        closingBalanceMinor: closingMinor,
        reviewedById: user.id,
        reviewedAt: new Date(),
      }).onConflictDoUpdate({
        target: [reconciliationPeriods.bankAccountId, reconciliationPeriods.periodStart, reconciliationPeriods.periodEnd],
        set: { openingBalanceMinor: openingMinor, closingBalanceMinor: closingMinor, reviewedById: user.id, reviewedAt: new Date() },
      });
      await recordAudit({
        actorId: user.id,
        action: "RECONCILIATION_BALANCES_SET",
        entityType: "month_close",
        entityId: body.month,
        after: { الافتتاحي_بالهللات: openingMinor, الختامي_بالهللات: closingMinor, المصدر: "إدخالٌ يدويّ" },
      }, t);
    });

    const nextFacts = await gatherMonthFacts(body.month);
    const nextReport = buildMonthClose(nextFacts);
    return NextResponse.json({
      ok: true, report: nextReport, facts: nextFacts, status: existing?.status ?? "OPEN",
      message: "حُفظ الرصيدان وأُعيد الفحص",
    });
  }

  if (action === "check") {
    return NextResponse.json({ ok: true, report, facts, status: existing?.status ?? "OPEN" });
  }

  if (action === "reopen") {
    /* إعادة فتح شهرٍ شُهد عليه للمالك وحده — الإقفالُ شهادةٌ لا تُنقَض بصلاحية الإقفال */
    if (!can(user.role, "month:reopen")) {
      return NextResponse.json({ error: "إعادة فتح الشهر للمالك وحده" }, { status: 403 });
    }
    if (!existing || existing.status !== "CLOSED") {
      return NextResponse.json({ error: "هذا الشهر ليس مقفلاً" }, { status: 409 });
    }
    await db.update(monthCloses)
      .set({ status: "OPEN", closedAt: null, closedById: null })
      .where(eq(monthCloses.id, existing.id));

    await recordAudit({
      actorId: user.id,
      action: "MONTH_REOPENED",
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
    message: `أُقفل ${body.month}${report.warnings.length ? ` مع إقرار ${countNoun(report.warnings.length, WARNING)}` : ""}`,
  });
}
