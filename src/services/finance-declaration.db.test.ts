import { describe, expect, it } from "vitest";
import { financeDeclarations, monthCloses, users } from "@/db/schema";
import { createDeclaration, voidDeclaration } from "./profit.service";
import { MonthClosedError } from "./validation.service";
import { caught, pgErrorOf, withRollback } from "@/test/db";
import type { Tx } from "./types";

/**
 * «ما لا يظهر في الكشف» يغيّر قائمةَ دخل كلّ شهرٍ يغطّيه — فالشهرُ المقفل لا يُكتب فيه من هنا.
 * كان يُضاف نقدٌ على سبتمبر المقفل فيتغيّر ربحُه بعد ختمه.
 */
async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `t-${Date.now()}-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}

const cash = (fromMonth: string, toMonth: string) => ({
  kind: "OFF_BOOK" as const, category: "OTHER" as const, label: "مشتريات نقداً", amountMinor: 500_00,
  fromMonth, toMonth, bankTransactionId: null, note: null,
});

describe("finance declarations — الشهر المقفل", () => {
  it("لا يُضاف على شهرٍ مقفل ولا على مدّةٍ فيها شهرٌ مقفل، ويُضاف على المفتوح", () =>
    withRollback(async (tx) => {
      const me = await someone(tx);
      await tx.insert(monthCloses).values({ month: "2026-09", status: "CLOSED" });
      expect(await caught(createDeclaration(cash("2026-09", "2026-09"), me, tx))).toBeInstanceOf(MonthClosedError);
      expect(await caught(createDeclaration(cash("2026-08", "2026-10"), me, tx))).toBeInstanceOf(MonthClosedError);
      expect(typeof (await createDeclaration(cash("2026-10", "2026-10"), me, tx))).toBe("string");
    }));

  it("ولا يُسحب ما يغطّي شهراً أُقفل بعد إضافته", () =>
    withRollback(async (tx) => {
      const me = await someone(tx);
      const id = await createDeclaration(cash("2026-10", "2026-10"), me, tx);
      await tx.insert(monthCloses).values({ month: "2026-10", status: "CLOSED" });
      expect(await caught(voidDeclaration(id, me, tx))).toBeInstanceOf(MonthClosedError);
    }));

  it("والقاعدةُ نفسها ترفض الإدراجَ بلا الخدمة (٠٩٦)", () =>
    withRollback(async (tx) => {
      await tx.insert(monthCloses).values({ month: "2099-05", status: "CLOSED" });
      const e = pgErrorOf(await caught(tx.transaction(async (sp) => {
        await sp.insert(financeDeclarations).values({ kind: "OFF_BOOK", category: "OTHER", label: "نقد", amountMinor: 100, fromMonth: "2099-04", toMonth: "2099-06" });
      })));
      expect(e?.code).toBe("P0001");
      expect(e?.message).toMatch(/مقفل/);
    }));
});
