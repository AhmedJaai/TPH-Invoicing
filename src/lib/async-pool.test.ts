import { describe, expect, it } from "vitest";
import { createLimiter } from "./async-pool";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("createLimiter — ثلاثةٌ معاً والباقي ينتظر دوره", () => {
  it("لا يجري أكثر من الحدّ في لحظة، ويجري الكلُّ في النهاية", async () => {
    const run = createLimiter(3);
    let active = 0;
    let peak = 0;
    const gates = Array.from({ length: 20 }, deferred);
    const done = gates.map((g, i) => run(async () => {
      active++;
      peak = Math.max(peak, active);
      await g.promise;
      active--;
      return i;
    }));
    await tick();
    expect(active).toBe(3);
    for (const g of gates) { g.resolve(); await tick(); }
    expect(await Promise.all(done)).toEqual(gates.map((_, i) => i));
    expect(peak).toBe(3);
  });

  it("بترتيب الوصول", async () => {
    const run = createLimiter(1);
    const order: number[] = [];
    await Promise.all([1, 2, 3, 4].map((n) => run(async () => { await tick(); order.push(n); })));
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it("عملٌ يرمي لا يوقف الطابور — مكانُه يُخلى لمن بعده", async () => {
    const run = createLimiter(1);
    const first = run(async () => { throw new Error("تعثّر"); });
    const second = run(async () => "وصل");
    await expect(first).rejects.toThrow("تعثّر");
    await expect(second).resolves.toBe("وصل");
  });

  it("حدٌّ غير صالح يصير واحداً لا صفراً يعلّق كلَّ شيء", async () => {
    const run = createLimiter(0);
    await expect(run(async () => 1)).resolves.toBe(1);
  });
});
