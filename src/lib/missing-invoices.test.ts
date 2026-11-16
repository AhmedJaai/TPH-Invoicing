import { describe, expect, it } from "vitest";
import {
  buildMissingBoard, mergeWitnesses, statementCover,
  type FoodicsWitness, type PaymentWitness, type StatementWitness, type SupplierFacts,
} from "./missing-invoices";

const TODAY = "2026-11-16";

const supplier = (over: Partial<SupplierFacts> = {}): SupplierFacts => ({
  id: "aval", name: "أفال", slug: "AVAL", issuesInvoices: true, issuesStatements: true, foodicsLinked: false,
  lastInvoiceDay: "2026-11-07", recentInvoices: 4, recentBilledMinor: 800_000, statements: [], ...over,
});
const line = (day: string, amountMinor: number, ref: string | null = "INV-1", over: Partial<StatementWitness> = {}): StatementWitness =>
  ({ supplierId: "aval", ref, day, amountMinor, unclear: false, ...over });
const move = (purchaseId: string, day: string, amountMinor: number, invoiceNumber: string | null = null, supplierId = "aval"): FoodicsWitness =>
  ({ supplierId, purchaseId, invoiceNumber, day, amountMinor });
const pay = (paymentId: string, unbackedMinor: number, supplierId = "aval"): PaymentWitness =>
  ({ supplierId, paymentId, day: "2026-10-27", unbackedMinor });

describe("دمج الشاهدين", () => {
  it("سطر الكشف وحركة فودكس بالمبلغ نفسه في أسبوعٍ واقعةٌ واحدة بشاهدَين", () => {
    const out = mergeWitnesses([line("2026-10-10", 199_870, "00080")], [move("p1", "2026-10-12", 199_870, "80")]);
    expect(out).toHaveLength(1);
    expect(out[0].witnesses).toEqual(["STATEMENT", "FOODICS"]);
    expect(out[0].ref).toBe("00080");
    expect(out[0].foodicsPurchaseId).toBe("p1");
  });

  it("فرقُ ريالٍ يُتسامح به، وأكثرُ منه واقعتان", () => {
    expect(mergeWitnesses([line("2026-10-10", 14_000)], [move("p1", "2026-10-10", 14_100)])).toHaveLength(1);
    expect(mergeWitnesses([line("2026-10-10", 14_000)], [move("p1", "2026-10-10", 14_101)])).toHaveLength(2);
  });

  it("المبلغ نفسه بعد ثمانية أيّام لا يُدمج", () => {
    const out = mergeWitnesses([line("2026-10-01", 24_000)], [move("p1", "2026-10-09", 24_000)]);
    expect(out.map((o) => o.witnesses)).toEqual([["STATEMENT"], ["FOODICS"]]);
  });

  it("واحدةٌ بواحدة: طلبُ بيكوف المتكرّر بالمبلغ نفسه لا يأخذ سطران حركةً واحدة", () => {
    const out = mergeWitnesses(
      [line("2026-10-03", 24_000, "A"), line("2026-10-05", 24_000, "B")],
      [move("p1", "2026-10-05", 24_000)],
    );
    expect(out).toHaveLength(2);
    /* الأقربُ يوماً يأخذها */
    expect(out.find((o) => o.ref === "B")!.witnesses).toEqual(["STATEMENT", "FOODICS"]);
    expect(out.find((o) => o.ref === "A")!.witnesses).toEqual(["STATEMENT"]);
  });

  it("النتيجة لا تتغيّر بترتيب الصفوف", () => {
    const lines = [line("2026-10-03", 24_000, "A"), line("2026-10-05", 24_000, "B"), line("2026-10-20", 50_000, "C")];
    const moves = [move("p2", "2026-10-21", 50_000), move("p1", "2026-10-05", 24_000)];
    expect(mergeWitnesses([...lines].reverse(), [...moves].reverse())).toEqual(mergeWitnesses(lines, moves));
  });

  it("مرجعٌ لم يُقرأ يرفع التباسَه شاهدٌ ثانٍ ويأخذ رقمَه", () => {
    const alone = mergeWitnesses([line("2026-10-10", 30_000, "#لـ28", { unclear: true })], []);
    expect(alone[0].unclear).toBe(true);
    const both = mergeWitnesses([line("2026-10-10", 30_000, "#لـ28", { unclear: true })], [move("p1", "2026-10-10", 30_000, "00346")]);
    expect(both[0].unclear).toBe(false);
    expect(both[0].ref).toBe("00346");
  });
});

