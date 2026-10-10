import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

/**
 * حُرّاسُ النشر: أن يقع ما تقوله الوثيقة.
 *
 * ── العطب الذي أنشأ هذا الملفّ ──
 *
 * كانت `CLAUDE.md` تقول عن الهجرات «تُطبَّق مع كلّ نشر»، **ولم تكن
 * تُطبَّق**: لا `vercel-build` ولا `postbuild` ولا خطوةٌ في CI. فبقيت
 * قاعدةُ الإنتاج عند الهجرة ٣٤ والمستودعُ عند ٣٥.
 *
 * ولم يُكتشَف ذلك إلّا عند نشرٍ يقرأ عمودين جديدين — **ونشرُه قبل
 * الهجرة كان سيكسر كلَّ استعلامِ مورّد في النظام**: الصفحةُ الرئيسة
 * وحسابات المورّدين وكلُّ تنبيهٍ يقرأ سياسةَ مستنداتهم.
 *
 * والوثيقةُ التي تصف ما لا يقع أسوأ من ألّا تُكتب: من يقرؤها يحسِب
 * المسألة مضمونةً فلا يفحصها. فصار الادّعاءُ محروساً.
 */
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};

describe("الهجرات تُطبَّق مع النشر", () => {
  it("لبناء المنصّة أمرٌ خاصّ يسبق البناءَ بالهجرة", () => {
    const cmd = pkg.scripts["vercel-build"];
    expect(cmd, "لا `vercel-build` — فالنشر لا يهاجر").toBeDefined();
    expect(cmd).toContain("scripts/migrate.ts");
    expect(cmd).toContain("next build");
  });

  it("الهجرةُ قبل البناء لا بعده", () => {
    const cmd = pkg.scripts["vercel-build"];
    expect(cmd.indexOf("migrate")).toBeLessThan(cmd.indexOf("next build"));
  });

  it("وتُوصَل بـ`&&` لا بـ`;` — فالهجرةُ الساقطة توقف النشر", () => {
    /*
      `;` تمضي إلى البناء مهما كانت نتيجةُ الهجرة، فيُنشَر كودٌ على
      مخطّطٍ لم يتغيّر. و`&&` توقف كلَّ شيء — وهو الصواب: نشرٌ لم يقع
      خيرٌ من نشرٍ يقرأ عموداً غير موجود.
    */
    expect(pkg.scripts["vercel-build"]).toMatch(/migrate\.ts\s*&&\s*next build/);
  });

  it("ولا يقرأ ملفَّ بيئةٍ محلّيّاً — المنصّة تحقن متغيّراتها", () => {
    /* `--env-file=.env` يسقط في بناء المنصّة: لا ملفّ هناك. */
    expect(pkg.scripts["vercel-build"]).not.toContain("--env-file");
  });

  it("ومشغّلُ الهجرات يقرأ `process.env.DATABASE_URL`", () => {
    expect(readFileSync("scripts/migrate.ts", "utf8")).toContain("process.env.DATABASE_URL");
  });

  it("والهجرةُ لا تنتظر قفلَ جدولٍ بلا حدّ — تفشل سريعاً ولا تجمّد الموقع الحيّ", () => {
    const migrate = readFileSync("scripts/migrate.ts", "utf8");
    const begin = migrate.indexOf('client.query("begin")');
    const timeout = migrate.indexOf("set local lock_timeout");
    const run = migrate.indexOf("client.query(sql)");
    expect(begin).toBeGreaterThan(-1);
    /* داخل المعاملة وقبل نصّ الهجرة: `set local` خارج معاملةٍ لا يفعل شيئاً */
    expect(timeout).toBeGreaterThan(begin);
    expect(run).toBeGreaterThan(timeout);
  });
});

