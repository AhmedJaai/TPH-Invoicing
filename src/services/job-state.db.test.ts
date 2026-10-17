import { describe, expect, it } from "vitest";
import { withRollback } from "@/test/db";
import { backlogFingerprint, isDue, markRan } from "./job-state.service";

describe("لا يعاد عمل خلفيّ ما لم يتغيّر شيء", () => {
  it("البصمة نفسها في الحدّ ← لا يعاد؛ وتغيّرها أو مضيّ الحدّ ← يعاد", () =>
    withRollback(async (tx) => {
      const name = `test-${Math.random()}`;
      const fp = await backlogFingerprint(tx);
      expect(await isDue(name, fp, 60_000, tx)).toBe(true);
      await markRan(name, fp, tx);
      expect(await isDue(name, fp, 60_000, tx)).toBe(false);
      expect(await isDue(name, `${fp}|changed`, 60_000, tx)).toBe(true);
      expect(await isDue(name, fp, 0, tx)).toBe(true);
    }));
});
