import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * حرّاسُ التخطيط — أخطاءٌ لا يراها المترجم وتظهر على الجوّال وحده.
 *
 * ── الشبكةُ المتجاوبة لها عمودٌ صريح على الجوّال ──
 *
 * `grid lg:grid-cols-[…]` بلا عمودٍ أساسيّ يعني على الجوّال عموداً ضمنيّاً
 * `auto` يتّسع بمحتواه: اسمُ مورّدٍ طويل أو صفُّ أشرطةٍ يمدّه فتفيض الصفحةُ
 * كلُّها عرضاً وتُسحب جانبياً. وقع في الرئيسية والإعدادات و/money، ولم يره
 * إلّا الزاحف (`npm run ui:crawl`) لأنّ البيانات يومها كانت قصيرة في غيرها.
 * فالشبكةُ التي تتغيّر أعمدتها عند نقطةٍ تكتب عمودها الأساسيّ صراحةً
 * (`grid-cols-[minmax(0,1fr)]` أو غيره).
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

export function implicitGridColumns(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/className="([^"]*)"/g)) {
    const toks = m[1].split(/\s+/);
    if (!toks.includes("grid")) continue;
    const responsive = toks.some((t) => /^(sm|md|lg|xl|2xl):grid-cols-/.test(t));
    const base = toks.some((t) => /^grid-cols-/.test(t));
    if (responsive && !base) out.push(m[1].slice(0, 90));
  }
  return out;
}

describe("الشبكةُ المتجاوبة لها عمودٌ صريح على الجوّال", () => {
  for (const file of walk("src")) {
    const source = readFileSync(file, "utf8");
    if (!source.includes("grid-cols")) continue;
    it(file, () => {
      expect(implicitGridColumns(source)).toEqual([]);
    });
  }

  it("والحارس يُمسك الشكل الخاطئ", () => {
    expect(implicitGridColumns('<div className="mt-10 grid gap-8 xl:grid-cols-[1fr_2fr]">')).toHaveLength(1);
  });

  it("ولا يُمسك الصواب", () => {
    expect(implicitGridColumns('<div className="grid grid-cols-[minmax(0,1fr)] xl:grid-cols-2">')).toEqual([]);
    expect(implicitGridColumns('<div className="grid h-7 w-7 place-items-center">')).toEqual([]);
  });
});
