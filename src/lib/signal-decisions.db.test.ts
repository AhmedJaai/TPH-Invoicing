import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { alertResolutions } from "@/db/schema";
import { DISMISSED, SIGNAL_PREFIXES, signalPrefix, snoozedUntil } from "./signal-decisions";
import { caught, pgErrorOf, withRollback } from "@/test/db";

/**
 * ما يقبله مسارُ القرار تقبله القاعدة.
 *
 * كان `/api/signal` يكتب `DISMISSED` و`SNOOZED:…` بمفاتيح مثل `pos-missing:2026-10-01`،
 * وقيدا الجدول (034) لا يعرفان هذا القرار ولا هذا المفتاح — فرُدّ كلُّ «أسكِتها» بـ٥٠٠ في
 * الإنتاج، ولم يكشفه اختبار: الدوالُّ الخالصة خضراء والمسارُ لم يلمس قاعدة. فيُكتَب هنا
 * لكلّ بادئةٍ مسجَّلة، بالقرارَين، على المخطّط الحقيقيّ.
 */
describe("قراراتُ الملاحظات المحسوبة تُحفَظ فعلاً", () => {
  const sample = (prefix: string) => `${prefix}:inv-95fc5de2-17ea-4a16-8b59-3145c4b28c49`;

  it("كلُّ بادئةٍ يقبلها المسار يقبلها قيدُ المفتاح، بالإسكات وبالتأجيل", async () => {
    await withRollback(async (tx) => {
      for (const prefix of SIGNAL_PREFIXES) {
        for (const key of [sample(prefix), `${prefix}:2026-10-01`]) {
          expect(signalPrefix(key)).toBe(prefix);
          for (const decision of [DISMISSED, snoozedUntil("2026-11-10")]) {
            await tx.insert(alertResolutions).values({ key, decision })
              .onConflictDoUpdate({ target: alertResolutions.key, set: { decision } });
          }
        }
      }
      const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from alert_resolutions where key like '%:2026-10-01' and decision like 'SNOOZED:%'`)).rows;
      expect(n).toBe(SIGNAL_PREFIXES.length);
    });
  });

  it("وما ليس قراراً معروفاً يبقى مرفوضاً — القيدُ وُسِّع ولم يُرخَ", async () => {
    await withRollback(async (tx) => {
      const e = await caught((async () => { await tx.insert(alertResolutions).values({ key: "pos-missing:2026-10-01", decision: "WHATEVER" }); })());
      expect(pgErrorOf(e)?.code).toBe("23514");
    });
  });
});
