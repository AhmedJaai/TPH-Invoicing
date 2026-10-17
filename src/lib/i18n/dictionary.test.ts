import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AREAS, GROUP_LABEL } from "../nav";
import { Translator, hasArabic, type Dictionary } from "./translate";

/*
  القاموس يُبنى من `scripts/i18n/en/*.json` بـ`node scripts/i18n/build-dictionary.mjs`.
  ومن غيّر اسماً في التنقّل ولم يترجمه رأى الشريطَ نصفُه عربيّ بالإنجليزيّة — فيقف هنا.
*/
const dict = JSON.parse(fs.readFileSync(path.join(process.cwd(), "public/i18n/en.json"), "utf8")) as Dictionary;
const t = new Translator(dict);

describe("قاموس الواجهة الإنجليزيّة", () => {
  it("كلّ اسمٍ في التنقّل له ترجمة", () => {
    const labels = AREAS.flatMap((a) => [a.label, a.short, a.question, ...a.children.map((c) => c.label)]);
    for (const g of Object.values(GROUP_LABEL)) if (g) labels.push(g);
    const missing = labels.filter((l) => hasArabic(t.translate(l)));
    expect(missing).toEqual([]);
  });

  it("الترجمة لا تُسقط خانةً ولا تزيدها", () => {
    const bad = Object.entries(dict).filter(([ar, en]) => {
      const slots = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join();
      return slots(ar) !== slots(en);
    });
    expect(bad).toEqual([]);
  });
});
