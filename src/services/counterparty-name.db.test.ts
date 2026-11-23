import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { counterparties, users } from "@/db/schema";
import { toCanonical, type RawBankRow } from "@/lib/bank/canonical";
import { withRollback } from "@/test/db";
import { confirmCounterparty, UNNAMED_COUNTERPARTY } from "./counterparty.service";

/**
 * الاسمُ المؤقّت يُرقّى حين يُقرأ الاسم، والاسمُ الذي كتبه إنسانٌ لا يُمسّ.
 *
 * كان عمّالٌ في الرواتب «جهة بلا اسم» وأسماؤهم في الكشف:
 * الاسمُ يُكتب مرّةً من أوّل حركة ولا يُعاد.
 */
const row = (over: Partial<RawBankRow>) => toCanonical({
  valueDate: new Date("2026-08-27T00:00:00Z"), amountMinor: 3_000_00, direction: "DEBIT",
  description: "تحويل BEN ID:1000000001 مرجع1", ...over,
});

describe("اسم الجهة", () => {
  it("جهةٌ نشأت بلا اسم تأخذ اسم المستفيد حين يرد في حركةٍ لاحقة", async () => {
    await withRollback(async (tx) => {
      const [u] = await tx.insert(users).values({ email: `cp-${Date.now()}-${Math.random()}@test.local` }).returning({ id: users.id });
      const a = await confirmCounterparty({ userId: u.id, kind: "SALARY", transactions: [row({})], writer: tx });
      const name = async () => (await tx.select({ n: counterparties.displayName }).from(counterparties).where(eq(counterparties.id, a.counterpartyId)))[0].n;
      expect(await name()).toBe(UNNAMED_COUNTERPARTY);

      await confirmCounterparty({ userId: u.id, kind: "SALARY", counterpartyId: a.counterpartyId, transactions: [row({ beneficiaryRaw: "مستفيد تجريبي" })], writer: tx });
      expect(await name()).toBe("مستفيد تجريبي");

      // اسمٌ غير مؤقّت لا يُكتب فوقه من الكشف
      await confirmCounterparty({ userId: u.id, kind: "SALARY", counterpartyId: a.counterpartyId, transactions: [row({ beneficiaryRaw: "اسم آخر في الكشف" })], writer: tx });
      expect(await name()).toBe("مستفيد تجريبي");
    });
  });
});
