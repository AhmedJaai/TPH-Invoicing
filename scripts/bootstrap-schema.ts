/**
 * تأسيس الجداول على قاعدةٍ فارغة — مرّةً واحدة، ثمّ `db:migrate` وحده.
 *
 * كان `db:push` أمراً متاحاً في كلّ وقت، وهو يناقض قرار «لا drizzle-kit
 * push»: يُطبّق فرق المخطّط بلا أثرٍ يُراجَع، وقد يحذف عموداً. فصار التأسيس
 * يرفض أيّ قاعدةٍ فيها جدولٌ واحد من جداولنا.
 *
 * ── والتأسيس نفسه كان `drizzle-kit push` ثمّ `db:migrate` — ولم يعمل ──
 *
 * جُرّب على قاعدةٍ فارغة: `push` يطلب طرفيّةً تفاعليّة فيسقط في CI، ولو
 * أُجبر ثمّ شُغّلت الهجرات سقطت `002` لأنّها تقرأ `is_tax_valid` — عمودٌ
 * قديم لم يعد في `schema.ts`. ولو تُجووِزت لما صار المخطّط مخطّطَ الإنتاج:
 * هجراتٌ مكتوبة `CREATE TABLE IF NOT EXISTS` تتخطّى جدولاً أنشأه push،
 * فتسقط منه قيود `CHECK` صامتة (`ai_findings` و`adjudications` وغيرهما).
 *
 * فالتأسيس صار `drizzle/baseline.sql` — مخطّطُ `public` كما هو في الإنتاج
 * عند آخر هجرةٍ فيه، بأسماء هجراته — ثمّ `db:migrate` يطبّق ما جاء بعده.
 * وهو المسار نفسه الذي تمرّ به قاعدة الإنتاج، فما يُختبَر هو ما يعمل.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows } = await client.query<{ n: number }>(
    `select count(*)::int n from pg_class c join pg_namespace s on s.oid = c.relnamespace
      where s.nspname = 'public' and c.relkind in ('r', 'p')`,
  );

  if (Number(rows[0]?.n) > 0) {
    await client.end();
    console.error("\n✕ القاعدة فيها جداول — التأسيس لا يُعاد. غيّر المخطّط بهجرةٍ في drizzle/sql ثمّ npm run db:migrate\n");
    process.exit(1);
  }

  const baseline = readFileSync(join(process.cwd(), "drizzle", "baseline.sql"), "utf8");
  try {
    await client.query("begin");
    await client.query(baseline);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    await client.end();
    console.error(`\n✕ تعذّر تطبيق drizzle/baseline.sql — لم يُكتب شيء: ${(e as Error).message}\n`);
    process.exit(1);
  }
  const [{ n }] = (await client.query<{ n: number }>("select count(*)::int n from schema_migrations")).rows;
  await client.end();
  console.log(`✓ أُسِّس المخطّط من drizzle/baseline.sql (${n} هجرة مسجَّلة) — والآن ما بعدها:`);

  const run = spawnSync("npx", ["tsx", "scripts/migrate.ts"], { stdio: "inherit", env: process.env });
  process.exit(run.status ?? 1);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
