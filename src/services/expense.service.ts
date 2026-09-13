/**
 * خدمة المصروف الفعلي.
 *
 * تُقيّد ما صُرف فعلاً، وتقابله بما كان متوقَّعاً. وأخطر ما تحرسه أن
 * يُقيَّد سداد المورّد مصروفاً — فيصير محسوباً مرّتين: في المشتريات
 * وفي المصروفات. القرار في `lib/expenses.ts` مختبَراً، وهذه تُنفّذه.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions, expenses, recurringExpenses } from "@/db/schema";
import { createId } from "@/lib/id";
import { expenseEventKey } from "@/lib/expenses";
import { recordAudit } from "@/lib/audit";
import type { Tx } from "./types";
import {
  deriveFromBank,
  isExpenseCategory,
  looksLikeGoodsPurchase,
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
  /** ما تغيّر بابُه بعد إعادة تصنيف حركته. */
  updated: number;
  /** ما لم يعد مصروفاً — حُذف صفُّه المشتقّ وحُفظ نصُّه في التدقيق. */
  removed: number;
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
      /*
        بصمة الحدث لا بصمة السجلّ: القيد على الحركة وحدها لا يمنع أن
        يصل الحدث نفسه من مستندٍ رُفع، فيُقيَّد مصروفان عن دفعةٍ واحدة.
      */
      eventKey: expenseEventKey(c),
      createdById: userId ?? null,
    };
  });

  let sync = { updated: 0, removed: 0 };
  // تُقسَّم دفعاتٍ كي لا يتجاوز الاستعلام حدّ المعاملات في بروتوكول pg
  const CHUNK = 500;
  await db.transaction(async (tx) => {
    for (let i = 0; i < values.length; i += CHUNK) {
      await tx.insert(expenses).values(values.slice(i, i + CHUNK)).onConflictDoNothing();
    }
    /* وما قُيّد من قبل يتبع التصنيف الحاليّ — لا يبقى على ما كان */
    sync = await resyncBankExpenses(tx, userId, { month });

    /* ألفُ مصروفٍ قُيّد بلا أثر في التدقيق — صار له قيدٌ واحد بعدده */
    if (values.length > 0 || sync.updated > 0 || sync.removed > 0) {
      await recordAudit({
        actorId: userId,
        action: "EXPENSES_DERIVED",
        entityType: "expense",
        entityId: month ?? "all",
        after: { قُيّدت: values.length, "تغيّر بابها": sync.updated, "لم تعد مصروفاً": sync.removed },
      }, tx);
    }
  });

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
    updated: sync.updated,
    removed: sync.removed,
  };
}

/**
 * المصروف المقيَّد من البنك يتبع تصنيف حركته — لا يبقى على ما كان.
 *
 * كان الاشتقاق يُدرج ولا يحدّث ولا يحذف. فحركةٌ قُيّدت «راتباً» ثمّ
 * عرّفها أحمد «تحويلاً شخصيّاً» بقيت مصروفاً (٢٢٬٧٢٤ ريالاً)، وحركةٌ
 * صار بابُها «ضريبة رسم» بقيت «رسماً»، وشاشة المصروفات تخالف قائمة
 * الدخل لنفس الشهر.
 *
 * يُمرَّر مقبض المعاملة كي يقع مع القرار الذي غيّر التصنيف أو لا يقع.
 * والحذف هنا حذفُ صفٍّ **مشتقّ** يُعاد اشتقاقه، ويُحفَظ ما حُذف في
 * سجلّ التدقيق بنصّه.
 */
