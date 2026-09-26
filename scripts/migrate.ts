/**
 * مشغّل الهجرات.
 *
 *   npm run db:migrate
 *   npm run db:migrate -- --reapply 016_lifecycle_and_expense_events.sql
 *
 * `drizzle-kit push` يقارن المخطّط بالقاعدة ويسأل عمّا التبس عليه، فلا يصلح
 * في بيئة غير تفاعلية، ولا يترك أثراً يُراجَع لما جرى. فالهجرات هنا ملفات
 * SQL صريحة، تُطبَّق بالترتيب مرّة واحدة، ويُسجَّل ما طُبّق منها.
 *
 * ── هجرةٌ مطبَّقة تغيّر ملفّها لا تُعاد بصمت ──
 *
 * كان المشغّل يعيدها ويكتفي بسطر تحذير. و`016` فيها `UPDATE` بلا `WHERE`
 * يعيد اشتقاق طبقة كلّ حركة: تعديلُ حرفٍ في تعليقها كان سيُرجع ٤٩ حركة
 * أكّدها أحمد (١٠٧٬٨٧٢٫٩٧) إلى «مستنتَجة» بلا أثر. فصار الاختلاف يوقف
 * التشغيل، والإعادة تُطلَب باسم الهجرة صراحةً.
 *
 * ── ولا يجري تشغيلان معاً ──
 *
 * قفلٌ استشاريّ على الجلسة: نشرٌ وجهازٌ يشغّلانه في اللحظة نفسها كان
 * يقرأ كلاهما «غير مطبَّقة» فيطبّقانها مرّتين. والجلسةُ على الاتّصال
 * المباشر لا المجمَّع، والقفلُ يُفرَج عنه بيدٍ في كلّ مخرج.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Client } from "pg";
import { directDatabaseUrl } from "../src/lib/ops/direct-url";

const DIR = join(process.cwd(), "drizzle", "sql");

function reapplyTargets(argv: readonly string[]): Set<string> {
  const out = new Set<string>();
  argv.forEach((a, i) => {
    if (a === "--reapply" && argv[i + 1]) out.add(argv[i + 1]);
  });
  return out;
}

async function main() {
  /*
    ── المتغيّرُ الغائب يُقال باسمه ──

    `pg` بلا سلسلةِ اتّصالٍ يتّصل بـ`localhost:5432` افتراضاً، فيسقط
    بـ`ECONNREFUSED ::1:5432` — رسالةٌ عن مقبسٍ لا عن السبب. ومن يقرؤها
    في سجلّ بناءٍ يظنّ أنّ القاعدة ساقطة، والحقيقةُ أنّ المتغيّر لم
    يصل إلى البناء أصلاً.

    وهذه الهجراتُ تجري الآن في بناء المنصّة، فسجلُّها هو ما يُقرأ عند
    العطب. فيُقال ما نقص.
  */
  if (!process.env.DATABASE_URL) {
    console.error("✕ DATABASE_URL غير مضبوط — لا قاعدةَ تُهاجَر.");
    console.error("  محلّياً:  npm run db:migrate   (يقرأ .env)");
    console.error("  في النشر: يُحقَن من متغيّرات المشروع في المنصّة.");
    process.exit(1);
  }

  /*
    ── على الاتّصال المباشر، والقفلُ يُفرَج عنه بيد ──

    القفلُ الاستشاريّ للجلسة، والمجمِّعُ (نقطةُ `-pooler`) لا يعطي الجلسةَ
    اتّصالاً بعينه: كان القفلُ يبقى على اتّصالٍ حيٍّ في المجمِّع بعد انتهاء
    التشغيل، فيسقط كلُّ نشرٍ بعده «القفل مأخوذ» حتى يُعاد تدويرُ ذلك الاتّصال
    (٢٦ سبتمبر ٢٠٢٦، على الإنتاج والمعاينة معاً). انظر `direct-url.ts`.
  */
  const client = new Client({ connectionString: directDatabaseUrl(process.env.DATABASE_URL) });
  await client.connect();
  const finish = async (code: number): Promise<never> => {
    await client.query("select pg_advisory_unlock(hashtext('tph-migrate'))").catch(() => undefined);
    await client.end();
    process.exit(code);
  };

  /*
    ── القفل يُنتظَر ولا يُفشَل عنده فوراً ──

    كان `pg_try_advisory_lock` يُسأل مرّةً، فإن وجد القفلَ مأخوذاً خرج
    بـ1. وذلك يصحّ حين يشغّلها إنسانٌ بيده: يرى الرسالة ويعيد.

    وقد صارت تُشغَّل في **بناء Vercel** (انظر `vercel-build`)، وهناك
    يقع البناءان معاً عادةً — نشرُ المعاينة ونشرُ الإنتاج، أو دفعتان
    متتابعتان. فيفشل أحدُهما لا لعطبٍ بل لأنّ الآخر سبقه بثانية،
    **ويُقرأ الفشلُ عطباً في الهجرة وليس كذلك**.

    فيُنتظَر القفل عشر مرّات بثانيتين — وهي أطولُ ممّا تستغرقه هجرةٌ
    عاديّة بكثير. وإن لم يُفرَج عنه فذلك تعلّقٌ حقيقيّ يستحقّ الفشل.
  */
  let locked = false;
  for (let attempt = 1; attempt <= 10 && !locked; attempt++) {
    locked = (await client.query<{ ok: boolean }>(
      "select pg_try_advisory_lock(hashtext('tph-migrate')) as ok",
    )).rows[0]?.ok ?? false;
    if (!locked) {
      console.log(`… القفل مأخوذ — انتظارٌ (${attempt}/10)`);
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
  if (!locked) {
    console.error("✕ تشغيلٌ آخر للهجرات لم يُفرِج عن القفل بعد عشرين ثانية — افحصه:");
    console.error("  select pid, state, backend_start from pg_locks join pg_stat_activity using (pid) where locktype = 'advisory';");
    await client.end();
    process.exit(1);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      sha256     text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = new Map<string, string>(
    (await client.query<{ name: string; sha256: string }>("select name, sha256 from schema_migrations")).rows
      .map((r) => [r.name, r.sha256]),
  );

  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  const reapply = reapplyTargets(process.argv);
  let ran = 0;

  /* الاختلاف يُفحَص كلُّه قبل أن يُطبَّق شيء — فلا يقف الشوط في منتصفه */
  const drifted = files.filter((name) => {
    const before = applied.get(name);
    if (!before) return false;
    const sha = createHash("sha256").update(readFileSync(join(DIR, name), "utf8")).digest("hex");
    return before !== sha && !reapply.has(name);
  });
  if (drifted.length > 0) {
    console.error("✕ هجراتٌ مطبَّقة تغيّر ملفّها — القاعدة والملفّ افترقا:");
    for (const d of drifted) console.error(`    ${d}`);
    console.error("  لا يُعاد تطبيقها بصمت. إن كان التغيير مقصوداً:  npm run db:migrate -- --reapply <الاسم>");
    await finish(1);
  }

  for (const name of files) {
    const sql = readFileSync(join(DIR, name), "utf8");
    const sha256 = createHash("sha256").update(sql).digest("hex");
    const before = applied.get(name);

    if (before === sha256) {
      console.log(`  ✓ ${name} (مطبَّقة)`);
      continue;
    }
    if (before) console.log(`  ↻ ${name} — تُعاد بطلبٍ صريح`);

    process.stdout.write(`  … ${name}`);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        `insert into schema_migrations (name, sha256) values ($1, $2)
         on conflict (name) do update set sha256 = excluded.sha256, applied_at = now()`,
        [name, sha256],
      );
      await client.query("commit");
      console.log(`\r  ✓ ${name} — طُبّقت`);
      ran++;
    } catch (e) {
      await client.query("rollback");
      console.log(`\r  ✕ ${name} — فشلت`);
      console.error((e as Error).message);
      await finish(1);
    }
  }

  console.log(`\n${ran === 0 ? "القاعدة محدَّثة." : `طُبّقت ${ran} هجرة.`}\n`);
  await finish(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
