import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ACT, recordBatch } from "./ui-terms";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** نصُّ زرٍّ هو «أكّد» أو «أكّده» وحدها — بلا ما يقول ماذا يقع. */
const BARE_CONFIRM = /"(أكّد|أكّده)"/;

describe("الزرّ يسمّي أثره", () => {
  it("لا زرَّ نصُّه «أكّد» وحدها", () => {
    const offenders = walk("src").filter((f) => BARE_CONFIRM.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("والحارس يُمسك الشكل الخاطئ", () => {
    expect(BARE_CONFIRM.test('{busy ? "يحفظ…" : "أكّد"}')).toBe(true);
    expect(BARE_CONFIRM.test('{busy ? "يؤكّد…" : "أكّده"}')).toBe(true);
  });

  it("ولا يُمسك ما يسمّي أثره", () => {
    expect(BARE_CONFIRM.test('"أكّد وطابِق"')).toBe(false);
    expect(BARE_CONFIRM.test(`"${ACT.recordAgainstInvoice}"`)).toBe(false);
  });

  it("لكلّ فعلٍ اسمٌ واحد — ولا اسمَ لفعلين", () => {
    const names = Object.values(ACT);
    expect(new Set(names).size).toBe(names.length);
  });

  it("الإقرار الجماعيّ يحمل عدده مميَّزاً", () => {
    expect(recordBatch(1)).toBe("سجِّل حركة واحدة");
    expect(recordBatch(50)).toBe("سجِّل 50 حركة");
  });
});
