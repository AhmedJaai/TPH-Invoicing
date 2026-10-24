import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BusyStatus } from "./ui-client";

/*
  ما يقوله الزرُّ المنتظِر بجانبه: منطقةٌ حيّة موجودةٌ دائماً (فيُقرأ البدء)، والنصُّ ظاهرٌ
  ما دام يعمل، ولا شيء حين يقف.
*/
describe("BusyStatus", () => {
  it("يعمل: ما يجري بنصّه في منطقةٍ حيّة", () => {
    const html = renderToStaticMarkup(createElement(BusyStatus, { busy: true, text: "يُقفل الشهر…" }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("يُقفل الشهر…");
    expect(html).not.toContain("sr-only");
  });

  it("لا يعمل: المنطقةُ باقيةٌ فارغة — لا نصَّ قديماً يبقى ظاهراً", () => {
    const html = renderToStaticMarkup(createElement(BusyStatus, { busy: false, text: "يُقفل الشهر…" }));
    expect(html).toContain('role="status"');
    expect(html).not.toContain("يُقفل الشهر…");
  });
});
