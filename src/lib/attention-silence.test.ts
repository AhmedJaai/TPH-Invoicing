import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ما أُسكت يُطبَّق كلُّه. كان `gatherAttentionFacts` يقرأ ثلاث بادئاتٍ مسمّاة من `alert_resolutions`،
 * والبنودُ التي أُضيفت بعدها (إشعارٌ دائن · سدادٌ لم يقيّده · كمّيّةٌ خاطئة) تُسكَت فتُحفظ ولا تختفي.
 */
describe("إسكاتُ البنود المحسوبة", () => {
  it("لا يُقرأ قرارُ الإسكات ببادئاتٍ مسمّاة — كلُّ مفتاحٍ يُستعمل يُرى", () => {
    const src = readFileSync(path.join(import.meta.dirname, "attention-facts.ts"), "utf8");
    const reads = [...src.matchAll(/const silenced = silencedKeys\([\s\S]*?from alert_resolutions([^`]*)`/g)].map((m) => m[1]);
    expect(reads).toHaveLength(1);
    for (const tail of reads) expect(tail).not.toMatch(/like\s+'/);
  });
});
