/**
 * قرارُ الإنسان في تنبيه «سُدّد مرّتين».
 *
 * كان البند حرجاً دائماً لا فعلَ له: طالَب صاحب العمل الجهة، أو استردّ
 * المال، أو تبيّن أنّه ليس ازدواجاً — والبند باقٍ أحمر في رأس القائمة.
 * والحرجُ الذي لا يُغلَق يعلّم تجاهلَ الحرج.
 *
 * **والخادم لا يصدّق المتصفّح في أنّها مجموعة.** يأخذ معرّفات الحركات،
 * ويقرؤها من القاعدة، ويُعيد عليها `findDoublePaid` نفسها التي تعرضها
 * الشاشة — فإن لم تخرج مجموعةً بهذه المعرّفات بعينها رُدّ الطلب.
 *
 * و`OPEN` يُعيد فتح ما حُسم خطأً — والقرار كلّه في سجلّ التدقيق.
 */
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { NextResponse } from "next/server";
import { inArray, eq } from "drizzle-orm";
import { db } from "@/db";
import { alertResolutions, bankTransactions } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { recordAudit } from "@/lib/audit";
import {
  DOUBLE_PAID_DECISIONS,
  DOUBLE_PAID_DECISION_LABEL,
  doublePaidKey,
  findDoublePaid,
  type DoublePaidDecision,
} from "@/lib/bank/double-paid";

export const runtime = "nodejs";

const Body = z.object({
  /** معرّفاتُ الحركتين (أو أكثر) اللتين خرج فيهما المال — بلا تكرار */
  transactionIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).min(2, "حدّد الحركتين اللتين خرج فيهما المال مرّتين").max(20)
    .refine((ids) => new Set(ids).size === ids.length, "حركةٌ مكرَّرة في الطلب"),
  /** «OPEN» يعيد البندَ مفتوحاً */
  decision: z.custom<DoublePaidDecision | "OPEN">(
    (v) => v === "OPEN" || (typeof v === "string" && (DOUBLE_PAID_DECISIONS as readonly string[]).includes(v)),
    "القرار غير معروف",
  ),
  note: z.string().max(2000).optional(),
});

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("alert-resolve", "bank:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  const ids = read.body.transactionIds;
  const decision: DoublePaidDecision | "OPEN" = read.body.decision;
  const reopen = decision === "OPEN";
  const note = read.body.note?.trim().slice(0, 500) || null;

  const rows = await db
    .select({
      id: bankTransactions.id,
      valueDate: bankTransactions.valueDate,
      amountMinor: bankTransactions.amountMinor,
      direction: bankTransactions.direction,
      description: bankTransactions.description,
      beneficiaryRaw: bankTransactions.beneficiaryRaw,
      category: bankTransactions.category,
      operationRef: bankTransactions.operationRef,
    })
    .from(bankTransactions)
    .where(inArray(bankTransactions.id, ids));

  const groups = findDoublePaid(rows.map((r) => ({ ...r, direction: r.direction as "DEBIT" | "CREDIT" })));
  const group = groups.find((g) => g.transactions.length === ids.length);
  if (rows.length !== ids.length || !group) {
    return NextResponse.json(
      { error: "هذه الحركات لا تُعدّ سداداً مزدوجاً الآن — ربما تغيّر تصنيفها. حدّث الصفحة." },
      { status: 409 },
    );
  }
  const key = doublePaidKey(group);

  await db.transaction(async (t) => {
    const [before] = await t.select().from(alertResolutions).where(eq(alertResolutions.key, key)).for("update");

    if (reopen) {
      await t.delete(alertResolutions).where(eq(alertResolutions.key, key));
    } else {
      await t.insert(alertResolutions)
        .values({ key, decision, note, userId: user.id })
        .onConflictDoUpdate({
          target: alertResolutions.key,
          set: { decision, note, userId: user.id, at: new Date() },
        });
    }

    await recordAudit({
      actorId: user.id,
      action: "ALERT_RESOLVED",
      entityType: "alert",
      entityId: key,
      before: before ? { القرار: before.decision, الملاحظة: before.note } : null,
      after: {
        القرار: reopen ? "أُعيد فتحه" : DOUBLE_PAID_DECISION_LABEL[decision as DoublePaidDecision],
        الملاحظة: note,
        الجهة: group.payee,
        اليوم: group.day,
        الزائد: group.excessMinor,
        المراجع: group.transactions.map((x) => x.operationRef),
      },
    }, t);
  });

  return NextResponse.json({
    ok: true,
    key,
    message: reopen
      ? "أُعيد فتح التنبيه"
      : decision === "CLAIMED"
        ? "حُفظ: طُولبت الجهة — يبقى التنبيه بحالٍ أهدأ حتى يعود المال"
        : `حُفظ: ${DOUBLE_PAID_DECISION_LABEL[decision as DoublePaidDecision]} — خرج التنبيه من «يحتاج قرارك»`,
  });
}
