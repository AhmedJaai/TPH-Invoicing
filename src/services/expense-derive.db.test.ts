import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { bankImports, bankTransactions, monthCloses } from "@/db/schema";
import { day, withRollback } from "@/test/db";
import { deriveOpenMonths } from "./expense.service";
import type { Tx } from "./types";

async function rent(tx: Tx, iso: string, amountMinor: number): Promise<void> {
  const [imp] = await tx.insert(bankImports).values({ fileName: `derive-${Math.random()}.xlsx` }).returning({ id: bankImports.id });
  await tx.insert(bankTransactions).values({
    bankImportId: imp.id, valueDate: day(iso), amountMinor, direction: "DEBIT",
    description: "إيجار المحلّ", category: "RENT", matchStatus: "IGNORED",
  });
}

const count = async (tx: Tx, month: string) =>
  Number((await tx.execute<{ n: number }>(sql`select count(*)::int as n from expenses where period_month = ${month}`)).rows[0].n);

describe("المصروفُ يُشتقّ وحده — والشهرُ المقفل لا يُمسّ", () => {
  it("حركةُ إيجارٍ مصنَّفة تصير مصروفاً، والإعادةُ لا تُكرّر", () =>
    withRollback(async (tx) => {
      await rent(tx, "2099-06-05", 8000_00);
      const before = await count(tx, "2099-06");
      const first = await deriveOpenMonths(["2099-06"], null, tx);
      expect(first.created).toBeGreaterThanOrEqual(1);
      expect(await count(tx, "2099-06")).toBe(before + first.created);
      expect((await deriveOpenMonths(["2099-06"], null, tx)).created).toBe(0);
    }));

  it("وفي الشهر المقفل لا يُقيَّد شيء ولا يُرمى خطأ", () =>
    withRollback(async (tx) => {
      await rent(tx, "2099-07-05", 8000_00);
      await tx.insert(monthCloses).values({ month: "2099-07", status: "CLOSED" });
      const before = await count(tx, "2099-07");
      const out = await deriveOpenMonths(["2099-07"], null, tx);
      expect(out).toEqual({ created: 0, notes: [] });
      expect(await count(tx, "2099-07")).toBe(before);
    }));

  it("مصروفٌ قُيِّد بيدٍ ثمّ جاءت حركتُه — يُتبنّى ولا يُكرَّر", () =>
    withRollback(async (tx) => {
      await tx.execute(sql`
        insert into expenses (id, period_month, occurred_on, category, label, amount_minor, source)
        values (${`t-man-${Math.random()}`}, '2099-10', '2099-10-03', 'RENT', 'إيجار أكتوبر', 800000, 'MANUAL')
      `);
      await rent(tx, "2099-10-05", 8000_00);
      const before = await count(tx, "2099-10");
      const out = await deriveOpenMonths(["2099-10"], null, tx);
      expect(out.created).toBe(0);
      expect(await count(tx, "2099-10")).toBe(before);
      const [m] = (await tx.execute<{ linked: boolean }>(sql`
        select bank_transaction_id is not null as linked from expenses where period_month = '2099-10' and source = 'MANUAL'
      `)).rows;
      expect(m.linked).toBe(true);
    }));
});

