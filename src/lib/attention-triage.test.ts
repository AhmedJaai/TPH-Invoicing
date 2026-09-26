import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AttentionItem } from "./attention";
import {
  landing,
  ATTENTION_IDS, groupBySeverity, inLens, itemHref, lensTabs, neighbours, parseLens, stakeByKind,
} from "./attention-triage";

function item(id: string, over: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id,
    area: "BANK",
    severity: "HIGH",
    title: id,
    detail: "",
    action: "",
    href: "/",
    count: 1,
    impact: { kind: "UNATTRIBUTED", amountMinor: null },
    evidence: [],
    ...over,
  };
}

describe("كلُّ بندٍ يعرفه الطابور", () => {
  /*
    بندٌ جديد في `attention.ts` بلا مدخلٍ هنا يُعرَض بلا رمزٍ ولا تصنيف
    («إشارة» أم عمل) — فيُطابَق الملفّ نفسه لا قائمةٌ تُحفظ بيد.
  */
  it("يطابق معرّفاتِ buildAttention حرفاً بحرف", () => {
    const src = readFileSync("src/lib/attention.ts", "utf8");
    const ids = [...src.matchAll(/\bid: "([a-z-]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(10);
    expect([...ids].sort()).toEqual([...ATTENTION_IDS].sort());
  });
});

describe("العدسة في العنوان", () => {
  it("لا تُصدَّق قيمةٌ غير معروفة — تعود «الكلّ»", () => {
    expect(parseLens(undefined)).toBe("all");
    expect(parseLens("toString")).toBe("all");
    expect(parseLens("__proto__")).toBe("all");
    expect(parseLens("bank")).toBe("all");
    expect(parseLens("BANK")).toBe("BANK");
    expect(parseLens("signals")).toBe("signals");
  });

  it("الإشاراتُ مالٌ جرى على غير المعتاد، لا أعمالٌ ترتيبيّة", () => {
    expect(inLens(item("duplicate-payments"), "signals")).toBe(true);
    expect(inLens(item("price-rises"), "signals")).toBe(true);
    expect(inLens(item("pending-documents"), "signals")).toBe(false);
    expect(inLens(item("غير-معروف"), "signals")).toBe(false);
  });

  it("رابطُ البند بلا عدسة هو الرابطُ القديم نفسه — لا تنكسر روابط الرئيسية", () => {
    expect(itemHref("duplicate-payments")).toBe("/attention?item=duplicate-payments");
    expect(itemHref("overdue", "PAYMENTS")).toBe("/attention?in=PAYMENTS&item=overdue");
  });

  it("الألسنةُ تعدّ ما فيها، ولا لسانَ لبابٍ فارغ", () => {
    const tabs = lensTabs([
      item("duplicate-payments"),
      item("overdue", { area: "PAYMENTS" }),
      item("pending-documents", { area: "INVOICES" }),
    ]);
    expect(tabs.map((t) => [t.lens, t.count])).toEqual([
      ["all", 3], ["signals", 1], ["BANK", 1], ["PAYMENTS", 1], ["INVOICES", 1],
    ]);
  });
});

describe("التنقّل بين البنود", () => {
  it("يتبع الترتيبَ المعروض بعد التجميع بالشدّة", () => {
    const list = [
      item("a", { severity: "MEDIUM" }),
      item("b", { severity: "CRITICAL" }),
      item("c", { severity: "MEDIUM" }),
    ];
    expect(groupBySeverity(list).map((g) => g.items.map((i) => i.id))).toEqual([["b"], ["a", "c"]]);
    const n = neighbours(list, "a");
    expect(n.index).toBe(1);
    expect(n.prev?.id).toBe("b");
    expect(n.next?.id).toBe("c");
    expect(neighbours(list, "x").index).toBe(-1);
  });
});

describe("المالُ المعلَّق بحسب نوعه", () => {
  it("لا يُجمع المجهولُ صفراً، ولا نوعٌ إلى نوع", () => {
    const stakes = stakeByKind([
      item("a", { impact: { kind: "UNATTRIBUTED", amountMinor: 3_008_490 } }),
      item("b", { impact: { kind: "UNATTRIBUTED", amountMinor: null } }),
      item("c", { impact: { kind: "AT_RISK", amountMinor: 163_318 } }),
      item("d", { impact: { kind: "BLOCKED", amountMinor: null } }),
      item("e", { impact: { kind: "RECOVERABLE", amountMinor: 50_000 } }),
    ]);
    expect(stakes).toEqual([
      { kind: "RECOVERABLE", knownMinor: 50_000, items: 1, unknown: 0 },
      { kind: "AT_RISK", knownMinor: 163_318, items: 1, unknown: 0 },
      { kind: "UNATTRIBUTED", knownMinor: 3_008_490, items: 2, unknown: 1 },
      { kind: "BLOCKED", knownMinor: 0, items: 1, unknown: 1 },
    ]);
  });

  it("لا نوعَ بلا بند", () => {
    expect(stakeByKind([])).toEqual([]);
  });
});

describe("landing — بعد الحسم إلى التالي", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("يفتح المطلوبَ ما دام في الطابور", () => {
    expect(landing(list, "b", "c")).toEqual({ selected: { id: "b" }, resolved: false });
  });
  it("المطلوبُ حُسم وخرج: تاليه كما كان حين فُتح، ويُقال ذلك", () => {
    expect(landing([{ id: "a" }, { id: "c" }], "b", "c")).toEqual({ selected: { id: "c" }, resolved: true });
  });
  it("وتاليه حُسم أيضاً: أوّلُ القائمة", () => {
    expect(landing([{ id: "a" }], "b", "c")).toEqual({ selected: { id: "a" }, resolved: true });
  });
  it("بلا طلب: أوّلُ القائمة ولا خبرَ حسم", () => {
    expect(landing(list, undefined, undefined)).toEqual({ selected: { id: "a" }, resolved: false });
  });
  it("الطابورُ فرغ: لا شيء", () => {
    expect(landing([], "b", "c")).toEqual({ selected: null, resolved: true });
  });
});