describe("بمَ يشهد الكشف", () => {
  it("من لا يصدر كشوفاً غيرُ من لم يصل كشفُه قطّ", () => {
    expect(statementCover({ issuesStatements: false, statements: [] }, TODAY)).toEqual({ state: "DOES_NOT_ISSUE" });
    expect(statementCover({ issuesStatements: true, statements: [] }, TODAY)).toEqual({ state: "NEVER" });
  });

  it("الكشوف التراكميّة المتداخلة مدّةٌ واحدة بلا فجوة", () => {
    const cover = statementCover({ issuesStatements: true, statements: [
      { from: "2026-05-14", to: "2026-08-29" }, { from: "2026-05-14", to: "2026-10-31" }, { from: "2026-08-01", to: "2026-09-30" },
    ] }, TODAY);
    expect(cover).toEqual({ state: "COVERED", through: "2026-10-31", staleDays: 16, gaps: [] });
  });

  it("أيّامٌ بين كشفين تُسمّى: أفال من ٢١ إلى ٣١ يوليو", () => {
    const cover = statementCover({ issuesStatements: true, statements: [
      { from: "2026-08-01", to: "2026-08-23" }, { from: "2026-06-03", to: "2026-07-20" },
    ] }, TODAY);
    expect(cover.state === "COVERED" && cover.gaps).toEqual([{ from: "2026-07-21", to: "2026-07-31", days: 11 }]);
  });

  it("كشفان متلاصقان يوماً بيوم لا فجوة بينهما", () => {
    const cover = statementCover({ issuesStatements: true, statements: [
      { from: "2026-09-01", to: "2026-09-30" }, { from: "2026-10-01", to: "2026-10-31" },
    ] }, TODAY);
    expect(cover.state === "COVERED" && cover.gaps).toEqual([]);
  });
});

