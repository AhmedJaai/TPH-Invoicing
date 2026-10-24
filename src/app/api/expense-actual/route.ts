/**
 * المصروف الفعلي — اشتقاقه من كشف البنك، وقيده يدوياً.
 *
 * الاشتقاق قابل لإعادة التشغيل: الحركة المقيَّدة لا تُقيَّد ثانيةً،
 * يحرسه فهرس فريد في القاعدة لا الشيفرة وحدها.
 */
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { txCategoryEnum } from "@/db/schema";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { expenses } from "@/db/schema";
import { NextResponse } from "next/server";
import { failWith, guard, respondTo } from "@/services/guard";
import { parseRiyals } from "@/lib/money";
import {
  deleteExpense,
  deriveExpensesFromBank,
  recordManualExpense,
} from "@/services/expense.service";
import { isExpenseCategory } from "@/lib/expenses";

export const runtime = "nodejs";

const Body = z.object({
  action: z.enum(["derive", "record", "delete"]).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/, "اكتب الشهر بصيغة YYYY-MM").optional(),
  id: z.string().trim().min(1).max(64).optional(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "اكتب التاريخ بصيغة YYYY-MM-DD").optional(),
  category: z.enum(txCategoryEnum.enumValues).optional(),
  label: z.string().max(200).optional(),
  amount: z.string().max(30).optional(),
  note: z.string().max(500).optional(),
  /** أقرّ صاحبه بأنّه مصروفٌ ثانٍ بالقيمة نفسها */
  confirmDuplicate: z.boolean().optional(),
});
type Body = z.infer<typeof Body>;

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("expense-actual", "expense:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  const body: Body = read.body;

  if (body.action === "derive") {
    const month = body.month?.match(/^\d{4}-\d{2}$/) ? body.month : undefined;
    const r = await deriveExpensesFromBank(user.id, month);
    /* ما تُرك في شهرٍ مقفل يُقال — لا يُحسب «لا جديد» وهو جديدٌ لم يُقيَّد */
    const closedNote = r.skippedClosedMonth > 0
      ? ` وترك ${r.skippedClosedMonth} في شهر مقفل، تسجّل إن أعدت فتحه.`
      : "";
    return NextResponse.json({
      ok: true,
      ...r,
      message:
        (r.created === 0
          ? "لا جديد، فكل حركة مصنّفة في شهر مفتوح سُجّلت من قبل."
          : `سُجّل ${r.created} مصروفاً، منها ${r.linkedToRecurring} مربوطة بمصروف متوقع.`) + closedNote,
    });
  }

  if (body.action === "delete") {
    if (!body.id) return NextResponse.json({ error: "حدّد المصروف" }, { status: 400 });
    let outcome;
    try {
      outcome = await deleteExpense(user.id, body.id);
    } catch (e) {
      /* الشهرُ المقفل 409 بجملته — وما عداه عطبٌ برقم مرجع */
      return failWith(e, "expense-actual");
    }
    if (outcome === "NOT_FOUND") {
      return NextResponse.json({ error: "هذا المصروف حُذف من قبل. حدّث الصفحة." }, { status: 404 });
    }
    if (outcome === "BANK_DERIVED") {
      return NextResponse.json(
        { error: "هذا المصروف مأخوذ من كشف البنك، وسيظهر من جديد إن حذفته. احذف المصروف الآخر، أو صحّح تصنيف الحركة." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, message: "حُذف المصروف، وأثره في سجل التدقيق." });
  }

  const label = body.label?.trim();
  if (!label) return NextResponse.json({ error: "اكتب اسم المصروف" }, { status: 400 });

  if (!body.category || !isExpenseCategory(body.category)) {
    return NextResponse.json(
      { error: "اختر للمصروف تصنيفاً مناسباً. سداد المورّد يُحسب ضمن المشتريات." },
      { status: 400 },
    );
  }

  if (!body.occurredOn?.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return NextResponse.json({ error: "اكتب تاريخاً صالحاً" }, { status: 400 });
  }

  const amountMinor = parseRiyals(body.amount ?? "");
  if (amountMinor === null || amountMinor <= 0) {
    return NextResponse.json({ error: "اكتب مبلغاً صالحاً" }, { status: 400 });
  }

  /*
    ضغطتان على «قيّده» كانتا مصروفين بلا سؤال، ولا باب حذف. فالمصروف نفسه
    (البند والمبلغ واليوم) خلال دقيقتين يُسأل عنه — لا يُمنع: مصروفان
    حقيقيّان بالقيمة نفسها في يومٍ واحد ممكنان، فيُقرّ بهما صاحبهما.
  */
  if (!body.confirmDuplicate) {
    const [twin] = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(and(
        eq(expenses.label, label),
        eq(expenses.amountMinor, amountMinor),
        eq(expenses.occurredOn, body.occurredOn),
        gt(expenses.createdAt, new Date(Date.now() - 2 * 60 * 1000)),
      ))
      .limit(1);
    if (twin) {
      return NextResponse.json(
        { error: `سُجّل «${label}» بالمبلغ نفسه قبل لحظات. إن كان مصروفاً آخر فأكّد ذلك.`, duplicateOf: twin.id },
        { status: 409 },
      );
    }
  }

  let id: string;
  try {
    id = await recordManualExpense(user.id, {
      occurredOn: body.occurredOn,
      category: body.category,
      label,
      amountMinor,
      note: body.note?.trim() || undefined,
    });
  } catch (e) {
    /* «شهر 2026-07 مقفل…» يُقال 409 — كان يسقط ٥٠٠ بلا جملة */
    return failWith(e, "expense-actual");
  }

  /* التدقيق في recordManualExpense — كان يُكتب هنا ثانيةً فيُقيَّد الحدث مرّتين */

  return NextResponse.json({ ok: true, id, message: `سُجّل «${label}»` });
}
