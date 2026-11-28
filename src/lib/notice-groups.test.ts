import { describe, expect, it } from "vitest";
import { splitNotices } from "./notice-groups";
import type { Notice } from "@/services/notifications.service";

const n = (id: string, tone: Notice["tone"], at: string): Notice => ({ id, tone, at, title: id, href: "/", kind: "ACTIVITY" });

describe("قسمةُ الجرس", () => {
  it("ما يحتاج فعلاً أوّلاً والخطرُ قبل التحذير، وما جرى بالأحدث", () => {
    const { act, happened } = splitNotices([
      n("old-info", "info", "2026-11-01T00:00:00Z"),
      n("warn-new", "warn", "2026-11-28T00:00:00Z"),
      n("danger-old", "danger", "2026-11-20T00:00:00Z"),
      n("ok-new", "ok", "2026-11-27T00:00:00Z"),
    ]);
    expect(act.map((x) => x.id)).toEqual(["danger-old", "warn-new"]);
    expect(happened.map((x) => x.id)).toEqual(["ok-new", "old-info"]);
  });
  it("لا شيء يضيع ولا يتكرّر", () => {
    const all = [n("a", "ok", "2026-11-01T00:00:00Z"), n("b", "danger", "2026-11-02T00:00:00Z")];
    const { act, happened } = splitNotices(all);
    expect(act.length + happened.length).toBe(all.length);
  });
});