describe("لوحة الفواتير التي يُحتمل غيابها", () => {
  it("المبلغ الذي شهد عليه اثنان يُعدّ مرّةً واحدة", () => {
    const board = buildMissingBoard({
      suppliers: [supplier()], today: TODAY, payments: [],
      statement: [line("2026-10-10", 199_870, "00080")],
      foodics: [move("p1", "2026-10-11", 199_870)],
    });
    expect(board.totals).toEqual({ invoices: 1, missingMinor: 199_870, confirmedByTwo: 1, unbackedMinor: 0 });
  });

  it("الدفعة بلا فاتورة تُعرض ولا تُجمع إلى الفواتير الغائبة", () => {
    const board = buildMissingBoard({
      suppliers: [supplier()], today: TODAY, statement: [line("2026-10-10", 50_000)], foodics: [], payments: [pay("x", 30_000)],
    });
    expect(board.withLeads[0].missingMinor).toBe(50_000);
    expect(board.withLeads[0].unbackedMinor).toBe(30_000);
    expect(board.totals.missingMinor).toBe(50_000);
    expect(board.totals.unbackedMinor).toBe(30_000);
  });

  it("نشِطٌ بلا كشفٍ ولا فودكس «لا شاهد عليه»، ومربوطُ فودكس عليه شاهد", () => {
    const board = buildMissingBoard({
      suppliers: [
        supplier({ id: "a", name: "أ" }),
        supplier({ id: "b", name: "ب", foodicsLinked: true }),
      ],
      today: TODAY, statement: [], foodics: [], payments: [],
    });
    expect(board.blind.map((r) => r.supplier.id)).toEqual(["a"]);
    expect(board.clearCount).toBe(1);
  });

  it("كشفٌ حديث شاهد، وكشفٌ قدُم ليس شاهداً على ما بعده", () => {
    const fresh = supplier({ id: "f", statements: [{ from: "2026-10-01", to: "2026-10-31" }] });
    const stale = supplier({ id: "s", statements: [{ from: "2026-07-01", to: "2026-07-31" }] });
    const board = buildMissingBoard({ suppliers: [fresh, stale], today: TODAY, statement: [], foodics: [], payments: [] });
    expect(board.blind.map((r) => r.supplier.id)).toEqual(["s"]);
    expect(board.clearCount).toBe(1);
  });

  it("شراءٌ مرّةً واحدة بلا شاهد لا يُعدّ «أعمى» ولا «مفحوصاً» — يُعدّ على حدة", () => {
    const board = buildMissingBoard({
      suppliers: [supplier({ id: "equipment", recentInvoices: 1 }), supplier({ id: "weekly", recentInvoices: 2 })],
      today: TODAY, statement: [], foodics: [], payments: [],
    });
    expect(board.blind.map((r) => r.supplier.id)).toEqual(["weekly"]);
    expect(board.oneOffCount).toBe(1);
    expect(board.clearCount).toBe(0);
  });

  it("فجوةٌ دون أسبوعٍ بين كشفين لا تُعرض — مدّةُ الكشف من تواريخ أسطره", () => {
    const board = buildMissingBoard({
      suppliers: [supplier({ statements: [{ from: "2026-07-02", to: "2026-07-28" }, { from: "2026-08-02", to: "2026-10-31" }] })],
      today: TODAY, statement: [], foodics: [], payments: [],
    });
    expect(board.coverGaps).toEqual([]);
  });

  it("من لا يصدر فواتير، ومن لا تعامل حديثاً له، لا يُسأل عنه", () => {
    const board = buildMissingBoard({
      suppliers: [supplier({ id: "n", issuesInvoices: false }), supplier({ id: "old", recentInvoices: 0, recentBilledMinor: 0 })],
      today: TODAY, statement: [], foodics: [], payments: [],
    });
    expect(board.blind).toEqual([]);
    expect(board.withLeads).toEqual([]);
    /* من لا يصدر فواتير نشِطٌ وليس أعمى — يُعدّ مع من لا قرينة عليه */
    expect(board.clearCount).toBe(1);
  });

  it("قاعدةٌ بلا مورّدين لا تقول شيئاً", () => {
    const board = buildMissingBoard({ suppliers: [], today: TODAY, statement: [], foodics: [], payments: [] });
    expect(board).toEqual({ withLeads: [], blind: [], clearCount: 0, oneOffCount: 0, coverGaps: [], totals: { invoices: 0, missingMinor: 0, confirmedByTwo: 0, unbackedMinor: 0 } });
  });

  it("فجوةُ ما بين كشفين تُعرض لمورّدٍ نشِط، الأطولُ أوّلاً", () => {
    const board = buildMissingBoard({
      suppliers: [
        supplier({ id: "a", name: "أ", statements: [{ from: "2026-06-03", to: "2026-07-20" }, { from: "2026-08-01", to: "2026-10-31" }] }),
        supplier({ id: "b", name: "ب", statements: [{ from: "2026-09-01", to: "2026-09-10" }, { from: "2026-10-01", to: "2026-10-31" }] }),
        supplier({ id: "old", recentInvoices: 0, statements: [{ from: "2026-05-01", to: "2026-05-10" }, { from: "2026-07-01", to: "2026-07-31" }] }),
      ],
      today: TODAY, statement: [], foodics: [], payments: [],
    });
    expect(board.coverGaps.map((g) => [g.supplier.id, g.from, g.to, g.days])).toEqual([
      ["b", "2026-09-11", "2026-09-30", 20],
      ["a", "2026-07-21", "2026-07-31", 11],
    ]);
  });

  it("الأكبرُ مبلغاً أوّلاً في القرائن، والأكبرُ تعاملاً أوّلاً فيمن لا شاهد عليه", () => {
    const board = buildMissingBoard({
      suppliers: [
        supplier({ id: "small", name: "ص" }), supplier({ id: "big", name: "ك" }),
        supplier({ id: "b1", name: "م١", recentBilledMinor: 100 }), supplier({ id: "b2", name: "م٢", recentBilledMinor: 900 }),
      ],
      today: TODAY, foodics: [], payments: [],
      statement: [line("2026-10-10", 10_000, "A", { supplierId: "small" }), line("2026-10-10", 90_000, "B", { supplierId: "big" })],
    });
    expect(board.withLeads.map((r) => r.supplier.id)).toEqual(["big", "small"]);
    expect(board.blind.map((r) => r.supplier.id)).toEqual(["b2", "b1"]);
  });
});
