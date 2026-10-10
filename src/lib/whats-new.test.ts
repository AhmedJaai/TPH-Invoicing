import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WHATS_NEW, unseenNews, type NewsItem } from "./whats-new";

describe("الجديد في النظام", () => {
  const items: NewsItem[] = [
    { id: "a", date: "2026-10-01", text: "أ", href: "/payments", needs: "payment:approve" },
    { id: "b", date: "2026-10-05", text: "ب", href: "/bank", needs: "bank:view" },
  ];

  it("ما قُرئ لا يُعرَض ثانيةً، والأحدثُ أوّلاً", () => {
    expect(unseenNews(new Set(), () => true, items).map((n) => n.id)).toEqual(["b", "a"]);
    expect(unseenNews(new Set(["b"]), () => true, items).map((n) => n.id)).toEqual(["a"]);
  });

  it("لا يُعرَض لدورٍ رابطٌ يُغلَق في وجهه", () => {
    expect(unseenNews(new Set(), (c) => c === "bank:view", items).map((n) => n.id)).toEqual(["b"]);
  });

  it("المعرّفاتُ فريدة، وكلُّ رابطٍ صفحةٌ قائمة", () => {
    expect(new Set(WHATS_NEW.map((n) => n.id)).size).toBe(WHATS_NEW.length);
    for (const n of WHATS_NEW) {
      const path = n.href.split("#")[0].split("?")[0];
      expect(existsSync(`src/app/(app)${path}/page.tsx`), n.href).toBe(true);
    }
  });
});
