import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * حرّاسٌ يقرؤون الشيفرة نصّاً — لأخطاءٍ لا يراها المترجم ولا يرميها التشغيل.
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

/* ── ١. الكتابة داخل المعاملة بمقبضها، لا بـ`db` ── */

/**
 * يُرجع أجسام كتل `transaction(async (x) => { … })` مع اسم مقبضها.
 *
 * وقع في `/api/counterparty`: الكتابة بـ`db` داخل `db.transaction(t)`.
 * على Vercel في المجمَّع اتّصالٌ واحد تحجزه المعاملة، فينتظر `db` عشر
 * ثوانٍ ثمّ يسقط؛ ومحلّياً يسقط بالمفتاح الأجنبيّ. فلم يُحفَظ تعريفُ
 * جهةٍ واحد من الواجهة خمسة أيّام.
 */
export function transactionBodies(source: string): string[] {
  const bodies: string[] = [];
  const re = /\.transaction\(\s*async\s*\(\s*[a-zA-Z_]+\s*\)\s*=>\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < source.length && depth > 0) {
      const c = source[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      i++;
    }
    bodies.push(source.slice(start, i - 1));
  }
  return bodies;
}

const GLOBAL_DB_WRITE = /\bdb\s*\.\s*(insert|update|delete|select|execute)\s*\(/;

describe("لا كتابة بـdb داخل معاملة", () => {
  for (const file of SRC.filter((f) => f.includes(`${path.sep}api${path.sep}`) || f.includes(`${path.sep}services${path.sep}`))) {
    const source = readFileSync(file, "utf8");
    if (!source.includes(".transaction(")) continue;
    it(file, () => {
      const hit = transactionBodies(source).find((b) => GLOBAL_DB_WRITE.test(b));
      expect(hit ? `db. داخل معاملة: «${GLOBAL_DB_WRITE.exec(hit)?.[0]}»` : null).toBeNull();
    });
  }

  it("والحارس يُمسك الشكل الخاطئ", () => {
    const bad = "await db.transaction(async (t) => { await t.insert(a); await db.update(b).set({}); });";
    expect(transactionBodies(bad).some((b) => GLOBAL_DB_WRITE.test(b))).toBe(true);
  });

  it("ولا يُمسك الصواب", () => {
    const good = "await db.transaction(async (t) => { await t.insert(a); await t.update(b).set({}); });";
    expect(transactionBodies(good).some((b) => GLOBAL_DB_WRITE.test(b))).toBe(false);
  });
});

/* ── ٢. تسمية ملفّات الدرايف في موضعٍ واحد ── */

/**
 * القيد الأوّل: لا تسمية بلا اختيار الإنسان ملفّاً ملفّاً وأثرٍ في السجلّ.
 * وكانت المزامنة تسمّي وحدها قبل التقييد، بلا أثر. فلا يُستدعى
 * `renameFile` إلّا من المسار الذي يأخذ الاختيار ويكتب الاسمين.
 */
const RENAME_ALLOWED = new Set([
  path.join("src", "lib", "drive.ts"),
  path.join("src", "app", "api", "drive-rename", "route.ts"),
]);

describe("renameFile لا يُستدعى إلّا من /api/drive-rename", () => {
  it("لا مستدعٍ آخر", () => {
    const offenders = SRC.filter(
      (f) => !RENAME_ALLOWED.has(f) && /\brenameFile\s*\(/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

/* ── ٣. الردّ يُقرأ نصّاً قبل JSON ── */

/**
 * مهلة المنصّة (٥٠٤) وحدّ الحجم (٤١٣) يعودان صفحةً نصّية، فينفجر
 * `res.json()` بـ«Unexpected token». والقراءة في `lib/http-client`.
 */
const BARE_JSON = /await\s+res\.json\(\)/;

describe("المكوّنات لا تقرأ الردّ JSON مباشرة", () => {
  for (const file of SRC.filter((f) => f.includes(`${path.sep}components${path.sep}`) || f.endsWith(".tsx"))) {
    it(file, () => {
      expect(BARE_JSON.test(readFileSync(file, "utf8"))).toBe(false);
    });
  }

  it("والحارس يُمسك الشكل الخاطئ", () => {
    expect(BARE_JSON.test("const json = await res.json();")).toBe(true);
  });
});

/* ── ٤. المال المعروض يمرّ بمنسّقٍ واحد ── */

/**
 * كان المبلغ نفسه يُكتب «1500.00» في رسالة و«1,500.00» في أخرى: تسع
 * دوالّ محلّية وخمسٌ وعشرون قسمةً مضمَّنة. فما يُعرض لإنسان يمرّ بـ
 * `formatRiyalsDisplay`. والمستثنى ما يُقرأ آلةً: ملفّ التحويل للبنك،
 * ونصُّ النموذج، والمبلغ المشتقّ نصّاً في مخرَج القراءة.
 */
const RAW_RIYALS = /\/ 100\)\.toFixed\(2\)/;
const RAW_RIYALS_ALLOWED = new Set([
  path.join("src", "lib", "payment-run.ts"),
  path.join("src", "lib", "extraction", "validate-extraction.ts"),
  path.join("src", "services", "adjudicator.service.ts"),
  path.join("src", "lib", "bank", "adjudicator-prompt.ts"),
  path.join("src", "lib", "money.ts"),
]);

describe("لا قسمةَ مال مضمَّنة في نصٍّ يُعرض", () => {
  it("كلّ مبلغٍ معروض عبر formatRiyalsDisplay", () => {
    const offenders = SRC.filter(
      (f) => !RAW_RIYALS_ALLOWED.has(f) && RAW_RIYALS.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
