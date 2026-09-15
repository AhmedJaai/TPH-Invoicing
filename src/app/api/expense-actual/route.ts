/**
 * المصروف الفعلي — اشتقاقه من كشف البنك، وقيده يدوياً.
 *
 * الاشتقاق قابل لإعادة التشغيل: الحركة المقيَّدة لا تُقيَّد ثانيةً،
 * يحرسه فهرس فريد في القاعدة لا الشيفرة وحدها.
 */
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { expenses } from "@/db/schema";
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import { parseRiyals } from "@/lib/money";
import {
  deleteExpense,
  deriveExpensesFromBank,
  recordManualExpense,
} from "@/services/expense.service";
import { isExpenseCategory } from "@/lib/expenses";
import type { TxCategory } from "@/lib/bank/rules";

export const runtime = "nodejs";

interface Body {
  action?: "derive" | "record" | "delete";
  month?: string;
  id?: string;
  occurredOn?: string;
  category?: TxCategory;
  label?: string;
  amount?: string;
  note?: string;
  /** أقرّ صاحبه بأنّه مصروفٌ ثانٍ بالقيمة نفسها */
  confirmDuplicate?: boolean;
}

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("expense-actual", "expense:edit");
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

  if (body.action === "derive") {
    const month = body.month?.match(/^\d{4}-\d{2}$/) ? body.month : undefined;
    const r = await deriveExpensesFromBank(user.id, month);
    return NextResponse.json({
      ok: true,
      ...r,
      message:
        r.created === 0
          ? "لا جديد — كل حركة مصنَّفة مقيَّدة أصلاً."
          : `قُيّد ${r.created} مصروفاً، منها ${r.linkedToRecurring} مربوطة بمصروف متوقَّع.`,
    });
  }

  if (body.action === "delete") {
    if (!body.id) return NextResponse.json({ error: "حدّد المصروف" }, { status: 400 });
    const outcome = await deleteExpense(user.id, body.id);
    if (outcome === "NOT_FOUND") {
      return NextResponse.json({ error: "حُذف هذا القيد من قبل — حدّث الصفحة" }, { status: 404 });
    }
    if (outcome === "BANK_DERIVED") {
      return NextResponse.json(
        { error: "هذا القيد مشتقٌّ من كشف البنك ويعود عند الاشتقاق — احذف الآخر، أو صحّح تصنيف الحركة" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, message: "حُذف القيد — وأثره في سجلّ التدقيق" });
  }

  const label = body.label?.trim();
  if (!label) return NextResponse.json({ error: "اكتب اسم المصروف" }, { status: 400 });

  if (!body.category || !isExpenseCategory(body.category)) {
    return NextResponse.json(
      { error: "اختر تصنيفاً يصحّ أن يكون مصروفاً — سداد المورّد محسوبٌ في المشتريات" },
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
        { error: `قُيّد «${label}» بالمبلغ نفسه قبل لحظات — إن كان مصروفاً ثانياً فأكّد ذلك`, duplicateOf: twin.id },
        { status: 409 },
      );
    }
  }

  const id = await recordManualExpense(user.id, {
    occurredOn: body.occurredOn,
    category: body.category,
    label,
    amountMinor,
    note: body.note?.trim() || undefined,
  });

  /* التدقيق في recordManualExpense — كان يُكتب هنا ثانيةً فيُقيَّد الحدث مرّتين */

  return NextResponse.json({ ok: true, id, message: `قُيّد «${label}»` });
}
