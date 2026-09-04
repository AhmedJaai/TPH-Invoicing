/**
 * مشغّل الهجرات.
 *
 *   npm run db:migrate
 *
 * `drizzle-kit push` يقارن المخطّط بالقاعدة ويسأل عمّا التبس عليه، فلا يصلح
 * في بيئة غير تفاعلية، ولا يترك أثراً يُراجَع لما جرى. فالهجرات هنا ملفات
 * SQL صريحة، تُطبَّق بالترتيب مرّة واحدة، ويُسجَّل ما طُبّق منها.
 *
 * وكل ملف مكتوب ليُعاد تشغيله بلا ضرر (IF NOT EXISTS وأمثالها)، فانقطاع
 * الشوط لا يترك القاعدة في حال وسط.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Pool } from "pg";

const DIR = join(process.cwd(), "drizzle", "sql");

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      sha256     text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = new Map<string, string>(
    (await pool.query<{ name: string; sha256: string }>("select name, sha256 from schema_migrations")).rows
      .map((r) => [r.name, r.sha256]),
  );

  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  let ran = 0;

  for (const name of files) {
    const sql = readFileSync(join(DIR, name), "utf8");
    const sha256 = createHash("sha256").update(sql).digest("hex");
    const before = applied.get(name);

    if (before === sha256) {
      console.log(`  ✓ ${name} (مطبَّقة)`);
      continue;
    }
    if (before && before !== sha256) {
      // تغيير هجرة مطبَّقة يعني أنّ القاعدة والملف افترقا — يُعلن ولا يُبتلَع
      console.log(`  ⚠ ${name} تغيّرت بعد تطبيقها — تُعاد (الملفات مكتوبة لتحتمل الإعادة)`);
    }

    process.stdout.write(`  … ${name}`);
    const client = await pool.connect();
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
      await pool.end();
      process.exit(1);
    } finally {
      client.release();
    }
  }

  console.log(`\n${ran === 0 ? "القاعدة محدَّثة." : `طُبّقت ${ran} هجرة.`}\n`);
  await pool.end();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
