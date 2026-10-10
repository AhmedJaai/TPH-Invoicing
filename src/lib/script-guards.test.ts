import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * كلُّ نصٍّ يكتب يُعلن كيف يُمنَع من الكتابة سهواً.
 *
 * القاعدة في `.env` هي الإنتاج، فنصٌّ يكتب بلا سؤال يكتب في مال المقهى. والعرفُ
 * قائم (`scripts/lib/guard-write.ts`): يرفض، أو **يعاين ولا يكتب**، حتى يُكتب
 * `--i-know-this-is-production` في الأمر نفسه. لكنّه كان عُرفاً يُتذكَّر — ونصٌّ
 * جديد ينساه يمرّ من كلّ فحص. فهذا يقرأ النصوص: ما فيه كتابةٌ يحمل الحارس، أو
 * يُسمّى هنا بسببه.
 */
const DIR = "scripts";
const SCRIPTS = readdirSync(DIR).filter((f) => f.endsWith(".ts")).sort();

/** كتابةٌ في القاعدة أو الدرايف — بالبنّاء، أو بنصّ SQL، أو بمعاملة. */
const WRITES = [
  /\b(?:db|t|tx|trx|client|c|dst)\s*\.\s*(?:insert|update|delete)\s*\(/,
  /\.transaction\s*\(/,
  /\b(?:insert\s+into|delete\s+from)\s+[a-z_"$]/i,
  /\bupdate\s+[a-z_"]+\s+set\b/i,
  /\b(?:renameFile|uploadFile|createFolder|ensureFolder)\s*\(/,
];

/** يُسقط التعليقات — الشرحُ يذكر `insert into` ولا يكتب. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

export function writesSomething(source: string): boolean {
  const code = stripComments(source);
  return WRITES.some((re) => re.test(code));
}

const GUARD = /\b(?:assertWriteAllowed|writeAllowed)\s*\(/;

/**
 * ما يكتب بلا ذلك الحارس — ولكلٍّ سببُه. الإضافةُ هنا قرارٌ يُراجَع، لا سهو.
 */
const EXEMPT: Record<string, string> = {
  "migrate.ts": "مشغّلُ الهجرات نفسُه — يجري في بناء المنصّة، وحمايتُه القفلُ والبصمة",
  "seed-test-fixture.ts": "يرفض ما ليس قاعدةَ اختبار (testDatabaseProblem)",
  "certify-flow.ts": "كلُّ سيناريو في معاملةٍ تُلغى — لا يُكتَب شيء",
  "verify-invariants.ts": "يحاول خرقَ القيود في معاملاتٍ تُلغى — لا يُكتَب شيء",
  "restore-verify.ts": "يكتب في قاعدةٍ يسمّيها الأمر صراحةً ويرفض غير الفارغة — لا يقرأ DATABASE_URL هدفاً",
};

/** وكلُّ مُعفًى يحمل في نصّه ما يقوله سببُه — وإلّا صار الإعفاءُ ادّعاءً. */
const EXEMPT_EVIDENCE: Record<string, RegExp> = {
  "migrate.ts": /pg_try_advisory_lock/,
  "seed-test-fixture.ts": /testDatabaseProblem\s*\(/,
  "certify-flow.ts": /rollback/i,
  "verify-invariants.ts": /rollback/i,
  "restore-verify.ts": /rollback/i,
};

describe("النصوص الكاتبة تحمل حارسَها", () => {
  it("الحارس يرى النصوص فعلاً", () => {
    expect(SCRIPTS.length).toBeGreaterThan(40);
    expect(SCRIPTS.filter((f) => writesSomething(readFileSync(path.join(DIR, f), "utf8"))).length).toBeGreaterThan(15);
  });

  for (const file of SCRIPTS) {
    const source = readFileSync(path.join(DIR, file), "utf8");
    if (!writesSomething(source)) continue;
    it(`${file} — ${file in EXEMPT ? "مُعفًى بسببه" : "بحارس الكتابة"}`, () => {
      if (file in EXEMPT) {
        expect(EXEMPT_EVIDENCE[file].test(source), `${file}: ${EXEMPT[file]} — ولا أثرَ لذلك في نصّه`).toBe(true);
        return;
      }
      expect(
        GUARD.test(stripComments(source)),
        `${file} يكتب بلا assertWriteAllowed/writeAllowed (scripts/lib/guard-write.ts) — اجعله يعاين حتى يُكتب الإقرار، أو أضِفه إلى EXEMPT بسببه`,
      ).toBe(true);
    });
  }

  it("ولا إعفاءَ لنصٍّ لم يعد موجوداً أو لم يعد يكتب", () => {
    for (const file of Object.keys(EXEMPT)) {
      expect(SCRIPTS, `${file} في EXEMPT وليس في scripts/`).toContain(file);
      expect(writesSomething(readFileSync(path.join(DIR, file), "utf8")), `${file} لم يعد يكتب — احذفه من EXEMPT`).toBe(true);
    }
  });

  it("والكاشف يُمسك أشكال الكتابة، ولا يُمسك القراءة ولا التعليق", () => {
    expect(writesSomething("await db.insert(invoices).values(v);")).toBe(true);
    expect(writesSomething("await t.update(payments).set({ status });")).toBe(true);
    expect(writesSomething("await db.transaction((t) => refresh(t, id));")).toBe(true);
    expect(writesSomething("await client.query(`update bank_transactions set occurrence = 0`);")).toBe(true);
    expect(writesSomething("await c.query('delete from rate_limits where at < now()');")).toBe(true);
    expect(writesSomething("await renameFile(drive, id, name);")).toBe(true);
    expect(writesSomething("const rows = await db.select().from(invoices);")).toBe(false);
    expect(writesSomething("// كان يكتب: insert into payments …\nconst n = await db.$count(payments);")).toBe(false);
    expect(writesSomething("/* db.insert(x) */ console.log(1);")).toBe(false);
  });
});

/*
  كلّ نصٍّ يُفعَّل بعلم كتابة («apply» · «--apply» · «--commit») يمرّ بـ
  assertWriteAllowed. كان خمسةٌ منها محروسة وأربعة عشر لا — ومنها
  db:dedupe الذي حذف صفوفاً حقيقيّة من قبل.
*/
describe("النصوص الكاتبة", () => {
  it("كلّ علمِ كتابةٍ يمرّ بالإقرار المكتوب", () => {
    const offenders = SCRIPTS.filter((f) => {
      const s = readFileSync(path.join(DIR, f), "utf8");
      const hasWriteFlag = /\b(?:process\.argv|args)\.includes\("(?:apply|--apply|--commit)"\)/.test(s);
      return hasWriteFlag && !s.includes("assertWriteAllowed");
    });
    expect(offenders).toEqual([]);
  });
});
