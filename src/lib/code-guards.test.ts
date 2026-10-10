import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";
import tsParser from "@typescript-eslint/parser";
import tph from "../../eslint-rules/index.mjs";
import { tphGuards } from "../../eslint.config.mjs";

/**
 * حرّاسٌ يقرؤون الشيفرة — لأخطاءٍ لا يراها المترجم ولا يرميها التشغيل.
 *
 * كلٌّ منها وقع فعلاً في هذا المستودع، ومرّت عليه الاختبارات النقيّة
 * خضراء. والحارس يُثبت نفسه أيضاً: يُمسك الشكل الخاطئ في مثالٍ مكتوب،
 * وإلّا كان طمأنينةً بلا سند.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full);
  }
  return out;
}

const SRC = walk("src");

/* ── ١–٤. ما صار قواعدَ ESLint ── */

/**
 * خمسةُ حرّاسٍ كانت هنا انتظاماً يقرأ النصّ — `db` داخل معاملة، و`renameFile` خارج
 * خدمته، و`await res.json()` في شاشة، ونصُّ الخطأ الخامّ وجسمُ الطلب المصبوب
 * بـ`as` في مسار، وقسمةُ المال المضمَّنة — ومعها حارسُ `allocation-sql.test.ts`.
 * صارت قواعدَ في `eslint-rules/index.mjs` تقرأ شجرةَ الشيفرة وتظهر في المحرّر
 * عند السطر، وأمثلتُها الخاطئة والصائبة في `lint-rules.test.ts`.
 *
 * والشجرةُ تُفحَص هنا بالقواعد نفسها وبنطاقها نفسه (`tphGuards` من
 * `eslint.config.mjs`): فلا يمرّ `npm test` وحده على ما يخالفها، والقاعدةُ
 * مكتوبةٌ مرّةً واحدة.
 */
describe("حرّاسُ ESLint المحلّيّة على الشجرة كلّها", () => {
  it("لا مخالفةَ في src ولا scripts", async () => {
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ["**/*.ts", "**/*.tsx"],
          languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
          // تعليقاتُ تعطيلٍ لقواعدَ لا تُحمَّل هنا ليست خطأً في هذا الفحص
          linterOptions: { reportUnusedDisableDirectives: "off" },
        },
        ...tphGuards,
      ],
    });
    const results = await eslint.lintFiles(["src", "scripts"]);
    // الحارس يرى الشجرة فعلاً — لا يمرّ لأنّه لم يجد شيئاً
    expect(results.length).toBeGreaterThan(300);
    const offences = results.flatMap((r) =>
      r.messages
        .filter((m) => m.fatal || m.ruleId?.startsWith("tph/"))
        .map((m) => `${path.relative(process.cwd(), r.filePath)}:${m.line} ${m.ruleId ?? "parse"} — ${m.message}`));
    expect(offences).toEqual([]);
  }, 120_000);

  it("والنطاقُ يحمل القواعدَ السبع — لا قاعدةٌ مكتوبةٌ ولم تُفعَّل", () => {
    const enabled = new Set(tphGuards.flatMap((c) => Object.keys(c.rules ?? {})));
    expect([...enabled].sort()).toEqual(Object.keys(tph.rules).map((r) => `tph/${r}`).sort());
  });
});

/* ── ٥. كلّ حقلٍ وقائمة لهما اسمٌ يُقرأ ── */

/**
 * قرار الإقفال — أخطر فعلٍ شهريّ — كان يبدأ بقائمةٍ بلا اسم: يقول قارئ
 * الشاشة «قائمة منبثقة، 2026-09» ولا يقول ما هي. وينتهي بحقلٍ تسميتُه
 * نصُّه المؤقّت وحده، فتختفي التسمية عند أوّل حرفٍ يُكتب.
 *
 * والاسم يقع بأحد ثلاثة: `aria-label`، أو `aria-labelledby`، أو `label`
 * يلفّ الحقل. والنصّ المؤقّت ليس اسماً.
 */
const FIELD_TAG = /<(input|select|textarea)\b/g;

/** أداخلَ `<label>` يقع الحقلُ الذي يبدأ عند `at`؟ */
export function insideLabel(source: string, at: number): boolean {
  const before = source.slice(0, at);
  return before.lastIndexOf("<label") > before.lastIndexOf("</label>");
}

/** وسمُ الحقل كاملاً من `<` إلى `>` — مع تخطّي ما بين الأقواس المعقوفة. */
export function tagAt(source: string, at: number): string {
  let depth = 0;
  for (let i = at; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return source.slice(at, i + 1);
  }
  return source.slice(at);
}

