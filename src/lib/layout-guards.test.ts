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

describe("الشبكة المتجاوبة لها عمود صريح على الجوّال", () => {
  for (const file of walk("src")) {
    const source = readFileSync(file, "utf8");
    if (!source.includes("grid-cols")) continue;
    it(file, () => {
      expect(implicitGridColumns(source)).toEqual([]);
    });
  }

  it("والحارس يمسك الشكل الخاطئ", () => {
    expect(implicitGridColumns('<div className="mt-10 grid gap-8 xl:grid-cols-[1fr_2fr]">')).toHaveLength(1);
  });

  it("ولا يمسك الصواب", () => {
    expect(implicitGridColumns('<div className="grid grid-cols-[minmax(0,1fr)] xl:grid-cols-2">')).toEqual([]);
    expect(implicitGridColumns('<div className="grid h-7 w-7 place-items-center">')).toEqual([]);
  });
});

/*
 * ── ما يلتصق بحافّة الشاشة يحسب حافّتها الآمنة وأشرطةَ القشرة ──
 *
 * `viewport-fit=cover` يمدّ الصفحةَ تحت ساعة الآيفون وشريط المنزل. وكانت
 * المقاساتُ أرقاماً في كلّ صفحة: `top-14` (الشريطُ العلويّ بلا الساعة) و`bottom-20`
 * (أقصرُ من شريط الألسنة مع شريط المنزل) — فانزلق الشريطُ تحت الساعة، ووقع شريطُ
 * التحديد تحت الألسنة وزرِّ الكاميرا. فالمقاسُ من رموز `globals.css` وحدها:
 * `top-(--app-header)` و`bottom-(--above-tabbar)` و`pb-(--content-end)`.
 */
export function hardCodedShellOffsets(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/className=\{?[`"]([^`"]*)[`"]/g)) {
    const toks = m[1].split(/\s+/);
    if (!toks.includes("sticky") && !toks.includes("fixed")) continue;
    for (const t of toks) {
      /* لاصقٌ تحت الشريط العلويّ بارتفاعه المكتوب — بلا الحافّة الآمنة */
      if (/^(lg:)?top-(14|\[60px\])$/.test(t)) out.push(t);
      /* لاصقٌ فوق شريط الجوّال بارتفاعٍ مكتوب — على الجوّال وحده (`lg:` للحاسوب بلا شريط) */
      if (/^bottom-(\d+|\[calc\(.*safe-area.*\)\])$/.test(t) && t !== "bottom-0") out.push(t);
    }
  }
  return out;
}

describe("اللاصقُ بحافّة الشاشة يأخذ مقاسه من رموز القشرة", () => {
  for (const file of walk("src")) {
    const source = readFileSync(file, "utf8");
    if (!/sticky|fixed/.test(source)) continue;
    it(file, () => {
      expect(hardCodedShellOffsets(source)).toEqual([]);
    });
  }

  it("والحارس يمسك الشكل الخاطئ", () => {
    expect(hardCodedShellOffsets('<div className="sticky top-14 z-10 lg:top-[60px]">')).toEqual(["top-14", "lg:top-[60px]"]);
    expect(hardCodedShellOffsets('<div className="no-print sticky bottom-20 z-20 lg:bottom-4">')).toEqual(["bottom-20"]);
    expect(hardCodedShellOffsets('<footer className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10">')).toHaveLength(1);
  });

  it("ولا يمسك الصواب", () => {
    expect(hardCodedShellOffsets('<div className="sticky top-(--app-header) z-10">')).toEqual([]);
    expect(hardCodedShellOffsets('<div className="sticky bottom-(--above-tabbar) z-10 lg:bottom-4">')).toEqual([]);
    expect(hardCodedShellOffsets('<div className="fixed inset-x-0 bottom-0 z-30">')).toEqual([]);
  });

  it("الشريطُ العلويّ يحشو الحافّةَ الآمنة، والمحتوى يترك ما تحت شريط الجوّال", () => {
    expect(readFileSync("src/components/topbar.tsx", "utf8")).toMatch(/sticky top-0[^"]*pt-\(--safe-top\)/);
    expect(readFileSync("src/components/page-shell.tsx", "utf8")).toContain("pb-(--content-end)");
    const css = readFileSync("src/app/globals.css", "utf8");
    for (const token of ["--app-header", "--tabbar", "--above-tabbar", "--content-end"]) {
      expect(css).toContain(`${token}:`);
    }
  });
});

/*
 * ── `hidden` لا يُخفي زرّاً من `buttonClass` ──
 *
 * `buttonClass` يحمل `inline-flex`، وفي ترتيب Tailwind يغلب `hidden` — فبقي زرُّ
 * «يحتاج قرارك» ظاهراً على الجوّال وقد أُريد إخفاؤه، وأخذ نصفَ الصفّ وقصّ العنوان.
 * يُخفى الغلافُ لا الزرّ.
 */
const HIDDEN_BUTTON = /\$\{buttonClass\([^)]*\)\}[^`]*(?<![:\w-])hidden\b/;

describe("الزرُّ لا يُخفى بـ`hidden` على صنفه", () => {
  for (const file of walk("src")) {
    const source = readFileSync(file, "utf8");
    if (!source.includes("buttonClass")) continue;
    it(file, () => {
      expect(source.match(HIDDEN_BUTTON)?.[0] ?? null).toBeNull();
    });
  }
  it("والحارس يمسك الشكل الخاطئ ولا يمسك المتغيّرَ بنقطة", () => {
    expect(HIDDEN_BUTTON.test('className={`${buttonClass("secondary", "sm")} hidden sm:inline-flex`}')).toBe(true);
    expect(HIDDEN_BUTTON.test('className={`${buttonClass("primary")} cursor-pointer sm:hidden`}')).toBe(false);
  });
});

/**
 * ── هدفُ اللمس ٤٤ بكسلاً على الجوّال ──
 *
 * `min-h-8` (٣٢) و`min-h-9` و`min-h-10` على زرٍّ أو رابطٍ أو حقل كانت ٢٨ موضعاً بلا
 * ارتفاعٍ للجوّال — منها «لماذا هذا الرقم؟» تحت أهمّ رقمٍ في «اليوم». فالمنخفضُ يُكتب
 * للحاسوب بعد `sm:` ومعه `min-h-11` للّمس؛ والحاوية (`div` · `li`) لا تُلمس.
 */
export function shortTouchTargets(source: string): string[] {
  return source.split("\n")
    .map((line, i) => [line, i + 1] as const)
    .filter(([line]) => /(^|[" `{])min-h-(8|9|10)(?=[ "`])/.test(line) && !/<div|<li |const cls/.test(line))
    .map(([line, n]) => `${n}: ${line.trim().slice(0, 80)}`);
}

describe("هدفُ اللمس على الجوّال", () => {
  it("يمسك الزرَّ المنخفض بلا ارتفاعِ لمس، ويترك ما بعد sm:", () => {
    expect(shortTouchTargets(`<button className="min-h-8 px-2">x</button>`)).toHaveLength(1);
    expect(shortTouchTargets(`<button className="min-h-11 sm:min-h-8 px-2">x</button>`)).toHaveLength(0);
  });

  it("لا زرَّ ولا رابطَ ولا حقلَ دون ٤٤ بكسلاً على الجوّال", () => {
    const found = walk("src").flatMap((f) => shortTouchTargets(readFileSync(f, "utf8")).map((x) => `${f}:${x}`));
    expect(found).toEqual([]);
  });
});
