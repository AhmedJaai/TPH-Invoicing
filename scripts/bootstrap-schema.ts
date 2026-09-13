/**
 * تأسيس الجداول على قاعدةٍ فارغة — مرّةً واحدة، ثمّ `db:migrate` وحده.
 *
 * كان `db:push` أمراً متاحاً في كلّ وقت، وهو يناقض قرار «لا drizzle-kit
 * push»: يُطبّق فرق المخطّط بلا أثرٍ يُراجَع، وقد يحذف عموداً. فصار التأسيس
 * يرفض أيّ قاعدةٍ فيها جدولٌ واحد من جداولنا.
 */
import { spawnSync } from "node:child_process";
import { Client } from "pg";

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows } = await client.query<{ exists: boolean }>(
    "select to_regclass('public.users') is not null as exists",
  );
  await client.end();

  if (rows[0]?.exists) {
    console.error("\n✕ القاعدة مؤسَّسة — التأسيس لا يُعاد. غيّر المخطّط بهجرةٍ في drizzle/sql ثمّ npm run db:migrate\n");
    process.exit(1);
  }

  const run = spawnSync("npx", ["drizzle-kit", "push"], { stdio: "inherit" });
  process.exit(run.status ?? 1);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
