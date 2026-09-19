import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

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
 * يُرجع كلَّ وصولٍ إلى `db` داخل دالّةٍ مُمرَّرة إلى `transaction(…)`.
 *
 * وقع في `/api/counterparty`: الكتابة بـ`db` داخل `db.transaction(t)`.
 * على Vercel في المجمَّع اتّصالٌ واحد تحجزه المعاملة، فينتظر `db` عشر
 * ثوانٍ ثمّ يسقط؛ ومحلّياً يسقط بالمفتاح الأجنبيّ. فلم يُحفَظ تعريفُ
 * جهةٍ واحد من الواجهة خمسة أيّام.
 *
 * وكان الحارس انتظاماً يرى صياغةً واحدة — `async (t) => {` — فيفلت منه
 * المعامل المنمَّط، والسهم بلا أقواس، و`function`، والجسم تعبيراً، و`db`
 * مُمرَّراً حجّةً. والصياغة تتغيّر بلا قصد، فالحارس يقرأ شجرة المترجم لا
 * النصّ: كلُّ دالّةٍ حجّةٍ لـ`transaction` بأيّ شكل، وكلُّ معرِّفٍ اسمه `db`
 * داخلها ليس اسمَ خاصيّة.
 */
export function dbInsideTransactions(source: string, fileName = "x.ts"): string[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const hits: string[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const isTransactionCall = (n: ts.CallExpression) => {
    const callee = n.expression;
    const name = ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : ts.isIdentifier(callee)
        ? callee.text
        : null;
    return name === "transaction";
  };

  // المعرِّف `db` بمعنى الكائن العامّ — لا `x.db` ولا `{ db: … }` ولا اسمَ معاملٍ يحجبه.
  const isGlobalDbRef = (id: ts.Identifier) => {
    const p = id.parent;
    if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
    if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p)) && p.name === id) return false;
    if (ts.isParameter(p) || ts.isVariableDeclaration(p) || ts.isBindingElement(p)) return false;
    return true;
  };

  const scan = (fn: ts.ArrowFunction | ts.FunctionExpression) => {
    const shadowed = fn.parameters.some((prm) => ts.isIdentifier(prm.name) && prm.name.text === "db");
    if (shadowed) return;
    const inner = (x: ts.Node) => {
      if (ts.isIdentifier(x) && x.text === "db" && isGlobalDbRef(x)) {
        hits.push(`${lineOf(x)}: ${x.parent.getText(sf).replace(/\s+/g, " ").slice(0, 60)}`);
      }
      ts.forEachChild(x, inner);
    };
    inner(fn.body);
  };

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && isTransactionCall(n)) {
      for (const arg of n.arguments) {
        if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) scan(arg);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

describe("لا وصولَ إلى db داخل معاملة", () => {
  const withTx = SRC.filter((f) => readFileSync(f, "utf8").includes("transaction("));

  it("الحارس يرى معاملاتٍ فعلاً — لا يمرّ لأنّه لم يجد شيئاً", () => {
    expect(withTx.length).toBeGreaterThan(10);
  });

  for (const file of withTx) {
    it(file, () => {
      expect(dbInsideTransactions(readFileSync(file, "utf8"), file)).toEqual([]);
    });
  }

  // الأشكال الستّة التي أفلت منها الانتظام القديم إلّا أوّلها — ومعها ما حوله.
  const BAD: Record<string, string> = {
    "سهمٌ بجسم": "await db.transaction(async (tx) => { await tx.insert(a); await db.insert(b); });",
    "معاملٌ منمَّط": "await db.transaction(async (tx: Tx) => { await db.update(b).set({}); });",
    "سهمٌ بلا async يُرجع": "await db.transaction((tx) => { return db.insert(a); });",
    "function": "await db.transaction(async function (tx) { await db.delete(a); });",
    "معاملٌ بلا أقواس": "await db.transaction(async tx => { await db.select().from(a); });",
    "db حجّةً في جسمٍ تعبير": "await db.transaction(async (tx) => write(tx, db));",
    "جسمٌ تعبيرٌ مباشر": "await db.transaction((tx) => db.insert(a).values(v));",
    "متداخلٌ في دالّةٍ داخلها": "await db.transaction(async (tx) => { await Promise.all(xs.map((x) => db.insert(x))); });",
  };
  for (const [label, code] of Object.entries(BAD)) {
    it(`والحارس يُمسك: ${label}`, () => {
      expect(dbInsideTransactions(code).length).toBeGreaterThan(0);
    });
  }

  const GOOD: Record<string, string> = {
    "المقبض وحده": "await db.transaction(async (t) => { await t.insert(a); await t.update(b).set({}); });",
    "مقبضٌ منمَّط يُمرَّر": "await db.transaction((tx: Tx) => markPaidByOwner(tx, invoiceId));",
    "db خارج المعاملة": "const rows = await db.select().from(a); await db.transaction(async (tx) => tx.insert(b));",
    "خاصيّةٌ اسمها db": "await db.transaction(async (tx) => { log({ db: 1 }); cfg.db.name; });",
  };
  for (const [label, code] of Object.entries(GOOD)) {
    it(`ولا يُمسك الصواب: ${label}`, () => {
      expect(dbInsideTransactions(code)).toEqual([]);
    });
  }
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