export function unnamedFields(source: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  FIELD_TAG.lastIndex = 0;
  while ((m = FIELD_TAG.exec(source))) {
    const tag = tagAt(source, m.index);
    if (/\baria-label(ledby)?=/.test(tag)) continue;
    if (/\btype="hidden"/.test(tag)) continue;
    if (insideLabel(source, m.index)) continue;
    /* `id` يشير إليه `htmlFor` في الملفّ نفسه — تسميةٌ ظاهرة لا مخفيّة */
    const id = /\bid=(\{[^}]*\}|"[^"]*")/.exec(tag)?.[1];
    if (id && source.includes(`htmlFor=${id}`)) continue;
    out.push(tag.replace(/\s+/g, " ").slice(0, 80));
  }
  return out;
}

describe("لا حقلَ ولا قائمةَ بلا اسم", () => {
  for (const file of SRC.filter((f) => f.endsWith(".tsx"))) {
    const source = readFileSync(file, "utf8");
    if (!FIELD_TAG.test(source)) continue;
    it(file, () => {
      expect(unnamedFields(source)).toEqual([]);
    });
  }

  it("والحارس يُمسك الشكل الخاطئ", () => {
    expect(unnamedFields('<select value={m}>')).toHaveLength(1);
    expect(unnamedFields('<input placeholder="سبب الإقفال" />')).toHaveLength(1);
  });

  it("ولا يُمسك الصواب", () => {
    expect(unnamedFields('<select aria-label="الشهر" value={m}>')).toEqual([]);
    expect(unnamedFields('<label><span>الشهر</span><input value={m} /></label>')).toEqual([]);
    expect(unnamedFields('<input type="hidden" name="x" />')).toEqual([]);
    expect(unnamedFields('<label htmlFor="a">الاسم</label><input id="a" value={x} />')).toEqual([]);
  });
});

/* ── ٦. الزرّ يُلمَس بالإبهام — ٤٤ بكسل على الجوّال ── */

/**
 * `py-2` مع سطر `text-xs` نحو ٣٢ بكسلاً، و`py-1.5` مع `text-[11px]` نحو
 * ٢٨ — وأحمد يضغطها بإبهامه على جهاز الكاشير. وأوّلُها «عالِجها ←»، وهو
 * الفعل الرئيس لكلّ تنبيه في الصفحة الأولى.
 *
 * و`buttonClass` يحمل `min-h-11`، فالحارس يقبله أو يقبل `min-h-` صريحاً.
 */
export function shortButtons(source: string): string[] {
  const out: string[] = [];
  const re = /<button\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const tag = tagAt(source, m.index);
    if (!/\bp[yb]-/.test(tag)) continue;
    if (/min-h-/.test(tag) || /buttonClass\(/.test(tag)) continue;
    out.push(tag.replace(/\s+/g, " ").slice(0, 90));
  }
  return out;
}

describe("لا زرَّ أقصر من إبهام", () => {
  for (const file of SRC.filter((f) => f.endsWith(".tsx"))) {
    const source = readFileSync(file, "utf8");
    if (!source.includes("<button")) continue;
    it(file, () => {
      expect(shortButtons(source)).toEqual([]);
    });
  }

  it("والحارس يُمسك الشكل الخاطئ", () => {
    expect(shortButtons('<button className="px-3 py-1.5 text-xs">أ</button>')).toHaveLength(1);
  });

  it("ولا يُمسك الصواب", () => {
    expect(shortButtons('<button className="min-h-11 px-3 py-1.5">أ</button>')).toEqual([]);
    expect(shortButtons('<button className={buttonClass("primary", "sm")}>أ</button>')).toEqual([]);
  });
});

/*
  ── النصُّ الثانويّ لا يُبهَّت ──

  `--muted` مضبوطٌ ليجتاز ‎4.5:1‎ بالكاد (`globals.css`)، فأيُّ شفافيّةٍ فوقه
  تُسقطه: `text-muted/80` كانت ‎3.47:1‎ في «المصروفات» — وكشفها فحصُ axe لا
  العين. والتدرّجُ يُصنع بالحجم والوزن، لا بتبهيت اللون الذي يحمل المعنى.
*/
const FADED_TEXT = /\btext-(muted|ink-soft)\/\d+/;

describe("لا نصَّ ثانويّاً مبهَّتاً دون حدّ التباين", () => {
  it("لا text-muted/NN ولا text-ink-soft/NN في الواجهة", () => {
    const hits = SRC.filter((f) => f.endsWith(".tsx"))
      .filter((f) => FADED_TEXT.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("والحارس يُمسك الشكل الخاطئ", () => {
    expect(FADED_TEXT.test('className="text-muted/80"')).toBe(true);
    expect(FADED_TEXT.test('className="text-muted"')).toBe(false);
  });
});
