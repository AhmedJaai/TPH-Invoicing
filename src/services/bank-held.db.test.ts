import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { bankImports, bankTransactions, expenses, users } from "@/db/schema";
import { caught, day, withRollback } from "@/test/db";
import { HeldRowRefused, holdRows, resolveHeldRow, type HeldRowInput } from "./bank-held.service";
import type { Tx } from "./types";

async function setup(tx: Tx) {
  const [u] = await tx.insert(users).values({ email: `held-${Math.random()}@test.local` }).returning({ id: users.id });
  const [imp] = await tx.insert(bankImports).values({ fileName: `held-${Math.random()}.xlsx` }).returning({ id: bankImports.id });
  const [known] = await tx.insert(bankTransactions).values({
    bankImportId: imp.id, valueDate: day("2099-08-10"), amountMinor: 1500_00, direction: "DEBIT",
    description: "حوالة إلى أفال", operationRef: "FT99001", identityKey: `REF:~|FT99001-${Math.random()}`,
  }).returning({ id: bankTransactions.id });
  const row = (kind: HeldRowInput["kind"]): HeldRowInput => ({
    kind, bankImportId: imp.id, bankAccountId: null, againstTransactionId: known.id,
    reason: "بلا مرجعٍ ويشبه حركةً لها مرجع", valueDate: day("2099-08-10"),
    description: "حوالة إلى أفال", beneficiaryRaw: null, transactionType: null,
    amountMinor: 1500_00, direction: "DEBIT", operationRef: null,
  });
  return { actorId: u.id, known: known.id, row };
}

const openHeld = async (tx: Tx) => Number((await tx.execute<{ n: number }>(sql`
  select count(*)::int as n from bank_held_rows where resolved_at is null and amount_minor = 150000
`)).rows[0].n);

describe("صفوفُ الكشف الملتبسة تُحفظ لقرار إنسان", () => {
  it("تُحفظ مرّةً — وإعادةُ الاستيراد لا تكرّرها، ولا تعيدها بعد «هي نفسها»", () =>
    withRollback(async (tx) => {
      const { actorId, row } = await setup(tx);
      expect(await holdRows([row("AMBIGUOUS")], tx)).toBe(1);
      expect(await holdRows([row("AMBIGUOUS")], tx)).toBe(0);
      const [{ id }] = (await tx.execute<{ id: string }>(sql`select id from bank_held_rows where amount_minor = 150000`)).rows;
      await resolveHeldRow(tx, id, "SAME", actorId);
      expect(await holdRows([row("AMBIGUOUS")], tx)).toBe(0);
      expect(await openHeld(tx)).toBe(0);
    }));

  it("«حركةٌ أخرى» تُضيفها حركةً بهويّة الوقائع فتدخل الطابور", () =>
    withRollback(async (tx) => {
      const { actorId, row } = await setup(tx);
      await holdRows([row("AMBIGUOUS")], tx);
      const [{ id }] = (await tx.execute<{ id: string }>(sql`select id from bank_held_rows where amount_minor = 150000`)).rows;
      const out = await resolveHeldRow(tx, id, "ADDED", actorId);
      const [t] = await tx.select({ key: bankTransactions.identityKey, st: bankTransactions.matchStatus, amount: bankTransactions.amountMinor })
        .from(bankTransactions).where(eq(bankTransactions.id, out.transactionId!));
      expect(t.key?.startsWith("FACT:")).toBe(true);
      expect(t).toMatchObject({ st: "UNMATCHED", amount: 1500_00 });
      expect(await caught(resolveHeldRow(tx, id, "ADDED", actorId))).toBeInstanceOf(HeldRowRefused);
    }));

  it("والمتضاربُ لا يُضاف — مرجعُه لحركةٍ أخرى", () =>
    withRollback(async (tx) => {
      const { actorId, row } = await setup(tx);
      await holdRows([{ ...row("CONFLICT"), amountMinor: 1600_00, operationRef: "FT99001" }], tx);
      const [{ id }] = (await tx.execute<{ id: string }>(sql`select id from bank_held_rows where amount_minor = 160000`)).rows;
      expect(await caught(resolveHeldRow(tx, id, "ADDED", actorId))).toBeInstanceOf(HeldRowRefused);
      await resolveHeldRow(tx, id, "CHECKED", actorId);
    }));

  it("حركةٌ عندنا ليست في الكشف: «احذفها» تحذفها ومصروفَها، والمطابَقةُ لا تُحذف، ولا «حركةٌ أخرى»", () =>
    withRollback(async (tx) => {
      const { actorId, known, row } = await setup(tx);
      await tx.insert(expenses).values({ periodMonth: "2099-08", occurredOn: "2099-08-10", category: "BANK_FEE", label: "رسم", amountMinor: 1500_00, source: "BANK", bankTransactionId: known });
      await holdRows([row("MISSING_FROM_FILE")], tx);
      const [{ id }] = (await tx.execute<{ id: string }>(sql`select id from bank_held_rows where amount_minor = 150000`)).rows;
      expect(await caught(resolveHeldRow(tx, id, "ADDED", actorId))).toBeInstanceOf(HeldRowRefused);
      const out = await resolveHeldRow(tx, id, "REMOVED", actorId);
      expect(out.removed).toBe(true);
      expect(await tx.select().from(bankTransactions).where(eq(bankTransactions.id, known))).toHaveLength(0);
      expect(await tx.select().from(expenses).where(eq(expenses.bankTransactionId, known))).toHaveLength(0);
      expect(await openHeld(tx)).toBe(0);
    }));

  it("والمطابَقةُ بدفعة لا تُحذف — تُفكّ أوّلاً", () =>
    withRollback(async (tx) => {
      const { actorId, known, row } = await setup(tx);
      await tx.update(bankTransactions).set({ matchStatus: "MATCHED" }).where(eq(bankTransactions.id, known));
      await holdRows([row("MISSING_FROM_FILE")], tx);
      const [{ id }] = (await tx.execute<{ id: string }>(sql`select id from bank_held_rows where amount_minor = 150000`)).rows;
      expect(await caught(resolveHeldRow(tx, id, "REMOVED", actorId))).toBeInstanceOf(HeldRowRefused);
      await resolveHeldRow(tx, id, "CHECKED", actorId);
      expect(await tx.select().from(bankTransactions).where(eq(bankTransactions.id, known))).toHaveLength(1);
    }));
});
