import { describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { bankImports, bankTransactions, employees, expenses, monthCloses, payrollLinks, users } from "@/db/schema";
import { PayrollRefused, splitTransfer, unlinkTransfer } from "./payroll.service";
import { MonthClosedError } from "./validation.service";
import { caught, day, withRollback } from "@/test/db";
import type { Tx } from "./types";

/**
 * توزيعُ حوالات الرواتب على الموظّفين — مالٌ يغيّر قائمةَ الدخل، فحدودُه هي ما يُختبَر:
 * لا يتجاوز الحوالة، ولا يُنسب حسابُ شخصٍ لغيره، ولا يغيّر شهراً مقفلاً من بابٍ خلفيّ.
 */
async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `t-${Date.now()}-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}

async function employee(tx: Tx, name: string, bankBeneficiaryId: string | null = null): Promise<string> {
  const [e] = await tx.insert(employees).values({ name, kind: "MONTHLY", hiredOn: "2026-05-01", bankBeneficiaryId }).returning({ id: employees.id });
  return e.id;
}

/** حوالةُ راتب خارجة، ومصروفُها مقيَّدٌ لشهرٍ قد يسبق شهرَها. */
async function salaryTransfer(tx: Tx, iso: string, amountMinor: number, opts: { expenseMonth?: string; description?: string; category?: "SALARY" | "PERSONAL" } = {}): Promise<string> {
  const [imp] = await tx.insert(bankImports).values({ fileName: `dbtest-${Math.random()}.xlsx` }).returning({ id: bankImports.id });
  const [t] = await tx.insert(bankTransactions).values({
    bankImportId: imp.id, valueDate: day(iso), amountMinor, direction: "DEBIT",
    matchStatus: "IGNORED", category: opts.category ?? "SALARY", description: opts.description ?? null,
  }).returning({ id: bankTransactions.id });
  if (opts.expenseMonth) {
    await tx.insert(expenses).values({
      periodMonth: opts.expenseMonth, occurredOn: iso, category: "SALARY", label: "راتب",
      amountMinor, source: "BANK", bankTransactionId: t.id,
    });
  }
  return t.id;
}

const part = (employeeId: string, amountMinor: number | null, month = "2026-10") => ({ employeeId, month, purpose: "SALARY" as const, amountMinor, note: null });

describe("splitTransfer — توزيعُ الحوالة كلُّه أو لا شيء", () => {
  it("يوزّع على اثنين، والباقي لمن لم يُكتب مبلغه، ولا يتجاوز الحوالة", () =>
    withRollback(async (tx) => {
      const me = await someone(tx);
      const a = await employee(tx, "أ");
      const b = await employee(tx, "ب");
      const t = await salaryTransfer(tx, "2026-10-28", 5_000_00, { category: "PERSONAL" });
      expect(await splitTransfer(t, [part(a, 3_000_00), part(b, null)], me, tx)).toEqual([3_000_00, 2_000_00]);
      /* موزّعةٌ كلُّها: لا يُزاد عليها */
      expect(await caught(splitTransfer(t, [part(a, 1_00)], me, tx))).toBeInstanceOf(PayrollRefused);
    }));

  it("مجموعٌ أكبر من الحوالة يُردّ ولا يُكتب منه سطر", () =>
    withRollback(async (tx) => {
      const me = await someone(tx);
      const a = await employee(tx, "أ");
      const t = await salaryTransfer(tx, "2026-10-28", 1_000_00, { category: "PERSONAL" });
      expect(await caught(splitTransfer(t, [part(a, 600_00), part(a, 500_00)], me, tx))).toBeInstanceOf(PayrollRefused);
      const rows = await tx.select({ id: payrollLinks.id }).from(payrollLinks).where(eq(payrollLinks.bankTransactionId, t));
      expect(rows).toEqual([]);
    }));

  it("حوالةٌ إلى حساب موظّفٍ لا تُنسب لغيره", () =>
    withRollback(async (tx) => {
      const me = await someone(tx);
      const owner = await employee(tx, "صالح", "1129311518");
      const other = await employee(tx, "الوليد");
      const t = await salaryTransfer(tx, "2026-10-28", 3_000_00, { description: "SALEH BEN ID:1129311518" });
      expect(await caught(splitTransfer(t, [part(other, null)], me, tx))).toBeInstanceOf(PayrollRefused);
      expect(await splitTransfer(t, [part(owner, null)], me, tx)).toEqual([3_000_00]);
    }));

  it("شهرُ الحوالة المقفل: لا تُربط ولا يُفكّ ربطُها — بالخدمة وبالقاعدة", () =>
    withRollback(async (tx) => {
      const me = await someone(tx);
      const a = await employee(tx, "أ");
      const t = await salaryTransfer(tx, "2026-10-28", 3_000_00, { expenseMonth: "2026-10" });
      const t2 = await salaryTransfer(tx, "2026-10-29", 2_000_00, { expenseMonth: "2026-10" });
      /* الأولى مربوطةٌ قبل الإقفال، والثانية لا */
      await splitTransfer(t, [part(a, null)], me, tx);
      await tx.insert(monthCloses).values({ month: "2026-10", status: "CLOSED" });

      expect(await caught(splitTransfer(t2, [part(a, null)], me, tx))).toBeInstanceOf(MonthClosedError);
      const [link] = await tx.select({ id: payrollLinks.id }).from(payrollLinks)
        .where(and(eq(payrollLinks.bankTransactionId, t), isNull(payrollLinks.voidedAt)));
      expect(await caught(unlinkTransfer(link.id, me, tx))).toBeInstanceOf(MonthClosedError);
    }));
});
