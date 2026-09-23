import { describe, expect, it } from "vitest";
import { parseCountRequest } from "./count-request";
import { parseReceiptRequest } from "./receipt-request";

/**
 * الطلبُ المعطوب يُردّ قبل أن يبلغ الخدمة.
 *
 * كلُّ حالةٍ هنا كانت تمرّ بـ`as Body` — وبعضُها كان يكتب.
 */
describe("طلبُ الجرد يُفحَص وقتَ التشغيل", () => {
  it("الطلبُ السليمُ يمرّ، والكمّيّةُ تصير مِلّياً بلا عائمة", () => {
    const r = parseCountRequest({
      action: "save", countId: "c1",
      entries: [{ productId: "p1", actual: "5.2", unit: "KG" }, { productId: "p2", actual: "", unit: "L" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || r.request.action !== "save") return;
    expect(r.request.entries[0].actual).toBe(5200);
    /* والفراغُ «لم يُعَدّ» — لا صفر */
    expect(r.request.entries[1].actual).toBeNull();
  });

  it.each([
    ["فعلٌ مجهول", { action: "delete", countId: "c1" }],
    ["بلا فعل", { countId: "c1" }],
    ["جردٌ بلا معرّف", { action: "finalise" }],
    ["معرّفٌ عدد", { action: "finalise", countId: 7 }],
    ["أسطرٌ نصّ", { action: "save", countId: "c1", entries: "abc" }],
    ["أسطرٌ فارغة", { action: "save", countId: "c1", entries: [] }],
    ["كمّيّةٌ سالبة", { action: "save", countId: "c1", entries: [{ productId: "p", actual: "-1", unit: "KG" }] }],
    ["كمّيّةٌ نصٌّ عشوائيّ", { action: "save", countId: "c1", entries: [{ productId: "p", actual: "خمسة", unit: "KG" }] }],
    ["كمّيّةٌ عدد JSON يمرّ بالعائمة", { action: "save", countId: "c1", entries: [{ productId: "p", actual: 5.2, unit: "KG" }] }],
    ["وحدةٌ مجهولة", { action: "save", countId: "c1", entries: [{ productId: "p", actual: "1", unit: "TON" }] }],
    ["سطرٌ بلا وحدة", { action: "save", countId: "c1", entries: [{ productId: "p", actual: "1" }] }],
    ["حقلٌ زائد", { action: "finalise", countId: "c1", force: true }],
    ["تاريخٌ غير موجود", { action: "start", periodStart: "2026-02-30", periodEnd: "2026-03-07" }],
    ["تاريخٌ بصيغةٍ أخرى", { action: "start", periodStart: "13/09/2026", periodEnd: "19/09/2026" }],
    ["إعادةُ فتحٍ بلا سبب", { action: "reopen", countId: "c1", reason: "  " }],
    ["نطاقٌ بلا مجموعتين", { action: "scope", countId: "c1", included: ["p1"] }],
    ["نطاقٌ بمعرّفٍ فارغ", { action: "scope", countId: "c1", included: [""], excluded: [] }],
    ["افتتاحيٌّ بلا أسطر", { action: "opening", countId: "c1", entries: [] }],
  ])("يُردّ: %s", (_label, body) => {
    const r = parseCountRequest(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(3);
  });

  it("والنطاقُ طلبٌ واحدٌ بمجموعتيه", () => {
    const r = parseCountRequest({ action: "scope", countId: "c1", included: ["a", "b"], excluded: [] });
    expect(r.ok).toBe(true);
  });

  it("والافتتاحيُّ الفارغُ «أفرِغه» — يعود غيرَ معروف لا صفراً", () => {
    const r = parseCountRequest({
      action: "opening", countId: "c1", entries: [{ productId: "p", quantity: null, unit: "KG" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok && r.request.action === "opening") expect(r.request.entries[0].quantity).toBeNull();
  });
});

describe("طلبُ الكمّيّة المستلَمة يُفحَص كذلك", () => {
  it("الكمّيّةُ أوّلاً، والكلفةُ اختياريّة وتُقرأ هللاتٍ بلا عائمة", () => {
    const r = parseReceiptRequest({
      action: "create", productId: "p", receivedOn: "2026-09-16", quantity: "20", unit: "KG", cost: "1,760.50",
    });
    expect(r.ok).toBe(true);
    if (!r.ok || r.request.action !== "create") return;
    expect(r.request.quantity).toBe(20_000);
    expect(r.request.cost).toBe(176_050);
  });

  it("وبلا كلفة يمرّ — لا يُشترَط مبلغٌ لقيد كمّيّة", () => {
    const r = parseReceiptRequest({ action: "create", productId: "p", receivedOn: "2026-09-16", quantity: "20", unit: "KG" });
    expect(r.ok).toBe(true);
  });

  it.each([
    ["كمّيّةٌ صفر", { action: "create", productId: "p", receivedOn: "2026-09-16", quantity: "0", unit: "KG" }],
    ["بلا كمّيّة", { action: "create", productId: "p", receivedOn: "2026-09-16", unit: "KG" }],
    ["كلفةٌ بثلاث خانات", { action: "create", productId: "p", receivedOn: "2026-09-16", quantity: "1", unit: "KG", cost: "1.005" }],
    ["إلغاءٌ بلا سبب", { action: "void", receiptId: "r" }],
    ["ربطٌ بلا بند", { action: "resolve", receiptId: "r", resolution: { kind: "LINK" } }],
    ["حسمٌ مجهول", { action: "resolve", receiptId: "r", resolution: { kind: "MERGE" } }],
  ])("يُردّ: %s", (_label, body) => {
    expect(parseReceiptRequest(body).ok).toBe(false);
  });
});
