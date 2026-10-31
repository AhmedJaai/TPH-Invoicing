/**
 * المصروفات المتكرّرة.
 *
 * كشف البنك يقول «أين ذهب المال»، وهذا يقول «كم يُتوقَّع» — فيُقابَل
 * المتوقَّع بالفعلي. والإيجار الذي يُدفع مرّة في السنة يظهر حصّته الشهرية،
 * فلا يبدو شهرٌ ضخماً وأحد عشر خفيفة.
 */
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { txCategoryEnum } from "@/db/schema";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { recurringExpenses } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { parseRiyals } from "@/lib/money";
import { recordAudit } from "@/lib/audit";
import type { TxCategory } from "@/lib/bank/rules";
import { isoDay } from "@/lib/riyadh-time";

export const runtime = "nodejs";

const CATEGORIES: readonly TxCategory[] = [
  "SALARY", "RENT", "ZAKAT", "UTILITY", "GOVERNMENT", "PERSONAL", "OTHER",
];
const CADENCES = ["MONTHLY", "QUARTERLY", "ANNUAL"] as const;

const Body = z.object({
  action: z.enum(["create", "delete", "activate"]).optional(),
  id: z.string().trim().min(1).max(64).optional(),
  label: z.string().max(200).optional(),
  category: z.enum(txCategoryEnum.enumValues).optional(),
  /** المبلغ نصّاً بالريالات */
  amount: z.string().max(30).optional(),
  cadence: z.enum(CADENCES).optional(),
  note: z.string().max(500).optional(),
  /**
   * أوّلُ استحقاقٍ (YYYY-MM-DD) — اختياريّ. منه يُعرف يومُ الشهريّ وشهرُ
   * الربعيّ والسنويّ، فيقع في «النقد القادم» في موضعه. وبدونه يُقال
   * «يومٌ غير محدَّد» ولا يُخترَع له يوم.
   */
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "اكتب التاريخ بصيغة YYYY-MM-DD").optional(),
});
type Body = z.infer<typeof Body>;

export async function POST(request: Request) {
  /* الطلبُ كلُّه لا الحارسُ وحده: خطأُ عملٍ معروف (شهرٌ مقفل، قيدٌ في القاعدة) يُقال بنصّه لا ٥٠٠ */
  try {
    return await handle(request);
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}

async function handle(request: Request) {
  const user = await guard("expense", "expense:edit");

  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  const body: Body = read.body;

  if (body.action === "delete") {
    if (!body.id) return NextResponse.json({ error: "حدّد المصروف" }, { status: 400 });
    // لا يُحذف بل يُعطَّل — فيبقى ما بُني عليه من مقارنات سابقة مفهوماً
    /* والأثرُ في معاملة التعطيل؛ ومعرّفٌ لا مصروفَ له لا يُقال عنه «عُطّل» */
    const id = body.id;
    const row = await db.transaction(async (t) => {
      const [r] = await t.update(recurringExpenses).set({ isActive: false })
        .where(eq(recurringExpenses.id, id)).returning({ label: recurringExpenses.label });
      if (!r) return null;
      await recordAudit({
        actorId: user.id,
        action: "EXPENSE_REMOVED",
        entityType: "recurring_expense",
        entityId: id,
        after: { البند: r.label, الحالة: "معطّل" },
      }, t);
      return r;
    });
    if (!row) return NextResponse.json({ error: "المصروف غير موجود. حدّث الصفحة." }, { status: 404 });
    return NextResponse.json({ ok: true, message: `عُطّل «${row.label}» ولم يُحذف` });
  }

  /* المعطَّل يُعاد — نقرةٌ خاطئة على «عطّله» لم يكن لها رجوع */
  if (body.action === "activate") {
    if (!body.id) return NextResponse.json({ error: "حدّد المصروف" }, { status: 400 });
    const id = body.id;
    const row = await db.transaction(async (t) => {
      const [r] = await t.update(recurringExpenses).set({ isActive: true })
        .where(eq(recurringExpenses.id, id)).returning({ label: recurringExpenses.label });
      if (!r) return null;
      await recordAudit({
        actorId: user.id,
        action: "EXPENSE_REACTIVATED",
        entityType: "recurring_expense",
        entityId: id,
        after: { البند: r.label, الحالة: "مفعّل" },
      }, t);
      return r;
    });
    if (!row) return NextResponse.json({ error: "المصروف غير موجود. حدّث الصفحة." }, { status: 404 });
    return NextResponse.json({ ok: true, message: `أُعيد «${row.label}» إلى المصروفات المتوقعة` });
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

  let startsOn: string | null = null;
  if (body.startsOn) {
    const d = new Date(`${body.startsOn}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.startsOn) || Number.isNaN(d.getTime()) || isoDay(d) !== body.startsOn) {
      return NextResponse.json({ error: "تاريخ أول استحقاق غير صالح" }, { status: 400 });
    }
    startsOn = body.startsOn;
  }

  /* البابُ بعد التحقّق — يُثبَّت لأنّ التضييق لا يعبر إلى داخل المعاملة */
  const category = body.category;
  const row = await db.transaction(async (t) => {
    const [inserted] = await t
      .insert(recurringExpenses)
      .values({
        label,
        category,
        amountMinor,
        cadence,
        startsOn,
        note: body.note?.trim() || null,
        createdById: user.id,
      })
      .returning({ id: recurringExpenses.id });
    await recordAudit({
      actorId: user.id,
      action: "EXPENSE_ADDED",
      entityType: "recurring_expense",
      entityId: inserted.id,
      after: { البند: label, المبلغ_بالهللة: amountMinor, الدورة: cadence, التصنيف: category, أوّل_استحقاق: startsOn },
    }, t);
    return inserted;
  });

  return NextResponse.json({ ok: true, id: row.id, message: `أُضيف «${label}»` });
}
