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