describe("المستودع والقاعدة يتحرّكان معاً", () => {
  it("كلُّ هجرةٍ ملفٌّ مرقَّمٌ بترتيبٍ لا يلتبس", () => {
    const files = readdirSync("drizzle/sql").filter((f) => f.endsWith(".sql")).sort();
    expect(files.length).toBeGreaterThan(0);
    files.forEach((f, i) => {
      expect(f, `${f} لا يبدأ برقمٍ من ثلاث خانات`).toMatch(/^\d{3}_/);
      /* والترقيمُ متّصل: فجوةٌ تعني ملفّاً حُذف وقد طُبّق */
      expect(Number(f.slice(0, 3)), `فجوةٌ في الترقيم عند ${f}`).toBe(i + 1);
    });
  });

  it("وإعدادُ drizzle-kit يرفض push وgenerate ولو كُتبا بيد", () => {
    /* push يُسقط ما لا يعرفه schema.ts من قيود الهجرات — فرادةُ الهويّة ومؤثِّراتُ المال */
    const config = readFileSync("drizzle.config.ts", "utf8");
    expect(config).toMatch(/a === "push" \|\| a === "generate"/);
    expect(config).toContain("throw new Error");
  });

  it("ولا أمرَ يدفع المخطّط بلا هجرة", () => {
    /* `drizzle-kit push` يطلب طرفيّةً تفاعلية ولا يترك أثراً يُراجَع */
    for (const cmd of Object.values(pkg.scripts)) {
      expect(cmd).not.toContain("drizzle-kit push");
    }
  });
});

/*
  ── الهجرةُ المطبَّقة لا تُعدَّل ──

  أُضيف إلى 042 تحديثٌ ثانٍ بعد أن طبّقها نشرُ معاينة على قاعدته. والمشغّلُ
  يرفض — بحقّ — هجرةً مطبَّقة تغيّر ملفّها، فسقط كلُّ نشرٍ بعدها عند
  `migrate` قبل أن يبدأ البناء، ووصلت رسائلُ الفشل صاحبَ المشروع.

  ولا يعرف الاختبارُ أيّ القواعد طبّقت ماذا — فيحفظ `migration-hashes.json`
  بصمةَ كلّ هجرةٍ كما دخلت المستودع. هجرةٌ جديدة تُضاف إليه، وتعديلُ قائمةٍ
  يُسقط CI **قبل** أن يُسقط النشر. والتعديلُ المقصود (نادر، ويحتاج
  `--reapply` على كلّ قاعدة) يُعدِّل البصمةَ بيده عالماً بما يفعل.
*/
describe("الهجرةُ المطبَّقة لا تُعدَّل — الإضافةُ هجرةٌ جديدة", () => {
  const manifest = JSON.parse(readFileSync("drizzle/migration-hashes.json", "utf8")) as Record<string, string>;
  const files = readdirSync("drizzle/sql").filter((f) => f.endsWith(".sql")).sort();

  for (const name of files) {
    it(name, () => {
      /* بالطريقة نفسِها التي يبصم بها `scripts/migrate.ts` */
      const sha = createHash("sha256").update(readFileSync(`drizzle/sql/${name}`, "utf8")).digest("hex");
      expect(manifest[name], `${name} ليست في drizzle/migration-hashes.json — أضِفها`).toBeDefined();
      expect(sha, `${name} تغيّرت بعد إدخالها — اكتب هجرةً جديدة بدل تعديلها`).toBe(manifest[name]);
    });
  }
});

/*
  ── «الإضافة آمنة، والحذفُ وإعادةُ التسمية على نشرتين» ──

  الهجرةُ تجري في `vercel-build` **قبل** رفع الكود، فبينهما نافذةٌ يعمل فيها الكود
  القديم على المخطّط الجديد: عمودٌ حُذف أو أُعيدت تسميتُه يُسقط كلَّ استعلامٍ يقرؤه
  حتى يكتمل النشر — وإن سقط البناءُ بعد الهجرة بقي الموقعُ معطوباً. كانت القاعدةُ
  وصيّةً في `CLAUDE.md`؛ وهذا فحصُها.

  يُفحَص ما بعد `FIRST_CHECKED` وحده: ما قبله طُبّق ولا يُعدَّل. وما كان مقصوداً
  (النشرةُ الثانية من حذفٍ على نشرتين، بعد أن لم يبقَ كودٌ يقرأ العمود) يُعلَن بسطر
  تعليقٍ في الهجرة نفسها: `-- two-step-ok: <السبب>`.
*/
const FIRST_CHECKED = 73;

