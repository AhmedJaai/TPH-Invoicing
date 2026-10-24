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
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankAccounts, monthCloses, reconciliationPeriods } from "@/db/schema";
import { parseRiyals } from "@/lib/money";
import { guard, respondTo } from "@/services/guard";
import { lockMonthForClose } from "@/services/month-guard";
import { can } from "@/lib/permissions";
import { buildMonthClose } from "@/lib/month-close";
import { gatherMonthFacts } from "@/lib/month-close-facts";
import { recordAudit } from "@/lib/audit";
import { WARNING, countNoun } from "@/lib/arabic";
import { monthEndDay } from "@/lib/riyadh-time";
import { describeError, logEvent } from "@/lib/log";
import { freezePnl } from "@/services/profit.service";
import { sealMonth } from "@/services/month-seal.service";

export const runtime = "nodejs";
export const maxDuration = 60;

const MONTH_RE = /^\d{4}-\d{2}$/;

const Body = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "اكتب الشهر بصيغة YYYY-MM"),
  action: z.enum(["check", "close", "reopen", "balances"]).optional(),
  /** رصيدا الشهر كما في كشف البنك — نصّاً يُقرأ في الخادم. */
  openingBalance: z.string().max(30).optional(),
  closingBalance: z.string().max(30).optional(),
  /** سبب مكتوب حين يُقفل الشهر وفيه تنبيهات */
  note: z.string().max(500).optional(),
});
type Body = z.infer<typeof Body>;

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("month-close", "month:close");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  const body: Body = read.body;

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
      return NextResponse.json({ error: "اكتب الرصيدين أرقاماً كما في كشف البنك" }, { status: 400 });
    }
    if (existing?.status === "CLOSED") {
      return NextResponse.json({ error: "الشهر مقفل. أعد فتحه قبل تغيير رصيديه." }, { status: 409 });
    }
    const [account] = await db.select({ id: bankAccounts.id }).from(bankAccounts).orderBy(bankAccounts.id).limit(1);
    if (!account) {
      return NextResponse.json({ error: "لا يوجد حساب بنكي معروف بعد. استورد كشف حساب أولاً." }, { status: 409 });
    }
    const periodEnd = monthEndDay(body.month);

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
        after: { الافتتاحي_بالهللات: openingMinor, الختامي_بالهللات: closingMinor, المصدر: "إدخال يدويّ" },
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
      return NextResponse.json({ error: "إعادة فتح الشهر صلاحية للمالك وحده" }, { status: 403 });
    }
    if (!existing || existing.status !== "CLOSED") {
      return NextResponse.json({ error: "هذا الشهر ليس مقفلاً" }, { status: 409 });
    }
    /* الفتحُ وأثرُه في معاملةٍ واحدة، وبشرط أنّه ما زال مقفلاً */
    const reopened = await db.transaction(async (t) => {
      await lockMonthForClose(t, body.month);
      const rows = await t.update(monthCloses)
        .set({ status: "OPEN", closedAt: null, closedById: null })
        .where(and(eq(monthCloses.id, existing.id), eq(monthCloses.status, "CLOSED")))
        .returning({ id: monthCloses.id });
      if (rows.length === 0) return false;
      await recordAudit({
        actorId: user.id,
        action: "MONTH_REOPENED",
        entityType: "month_close",
        entityId: body.month,
        before: { الحالة: "CLOSED" },
        after: { الحالة: "OPEN", السبب: body.note ?? null, ملاحظة: "أعيد فتح الشهر" },
      }, t);
      return true;
    });
    if (!reopened) {
      return NextResponse.json({ error: "هذا الشهر ليس مقفلاً، فربما فُتح من نافذة أخرى. حدّث الصفحة." }, { status: 409 });
    }

    return NextResponse.json({ ok: true, report, status: "OPEN", message: `أُعيد فتح ${body.month}` });
  }

  // ── الإقفال ──
  if (existing?.status === "CLOSED") {
    return NextResponse.json({ error: "الشهر مقفل من قبل" }, { status: 409 });
  }

  if (!report.canClose) {
    return NextResponse.json(
      {
        error: `لا يمكن إقفال الشهر: ${report.blockers[0].detail}`,
        report,
        blockers: report.blockers.map((b) => b.detail),
      },
      { status: 409 },
    );
  }

  /*
    الإقفالُ شهادة، والتنبيهُ المُقَرّ بلا سببٍ مكتوب إقرارٌ لا يُفهم بعد شهر.
    كان يُقفل «مع إقرار ٥ تنبيهات» بلا كلمة.
  */
  if (report.warnings.length > 0 && !body.note?.trim()) {
    return NextResponse.json(
      { error: `اكتب ملاحظة بسبب الإقفال مع ${countNoun(report.warnings.length, WARNING)}. تُحفظ الملاحظة في شهادة الإقفال.` },
      { status: 400 },
    );
  }

  const checklist = {
    بنود: report.items.map((i) => ({ البند: i.label, الحالة: i.state, التفصيل: i.detail })),
    تنبيهات_أُقرَّت: report.warnings.length,
    ملاحظة: body.note ?? null,
  };

  /*
    الكتابةُ وأثرُها في معاملةٍ واحدة بقفل الشهر الحصريّ: ينتظر الإقفالُ كلَّ
    كتابةٍ ماليّة بدأت قبله في هذا الشهر (`assertMonthsOpen` يأخذ القفلَ
    مشتركاً)، وما يأتي بعده يراه مقفلاً. وضغطتان متزامنتان لا تكتبان شهادتين.
  */
  const closedNow = await db.transaction(async (t) => {
    await lockMonthForClose(t, body.month);
    const rows = await t.insert(monthCloses).values({
      month: body.month,
      status: "CLOSED",
      checklist: checklist as never,
      closedById: user.id,
      closedAt: new Date(),
    }).onConflictDoUpdate({
      target: monthCloses.month,
      set: { status: "CLOSED", checklist: checklist as never, closedById: user.id, closedAt: new Date() },
      setWhere: sql`${monthCloses.status} <> 'CLOSED'`,
    }).returning({ id: monthCloses.id });
    if (rows.length === 0) return false;
    await recordAudit({
      actorId: user.id,
      action: "MONTH_CLOSED",
      entityType: "month_close",
      entityId: body.month,
      after: { ...checklist, حقائق: facts },
    }, t);
    return true;
  });
  if (!closedNow) {
    return NextResponse.json({ error: "الشهر مقفل من قبل" }, { status: 409 });
  }

  /*
    الشهرُ المقفل تقريرُه ثابت: تُجمَّد قائمةُ دخله الآن كما تُحسَب (`finance_snapshots`).
    وتعثّرُ التجميد لا يُسقط الإقفال — الشهادةُ كُتبت، والتجميدُ يُعاد من «المالية».
  */
  let frozen = true;
  try {
    await freezePnl(body.month, user.id);
  } catch (e) {
    frozen = false;
    logEvent("finance.freeze_failed", { month: body.month, ...describeError(e) });
  }

  /*
    وأرقامُه تُختم الآن كما تقولها الشاشات (`month_seals`): «عليك» في آخره، ورصيدُ كلّ حساب،
    والضريبة — ويقارنها فحصُ كلّ صباح. وتعثّرُ الختم لا يُسقط الإقفال: يختمه الفحصُ القادم.
  */
  let sealed = true;
  try {
    await sealMonth(body.month, { actorId: user.id, origin: "CLOSE" });
  } catch (e) {
    sealed = false;
    logEvent("month.seal_failed", { month: body.month, ...describeError(e) });
  }

  return NextResponse.json({
    ok: true,
    report,
    status: "CLOSED",
    message: `أُقفل ${body.month}${report.warnings.length ? ` مع إقرارك بـ${countNoun(report.warnings.length, WARNING)}` : ""}${frozen ? "" : "، لكن تعذّر تجميد تقرير الربح، فجمّده من «المالية»."}${sealed ? "" : " ولم تُحفظ أرقامه المختومة الآن، وستُحفظ في فحص الصباح."}`,
  });
}
