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

/**
 * ── زرُّ الإرسال لا يُعطَّل صامتاً ──
 *
 * `<button type="submit" disabled={busy || !ready}>` يُضغط قبل اكتمال النموذج فلا يحدث
 * شيءٌ ولا يُعرف لماذا — وجده زاحفُ الأزرار في أربعةَ عشرَ نموذجاً. فالإرسالُ بـ`ReadySubmit`
 * (`ui-client.tsx`) يقول ما ينقص، و`disabled` لزرّ الإرسال لانشغاله وحده.
 */
export function silentSubmits(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/<button\b[^>]*>/g)) {
    const tag = m[0];
    if (!/type="submit"/.test(tag)) continue;
    const dis = tag.match(/disabled=\{([^}]*)\}/);
    if (dis && /\|\||&&|!|===|<|>/.test(dis[1].replace(/^\s*busy\s*$/, ""))) out.push(tag.slice(0, 90));
  }
  return out;
}

describe("زرُّ الإرسال يقول ما ينقص", () => {
  it("يمسك المعطَّلَ بشرطٍ ويترك المعطَّلَ لانشغاله", () => {
    expect(silentSubmits(`<button type="submit" disabled={busy || !ready}>x</button>`)).toHaveLength(1);
    expect(silentSubmits(`<button type="submit" disabled={busy}>x</button>`)).toHaveLength(0);
  });

  it("لا زرَّ إرسالٍ معطَّلٌ بشرطٍ صامت", () => {
    const found = walk("src").flatMap((f) => silentSubmits(readFileSync(f, "utf8")).map((x) => `${f}: ${x}`));
    expect(found).toEqual([]);
  });
});

/**
 * ── حاويةُ الأفعال لا تتجاوز أمَّها ──
 *
 * `flex shrink-0 flex-wrap` لا ينكمش، فيأخذ عرضَ ما فيه على سطرٍ واحد: لوحٌ مطويٌّ في
 * أفعال قسمٍ من «الإقرار الضريبي» مدّ الصفحةَ على الجوّال ١٠٢٩ بكسلاً (يساراً في العربيّة)،
 * وأزرارُ «تقرير المحاسب» ١٤٠. ومعه `max-w-full` يلتفّ ما فيه داخل عرض أمّه.
 */
export function unboundedActionRows(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/className=\{?[`"]([^`"]*)[`"]/g)) {
    const toks = m[1].split(/\s+/);
    if (toks.includes("shrink-0") && toks.includes("flex-wrap") && !toks.includes("max-w-full")) out.push(m[1].slice(0, 80));
  }
  return out;
}

describe("حاويةُ الأفعال تلتفّ داخل أمّها", () => {
  it("يمسك shrink-0 flex-wrap بلا max-w-full", () => {
    expect(unboundedActionRows(`<div className="flex shrink-0 flex-wrap gap-2">`)).toHaveLength(1);
    expect(unboundedActionRows(`<div className="flex max-w-full shrink-0 flex-wrap gap-2">`)).toHaveLength(0);
  });
  it("لا حاويةَ أفعالٍ بلا حدّ", () => {
    const found = walk("src").flatMap((f) => unboundedActionRows(readFileSync(f, "utf8")).map((x) => `${f}: ${x}`));
    expect(found).toEqual([]);
  });
});

/**
 * ── النسخُ الممنوع يُسمَع ──
 *
 * `navigator.clipboard.writeText` يُرفض حين يمنع المتصفّحُ الحافظة. ورابطُ الحضور الجديد
 * «يظهر الآن مرة واحدة فقط»: نسخُه كان `.then(نجاح)` بلا رفض، فإن مُنع لم يُقَل شيء
 * وظنّ المالكُ أنّه نسخه، وضاع الرابط. فكلُّ نسخٍ في `try` أو له ردٌّ على الرفض.
 */
export function silentCopies(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/clipboard\.writeText\(/g)) {
    const before = source.slice(Math.max(0, m.index - 400), m.index);
    const after = source.slice(m.index, m.index + 400);
    /* داخل `try {` لم تُغلق: ما فُتح بعده من أقواسٍ أكثرُ ممّا أُغلق */
    const at = before.lastIndexOf("try {");
    const tail = at < 0 ? "" : before.slice(at);
    const inTry = at >= 0 && (tail.match(/\{/g)?.length ?? 0) > (tail.match(/\}/g)?.length ?? 0);
    const guarded = inTry || /\.catch\(/.test(after) || /\.then\(\s*\([^)]*\)\s*=>[\s\S]*?,\s*\([^)]*\)\s*=>/.test(after);
    if (!guarded) out.push(after.slice(0, 80).replace(/\s+/g, " "));
  }
  return out;
}

describe("النسخُ إلى الحافظة يقول إن مُنع", () => {
  it("يمسك `.then` بلا رفض ويترك `try` و`.then(ok, fail)`", () => {
    expect(silentCopies(`void navigator.clipboard.writeText(u).then(() => ok());`)).toHaveLength(1);
    expect(silentCopies(`try {\n await navigator.clipboard.writeText(u);\n ok(); } catch {}`)).toHaveLength(0);
    expect(silentCopies(`navigator.clipboard.writeText(u).then(\n () => ok(),\n () => fail());`)).toHaveLength(0);
  });

  it("لا نسخَ صامتٌ عند المنع", () => {
    const found = walk("src").flatMap((f) => silentCopies(readFileSync(f, "utf8")).map((x) => `${f}: ${x}`));
    expect(found).toEqual([]);
  });
});