export async function resyncBankExpenses(
  tx: Tx,
  userId: string | null,
  scope: { month?: string; transactionIds?: readonly string[]; insertMissing?: boolean } = {},
): Promise<{ updated: number; removed: number; created: number }> {
  const where = scope.transactionIds
    ? inArray(expenses.bankTransactionId, [...scope.transactionIds])
    : scope.month
      ? and(eq(expenses.periodMonth, scope.month), sql`${expenses.bankTransactionId} is not null`)
      : sql`${expenses.bankTransactionId} is not null`;

  if (scope.transactionIds && scope.transactionIds.length === 0) return { updated: 0, removed: 0, created: 0 };

  const rows = await tx
    .select({
      expenseId: expenses.id,
      expenseCategory: expenses.category,
      label: expenses.label,
      amountMinor: expenses.amountMinor,
      occurredOn: expenses.occurredOn,
      txId: bankTransactions.id,
      category: bankTransactions.category,
      direction: bankTransactions.direction,
      description: bankTransactions.description,
      beneficiaryRaw: bankTransactions.beneficiaryRaw,
    })
    .from(expenses)
    .innerJoin(bankTransactions, eq(bankTransactions.id, expenses.bankTransactionId))
    .where(and(where, eq(expenses.source, "BANK")));

  const remove = rows.filter((r) =>
    r.direction !== "DEBIT"
    || !isExpenseCategory(r.category)
    || looksLikeGoodsPurchase(r.description, r.beneficiaryRaw));
  const removeIds = new Set(remove.map((r) => r.expenseId));
  const update = rows.filter((r) => !removeIds.has(r.expenseId) && r.expenseCategory !== r.category);

  if (remove.length > 0) {
    await tx.delete(expenses).where(inArray(expenses.id, remove.map((r) => r.expenseId)));
    await recordAudit({
      actorId: userId,
      action: "EXPENSE_RECLASSIFIED",
      entityType: "expense",
      entityId: scope.month ?? "reclassification",
      before: remove.map((r) => ({
        المصروف: r.expenseId, الحركة: r.txId, كان: r.expenseCategory, صار: r.category,
        المبلغ_بالهللات: r.amountMinor, التاريخ: r.occurredOn,
      })),
      after: { الفعل: "لم تعد مصروفاً بعد إعادة تصنيف حركتها", العدد: remove.length },
    }, tx);
  }

  for (const r of update) {
    await tx.update(expenses).set({ category: r.category }).where(eq(expenses.id, r.expenseId));
  }

  let created = 0;
  if (scope.insertMissing && scope.transactionIds) {
    const txs = await tx
      .select({
        id: bankTransactions.id, valueDate: bankTransactions.valueDate,
        description: bankTransactions.description, beneficiaryRaw: bankTransactions.beneficiaryRaw,
        amountMinor: bankTransactions.amountMinor, direction: bankTransactions.direction,
        category: bankTransactions.category,
      })
      .from(bankTransactions)
      .where(inArray(bankTransactions.id, [...scope.transactionIds]));
    const already = new Set(rows.filter((r) => !removeIds.has(r.expenseId)).map((r) => r.txId));
    const { candidates } = deriveFromBank(
      txs.map((t) => ({ ...t, direction: t.direction as "DEBIT" | "CREDIT" })),
      already,
    );
    if (candidates.length > 0) {
      await tx.insert(expenses).values(candidates.map((c) => ({
        id: createId(),
        periodMonth: c.periodMonth,
        occurredOn: c.occurredOn,
        category: c.category,
        label: c.label,
        amountMinor: c.amountMinor,
        source: "BANK" as const,
        bankTransactionId: c.bankTransactionId,
        eventKey: expenseEventKey(c),
        createdById: userId,
      }))).onConflictDoNothing();
      created = candidates.length;
    }
  }

  return { updated: update.length, removed: remove.length, created };
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
    /*
      وتُحفَظ للقيد اليدويّ أيضاً — لا ليمنعه قيد، بل ليُعرَض تكرارُه.
      فقيدُ الإنسان مرّتين قد يكون قصداً، والقرار له.
    */
    eventKey: expenseEventKey({
      category: input.category,
      occurredOn: input.occurredOn,
      amountMinor: input.amountMinor,
      label: input.label,
    }),
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
