/**
 * نسخةٌ احتياطيّة من القاعدة — تُقرأ ولا يُكتب فيها.
 *
 *   npm run db:backup -- <المجلّد>
 *
 * القراءة كلّها في معاملةٍ واحدة `REPEATABLE READ READ ONLY`: لقطةٌ متّسقة،
 * فلا تُنسَخ فاتورةٌ بلا تخصيصها لأنّ أحداً قيّد سداداً أثناء النسخ. والجلسة
 * نفسها `default_transaction_read_only`، فخطأٌ في هذا النصّ لا يكتب شيئاً.
 *
 * ماذا يُكتب وبأيّ ترتيب، وما يُستثنى، في `src/lib/ops/backup.ts`.
 * والنسخة لا تُعدّ نسخةً حتى تُجرَّب استعادتها: `npm run db:restore-verify`.
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { Client } from "pg";
import {
  BACKUP_SECTIONS, buildSchemaSql, catalogQueries, contentHashSql, dataFileName, exclusionOf,
  qualified, tableSelect, type Catalog, type Manifest,
} from "@/lib/ops/backup";

const md5 = (s: string | Buffer) => createHash("md5").update(s).digest("hex");

function commit(): string | null {
  try { return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return null; }
}

async function main() {
  const out = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!out) {
    console.error("✕ سمِّ المجلّد:  npm run db:backup -- <المجلّد>");
    process.exit(2);
  }
  mkdirSync(path.join(out, "data"), { recursive: true });
  if (readdirSync(path.join(out, "data")).length > 0) {
    console.error(`✕ ${out} فيه نسخةٌ سابقة — لا تُخلَط نسختان في مجلّد. اختر مجلّداً جديداً.`);
    process.exit(2);
  }

  const src = new Client({ connectionString: process.env.DATABASE_URL });
  await src.connect();
  await src.query("set default_transaction_read_only = on");
  await src.query("set TimeZone = 'UTC'");
  await src.query("begin isolation level repeatable read read only");

  try {
    const [info] = (await src.query<{ id: string; db: string; ver: string }>(
      "select (pg_control_system()).system_identifier::text id, current_database()::text db, current_setting('server_version') ver",
    )).rows;

    const queries = catalogQueries();
    const cat = {} as Catalog;
    for (const [k, q] of Object.entries(queries)) {
      (cat as unknown as Record<string, unknown[]>)[k] = (await src.query(q)).rows;
    }

    const { pre, post } = buildSchemaSql(cat);
    const files: Record<string, string> = {};
    writeFileSync(path.join(out, "schema-pre-data.sql"), pre);
    writeFileSync(path.join(out, "schema-post-data.sql"), post);
    files["schema-pre-data.sql"] = md5(pre);
    files["schema-post-data.sql"] = md5(post);

    const tables: Manifest["tables"] = {};
    let rows = 0;
    for (const t of cat.tables) {
      const key = qualified(t.sch, t.name);
      const columns = cat.columns.filter((c) => c.sch === t.sch && c.tbl === t.name).map((c) => c.col);
      const [{ j }] = (await src.query<{ j: string }>(
        `select coalesce(json_agg(x), '[]')::text j from (${tableSelect(key, columns)}) x`,
      )).rows;
      const gz = gzipSync(j);
      writeFileSync(path.join(out, "data", dataFileName(key)), gz);
      files[`data/${dataFileName(key)}`] = md5(gz);

      const [h] = (await src.query<{ n: number; h: string }>(contentHashSql(key, columns))).rows;
      const excluded = exclusionOf(key);
      tables[key] = { n: Number(h.n), h: h.h, ...(excluded ? { excluded } : {}) };
      rows += Number(h.n);
    }

    const manifest: Manifest & { commit: string | null } = {
      takenAt: new Date().toISOString(),
      source: { database: info.db, systemIdentifier: info.id, serverVersion: info.ver },
      sections: BACKUP_SECTIONS,
      schema: Object.fromEntries(
        Object.keys(queries).map((k) => [k, md5(JSON.stringify(cat[k as keyof Catalog]))]),
      ) as Manifest["schema"],
      tables,
      files,
      commit: commit(),
    };
    writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2));

    console.log(`✓ نسخة ${info.db} (${info.id}) في ${out}`);
    console.log(`  ${cat.tables.length} جدولاً · ${rows} صفّاً · ${cat.functions.length} دالّة · ${cat.triggers.length} مؤثِّراً`);
    console.log("  لا تُعدّ نسخةً حتى تُستعاد:  npm run db:restore-verify -- " + out + " <قاعدةٌ فارغة>");
  } finally {
    await src.query("rollback").catch(() => undefined);
    await src.end();
  }
}

main().catch((e) => { console.error("✕", (e as Error).message); process.exit(1); });
