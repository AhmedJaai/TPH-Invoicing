import { describe, expect, it } from "vitest";
import { SIGNATURES } from "./detect";
import {
  ADAPTERS, GENERIC_ADAPTER, adapterFor, adapterNotices, headersFor,
} from "./adapters";

describe("محوِّلات البنوك", () => {
  /*
    معرفةُ البنك بلا استعمالها أسوأ من الجهل به: توحي بأنّ النظام يدعم
    ستّة بنوك وهو يقرأ واحداً ويحاول في الباقي.
  */
  it("لكلّ بنكٍ يُكشَف محوِّلٌ يقرؤه", () => {
    for (const sig of SIGNATURES) {
      expect(adapterFor(sig.id).bankId, `لا محوِّل لـ${sig.name}`).toBe(sig.id);
    }
  });

  it("المجهول يأخذ العامّ ولا يُنسَب إلى الأهليّ", () => {
    expect(adapterFor(null)).toBe(GENERIC_ADAPTER);
    expect(adapterFor("لا-وجود-له").bankId).toBe("GENERIC");
  });

  /* `verified` ليس زينة: الأهليّ وحده جُرِّب على ملفّات حقيقية */
  it("المجرَّب واحدٌ ويُقال صراحةً", () => {
    const verified = ADAPTERS.filter((a) => a.verified);
    expect(verified.map((a) => a.bankId)).toEqual(["SNB"]);
  });

  it("غير المجرَّب يُعلَن للمستخدم لا يُدفَن في تعليق", () => {
    const notices = adapterNotices(adapterFor("RAJHI"));
    expect(notices[0]).toContain("لم يُجرَّب");
    expect(notices[0]).toContain("راجع");
  });

  it("والمجرَّب يُعلن عِلَلَه المعروفة كذلك", () => {
    const notices = adapterNotices(adapterFor("SNB"));
    expect(notices.some((n) => n.includes("لم يُجرَّب"))).toBe(false);
    expect(notices.some((n) => n.includes("مرجعُ البنك"))).toBe(true);
  });

  it("كلّ محوِّل يحمل عِلّةً واحدة على الأقلّ", () => {
    for (const a of ADAPTERS) expect(a.quirks.length).toBeGreaterThan(0);
  });
});

describe("دمج رؤوس الأعمدة", () => {
  it("العامّ يبقى، وما يخصّ البنك يُزاد", () => {
    const merged = headersFor(adapterFor("SNB"), { description: ["description", "الوصف"] });
    expect(merged.description).toContain("description");
    expect(merged.description).toContain("البيان");
  });

  it("لا يتكرّر رأسٌ واحد", () => {
    const merged = headersFor(adapterFor("SNB"), { description: ["البيان"] });
    expect(merged.description.filter((h) => h === "البيان")).toHaveLength(1);
  });

  it("المحوِّل العامّ لا يزيد شيئاً", () => {
    const base = { description: ["الوصف"] };
    expect(headersFor(GENERIC_ADAPTER, base).description).toEqual(["الوصف"]);
  });
});