export function destructiveStatements(sql: string): string[] {
  if (/^[ \t]*--[ \t]*two-step-ok:[ \t]*\S/m.test(sql)) return [];
  const code = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    // نصوصُ الدوالّ والقيمُ الحرفيّة ليست أوامر
    .replace(/'(?:[^']|'')*'/g, "''");
  const RULES: [RegExp, string][] = [
    [/\bdrop\s+column\b/i, "حذفُ عمود"],
    [/\bdrop\s+table\b/i, "حذفُ جدول"],
    [/\brename\s+(column\b|to\b|constraint\b)/i, "إعادةُ تسمية"],
    [/\balter\s+column\s+\S+\s+(set\s+data\s+)?type\b/i, "تغييرُ نوع عمود"],
    [/\balter\s+column\s+\S+\s+set\s+not\s+null\b/i, "NOT NULL على عمودٍ قائم"],
  ];
  return RULES.filter(([re]) => re.test(code)).map(([, label]) => label);
}

describe("الهجرةُ الجديدة إضافةٌ — والحذفُ وإعادةُ التسمية على نشرتين", () => {
  const files = readdirSync("drizzle/sql").filter((f) => f.endsWith(".sql") && Number(f.slice(0, 3)) >= FIRST_CHECKED);

  for (const name of files) {
    it(name, () => {
      expect(
        destructiveStatements(readFileSync(`drizzle/sql/${name}`, "utf8")),
        `${name}: الكود القديم يعمل على المخطّط الجديد حتى يكتمل النشر — اقسمها على نشرتين، أو أعلِن \`-- two-step-ok: السبب\``,
      ).toEqual([]);
    });
  }

  it("والحارس يُمسك الأشكال الخمسة", () => {
    expect(destructiveStatements("alter table invoices drop column note;")).toEqual(["حذفُ عمود"]);
    expect(destructiveStatements("DROP TABLE IF EXISTS old_things;")).toEqual(["حذفُ جدول"]);
    expect(destructiveStatements("alter table a rename column x to y;")).toEqual(["إعادةُ تسمية"]);
    expect(destructiveStatements("alter table a rename to b;")).toEqual(["إعادةُ تسمية"]);
    expect(destructiveStatements("alter table a alter column x type bigint;")).toEqual(["تغييرُ نوع عمود"]);
    expect(destructiveStatements("alter table a alter column x set not null;")).toEqual(["NOT NULL على عمودٍ قائم"]);
  });

  it("ولا يُمسك الإضافة، ولا ما في تعليقٍ أو نصّ", () => {
    expect(destructiveStatements("alter table a add column note text;")).toEqual([]);
    expect(destructiveStatements("create table t (id text primary key, at timestamptz not null default now());")).toEqual([]);
    expect(destructiveStatements("create index if not exists i on a (x) where y is not null;")).toEqual([]);
    expect(destructiveStatements("drop index if exists old_idx; drop trigger if exists t on a;")).toEqual([]);
    expect(destructiveStatements("-- لا نكتب drop column هنا\nalter table a add column b int;")).toEqual([]);
    expect(destructiveStatements("/* rename to */ comment on column a.b is 'was: drop table x';")).toEqual([]);
  });

  it("والمقصودُ يُعلَن بسببه — لا بعلَمٍ فارغ", () => {
    expect(destructiveStatements("-- two-step-ok: لم يبقَ قارئٌ منذ النشرة 0.9\nalter table a drop column x;")).toEqual([]);
    expect(destructiveStatements("-- two-step-ok:\nalter table a drop column x;")).toEqual(["حذفُ عمود"]);
  });
});
