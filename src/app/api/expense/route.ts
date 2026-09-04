/**
 * المصروفات المتكرّرة.
 *
 * كشف البنك يقول «أين ذهب المال»، وهذا يقول «كم يُتوقَّع» — فيُقابَل
 * المتوقَّع بالفعلي. والإيجار الذي يُدفع مرّة في السنة يظهر حصّته الشهرية،
 * فلا يبدو شهرٌ ضخماً وأحد عشر خفيفة.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { recurringExpenses } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { parseRiyals } from "@/lib/money";
import { recordAudit } from "@/lib/audit";
import type { TxCategory } from "@/lib/bank/rules";

export const runtime = "nodejs";

const CATEGORIES: readonly TxCategory[] = [
  "SALARY", "RENT", "ZAKAT", "UTILITY", "GOVERNMENT", "PERSONAL", "OTHER",
];
const CADENCES = ["MONTHLY", "QUARTERLY", "ANNUAL"] as const;

interface Body {
  action?: "create" | "delete";
  id?: string;
  label?: string;
  category?: TxCategory;
  /** المبلغ نصّاً بالريالات */
  amount?: string;
  cadence?: (typeof CADENCES)[number];
  note?: string;
}

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("expense", "expense:edit");
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

  if (body.action === "delete") {
    if (!body.id) return NextResponse.json({ error: "حدّد المصروف" }, { status: 400 });
    // لا يُحذف بل يُعطَّل — فيبقى ما بُني عليه من مقارنات سابقة مفهوماً
    await db
      .update(recurringExpenses)
      .set({ isActive: false })
      .where(eq(recurringExpenses.id, body.id));

    await recordAudit({
      actorId: user.id,
      action: "EXPENSE_REMOVED",
      entityType: "recurring_expense",
      entityId: body.id,
      after: { الحالة: "معطَّل" },
    });
    return NextResponse.json({ ok: true, message: "عُطّل المصروف ولم يُحذف" });
  }

  const label = body.label?.trim();
  if (!label) return NextResponse.json({ error: "اكتب اسم المصروف" }, { status: 400 });

  if (!body.category || !CATEGORIES.includes(body.category)) {
    return NextResponse.json({ error: "اختر تصنيفاً" }, { status: 400 });
  }

  const amountMinor = parseRiyals(body.amount ?? "");
  if (amountMinor === null || amountMinor <= 0) {
    return NextResponse.json({ error: "اكتب مبلغاً صالحاً" }, { status: 400 });
  }

  const cadence = body.cadence && CADENCES.includes(body.cadence) ? body.cadence : "MONTHLY";

  const [row] = await db
    .insert(recurringExpenses)
    .values({
      label,
      category: body.category,
      amountMinor,
      cadence,
      note: body.note?.trim() || null,
      createdById: user.id,
    })
    .returning({ id: recurringExpenses.id });

  await recordAudit({
    actorId: user.id,
    action: "EXPENSE_ADDED",
    entityType: "recurring_expense",
    entityId: row.id,
    after: { البند: label, المبلغ: amountMinor / 100, الدورة: cadence, التصنيف: body.category },
  });

  return NextResponse.json({ ok: true, id: row.id, message: `أُضيف «${label}»` });
}
