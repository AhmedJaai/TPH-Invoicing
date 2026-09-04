/**
 * المصروف الفعلي — اشتقاقه من كشف البنك، وقيده يدوياً.
 *
 * الاشتقاق قابل لإعادة التشغيل: الحركة المقيَّدة لا تُقيَّد ثانيةً،
 * يحرسه فهرس فريد في القاعدة لا الشيفرة وحدها.
 */
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
}

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("expense-actual", "bank:view");
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
    await deleteExpense(user.id, body.id);
    return NextResponse.json({ ok: true, message: "حُذف القيد" });
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

  const id = await recordManualExpense(user.id, {
    occurredOn: body.occurredOn,
    category: body.category,
    label,
    amountMinor,
    note: body.note?.trim() || undefined,
  });

  return NextResponse.json({ ok: true, id, message: `قُيّد «${label}»` });
}
