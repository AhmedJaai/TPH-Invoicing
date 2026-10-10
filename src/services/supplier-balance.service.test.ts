import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  الأرصدةُ تُحفَظ لرسم الصفحة الواحد وحده (`cache` من React). والذي يُثبَت هنا
  حدودُ ذلك الحفظ: ما يُقرأ بمقبض معاملةٍ أو لمورّدٍ بعينه لا يمرّ به أبداً، وكلُّ
  قارئٍ يأخذ قائمتَه. والاستعلامُ نفسُه تمتحنه اختباراتُ القاعدة.
*/
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/db", () => ({ db: { execute } }));

import { db } from "@/db";
import { loadBalanceTotals, loadSupplierBalances } from "./supplier-balance.service";

const row = (id: string, open: number, credit = 0) => ({
  supplier_id: id, billed: String(open), open_minor: String(open), open_count: open > 0 ? 1 : 0,
  paid_net: "0", credit_notes: "0", credit: String(credit), issues: true,
});

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue({ rows: [row("s1", 10_000), row("s2", 5_000, 7_000)] });
});

describe("loadSupplierBalances", () => {
  it("يحسب «عليك» و«لك» من صفوف الاستعلام كما هي", async () => {
    const balances = await loadSupplierBalances();
    expect(balances.map((b) => [b.supplierId, b.owedMinor, b.creditLeftMinor])).toEqual([
      ["s1", 10_000, 0],
      ["s2", 0, 2_000],
    ]);
  });

  it("كلُّ قارئٍ يأخذ قائمتَه — ترتيبُ واحدٍ لا يغيّر قائمةَ غيره", async () => {
    const first = await loadSupplierBalances();
    first.reverse();
    first.pop();
    const second = await loadSupplierBalances();
    expect(second.map((b) => b.supplierId)).toEqual(["s1", "s2"]);
  });

  it("ما يُقرأ بمقبض معاملةٍ يُسأل من المقبض نفسه، لا من المحفوظ ولا من `db`", async () => {
    const txExecute = vi.fn().mockResolvedValue({ rows: [row("s9", 1_000)] });
    /* مقبضٌ غيرُ `db` — يكفي أنّه كائنٌ آخر له `execute` */
    const tx: typeof db = Object.create(db, { execute: { value: txExecute } });
    await loadSupplierBalances();
    execute.mockClear();

    const inside = await loadSupplierBalances(tx);
    expect(inside.map((b) => b.supplierId)).toEqual(["s9"]);
    expect(txExecute).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it("ورصيدُ مورّدٍ بعينه يُسأل من القاعدة كلَّ مرّة", async () => {
    await loadSupplierBalances(db, "s1");
    await loadSupplierBalances(db, "s1");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("والمجموعُ من الصفوف نفسها", async () => {
    const { rows, totals } = await loadBalanceTotals();
    expect(rows).toHaveLength(2);
    expect(totals.owedMinor).toBe(10_000);
    expect(totals.creditLeftMinor).toBe(2_000);
  });
});
