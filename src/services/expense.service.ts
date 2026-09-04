/**
 * خدمة المصروف الفعلي.
 *
 * تُقيّد ما صُرف فعلاً، وتقابله بما كان متوقَّعاً. وأخطر ما تحرسه أن
 * يُقيَّد سداد المورّد مصروفاً — فيصير محسوباً مرّتين: في المشتريات
 * وفي المصروفات. القرار في `lib/expenses.ts` مختبَراً، وهذه تُنفّذه.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions, expenses, recurringExpenses } from "@/db/schema";
import { createId } from "@/lib/id";
import { recordAudit } from "@/lib/audit";
import {
  deriveFromBank,
  matchRecurring,
  type BankTx,
  type Expense,
  type RecurringExpense,
} from "@/lib/expenses";

export interface DeriveResult {
  scanned: number;
  created: number;
  skippedAlreadyRecorded: number;
  skippedNotExpense: number;
  /** حركات وصفها يقول شراء بضاعة وإن صنّفتها القاعدة غير ذلك. */
  skippedGoodsPurchase: number;
  goodsPurchaseMinor: number;
  linkedToRecurring: number;
}

/**
 * يقيّد المصروفات الفعلية من حركات البنك المصنَّفة.
 *
 * قابل لإعادة التشغيل: الحركة المقيَّدة لا تُقيَّد ثانيةً — يحرسه فهرس
 * فريد في القاعدة، لا الشيفرة وحدها.
 */
export async function deriveExpensesFromBank(
  /** `null` حين يُشتقّ آلياً لا بطلب مستخدم. */
  userId: string | null,
  month?: string,
): Promise<DeriveResult> {
  const rows = await db
    .select({
      id: bankTransactions.id,
      valueDate: bankTransactions.valueDate,
      description: bankTransactions.description,
      beneficiaryRaw: bankTransactions.beneficiaryRaw,
      amountMinor: bankTransactions.amountMinor,
      direction: bankTransactions.direction,
      category: bankTransactions.category,
    })
    .from(bankTransactions)
    .where(
      month
        ? sql`to_char(${bankTransactions.valueDate}, 'YYYY-MM') = ${month}`
        : sql`true`,
    );

  const recorded = await db
    .select({ id: expenses.bankTransactionId })
    .from(expenses)
    .where(sql`${expenses.bankTransactionId} is not null`);
  const already = new Set(recorded.map((r) => r.id as string));

  const txs: BankTx[] = rows.map((r) => ({
    id: r.id,
    valueDate: r.valueDate,
    description: r.description,
    beneficiaryRaw: r.beneficiaryRaw,
    amountMinor: r.amountMinor,
    direction: r.direction as "DEBIT" | "CREDIT",
    category: r.category,
  }));

  const { candidates, goodsPurchases } = deriveFromBank(txs, already);
  const recurring = await activeRecurring();

  /*
    إدخالٌ واحد لكل الصفوف داخل معاملة، لا صفٌّ صفّاً.

    كانت ألفٌ وأربعمئة حركة تُنتج ألفاً وأربعمئة رحلة إلى القاعدة،
    ويترك الفشل في المنتصف اشتقاقاً جزئياً لا يُعرف مداه. والمعاملة
    تجعله كلّه أو لا شيء منه، والدفعة تجعله رحلةً واحدة.
  */
  let linked = 0;
  const values = candidates.map((c) => {
    const match = matchRecurring(c, recurring);
    if (match) linked++;
    return {
      id: createId(),
      periodMonth: c.periodMonth,
      occurredOn: c.occurredOn,
      category: c.category,
      label: c.label,
      amountMinor: c.amountMinor,
      source: "BANK" as const,
      bankTransactionId: c.bankTransactionId,
      recurringExpenseId: match?.id ?? null,
      createdById: userId ?? null,
    };
  });

  if (values.length > 0) {
    // تُقسَّم دفعاتٍ كي لا يتجاوز الاستعلام حدّ المعاملات في بروتوكول pg
    const CHUNK = 500;
    await db.transaction(async (tx) => {
      for (let i = 0; i < values.length; i += CHUNK) {
        await tx.insert(expenses).values(values.slice(i, i + CHUNK)).onConflictDoNothing();
      }
    });
  }

  const debits = txs.filter((t) => t.direction === "DEBIT");
  const alreadyCount = debits.filter((t) => already.has(t.id)).length;
  return {
    scanned: txs.length,
    created: candidates.length,
    skippedAlreadyRecorded: alreadyCount,
    skippedNotExpense:
      debits.length - candidates.length - alreadyCount - goodsPurchases.length,
    skippedGoodsPurchase: goodsPurchases.length,
    goodsPurchaseMinor: goodsPurchases.reduce((s, g) => s + g.amountMinor, 0),
    linkedToRecurring: linked,
  };
}

export async function activeRecurring(): Promise<RecurringExpense[]> {
  const rows = await db
    .select()
    .from(recurringExpenses)
    .where(eq(recurringExpenses.isActive, true));

  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    category: r.category,
    amountMinor: r.amountMinor,
    cadence: (r.cadence as RecurringExpense["cadence"]) ?? "MONTHLY",
    isActive: r.isActive,
  }));
}

export async function expensesOfMonth(month: string): Promise<Expense[]> {
  const rows = await db
    .select()
    .from(expenses)
    .where(eq(expenses.periodMonth, month));

  return rows.map((r) => ({
    id: r.id,
    periodMonth: r.periodMonth,
    occurredOn: r.occurredOn,
    category: r.category,
    label: r.label,
    amountMinor: r.amountMinor,
    source: r.source,
    bankTransactionId: r.bankTransactionId,
    recurringExpenseId: r.recurringExpenseId,
  }));
}

/** مصروف يدويّ — نقداً أو بغير كشف البنك. */
export async function recordManualExpense(
  userId: string,
  input: {
    occurredOn: string;
    category: Expense["category"];
    label: string;
    amountMinor: number;
    note?: string;
  },
): Promise<string> {
  if (input.amountMinor <= 0) throw new Error("المبلغ يجب أن يكون موجباً");

  const id = createId();
  const recurring = await activeRecurring();
  const match = matchRecurring(input, recurring);

  await db.insert(expenses).values({
    id,
    periodMonth: input.occurredOn.slice(0, 7),
    occurredOn: input.occurredOn,
    category: input.category,
    label: input.label,
    amountMinor: input.amountMinor,
    source: "MANUAL",
    recurringExpenseId: match?.id ?? null,
    note: input.note,
    createdById: userId,
  });

  await recordAudit({
    actorId: userId,
    action: "EXPENSE_ADDED",
    entityType: "expense",
    entityId: id,
    after: { ...input, source: "MANUAL" },
  });

  return id;
}

export async function deleteExpense(userId: string, id: string): Promise<void> {
  const [row] = await db.select().from(expenses).where(eq(expenses.id, id));
  if (!row) return;

  await db.delete(expenses).where(eq(expenses.id, id));
  await recordAudit({
    actorId: userId,
    action: "EXPENSE_REMOVED",
    entityType: "expense",
    entityId: id,
    before: row,
  });
}
