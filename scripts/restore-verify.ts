/**
 * تجربةُ استعادة النسخة — «نسخةٌ لم تُجرَّب استعادتُها أملٌ لا نسخة».
 *
 *   npm run db:restore-verify -- <مجلّد النسخة> <سلسلة قاعدةٍ فارغة> [--attest <من>]
 *
 * يستعيد في قاعدةٍ يسمّيها المستخدم **صراحةً في الأمر** — لا من
 * `DATABASE_URL`، فلا يُستعاد فوق الإنتاج لأنّ متغيّراً نُسي. ويرفض قاعدةً
 * فيها جدولٌ واحد: الاستعادة فوق بياناتٍ قائمة تخلط نسختين ولا تُثبت شيئاً.
 *
 * والاستعادة كلّها معاملةٌ واحدة: إن سقطت في منتصفها بقيت القاعدة فارغةً
 * كما كانت، لا نصفَ مستعادة يظنّها أحدٌ كاملة.
 *
 * ثمّ يقارن كلَّ جدولٍ ببصمته في البيان، وكلَّ قسمٍ من المخطّط ببصمته.
 * ولا يكتب `backupRestored` في `ops-attestation.json` إلّا إن طابق الكلّ
 * وطُلب ذلك بـ`--attest`.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { Client } from "pg";
import {
  BACKUP_SCHEMAS, catalogQueries, compareTables, contentHashSql, dataFileName, lit,
  qualified, type Catalog, type Manifest,
} from "@/lib/ops/backup";

const md5 = (s: string | Buffer) => createHash("md5").update(s).digest("hex");

function argAfter(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const attestBy = argAfter("--attest");
  const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--attest");
  const [dir, target] = positional;
  if (!dir || !target) {
    console.error("✕ الاستعمال:  npm run db:restore-verify -- <مجلّد النسخة> <postgres://…/قاعدةٌ فارغة>");
    process.exit(2);
  }
  if (target === process.env.DATABASE_URL) {
    console.error("✕ الهدف هو قاعدة DATABASE_URL نفسها — الاستعادة تكون في قاعدةٍ أخرى فارغة.");
    process.exit(2);
  }

  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;

  /* ── ١. الملفّات كما كُتبت ── */
  const broken = Object.entries(manifest.files).filter(([name, sum]) => {
    const full = path.join(dir, name);
    return !existsSync(full) || md5(readFileSync(full)) !== sum;
  });
  if (broken.length > 0) {
    console.error("✕ ملفّاتٌ في النسخة تغيّرت أو غابت منذ أُخذت:");
    for (const [name] of broken) console.error(`    ${name}`);
    process.exit(1);
  }

  const dst = new Client({ connectionString: target });
  await dst.connect();
  try {
    /* ── ٢. الهدف فارغ ── */
    const inList = BACKUP_SCHEMAS.map(lit).join(", ");
    const [{ n: existing }] = (await dst.query<{ n: number }>(
      `select count(*)::int n from pg_class c join pg_namespace s on s.oid = c.relnamespace
        where s.nspname in (${inList}) and c.relkind in ('r', 'p')`,
    )).rows;
    if (existing > 0) {
      console.error(`✕ القاعدة الهدف فيها ${existing} جدولاً — الاستعادة لا تكون إلّا في قاعدةٍ فارغة.`);
      process.exit(1);
    }
    const [dinfo] = (await dst.query<{ id: string; db: string }>(
      "select (pg_control_system()).system_identifier::text id, current_database()::text db",
    )).rows;
    if (dinfo.id === manifest.source.systemIdentifier && dinfo.db === manifest.source.database) {
      console.error("✕ الهدف هو القاعدة التي أُخذت منها النسخة.");
      process.exit(1);
    }

    /* ── ٣. الاستعادة بترتيب الأقسام، في معاملةٍ واحدة ── */
    await dst.query("set TimeZone = 'UTC'");
    await dst.query("begin");
    await dst.query(readFileSync(path.join(dir, "schema-pre-data.sql"), "utf8"));
    let loaded = 0;
    for (const [table, meta] of Object.entries(manifest.tables)) {
      if (meta.n === 0) continue;
      const rows = JSON.parse(gunzipSync(readFileSync(path.join(dir, "data", dataFileName(table)))).toString("utf8")) as unknown[];
      for (let i = 0; i < rows.length; i += 500) {
        await dst.query(
          `insert into ${table} select * from json_populate_recordset(null::${table}, $1::json)`,
          [JSON.stringify(rows.slice(i, i + 500))],
        );
      }
      loaded += rows.length;
    }
    await dst.query(readFileSync(path.join(dir, "schema-post-data.sql"), "utf8"));
    await dst.query("commit");
    await dst.query("analyze");

    /* ── ٤. المقارنة ── */
    const queries = catalogQueries();
    const cat = {} as Catalog;
    for (const [k, q] of Object.entries(queries)) {
      (cat as unknown as Record<string, unknown[]>)[k] = (await dst.query(q)).rows;
    }
    const schemaDiff = (Object.keys(queries) as (keyof Catalog)[])
      .filter((k) => md5(JSON.stringify(cat[k])) !== manifest.schema[k]);

    const actual: Record<string, { n: number; h: string }> = {};
    for (const t of cat.tables) {
      const key = qualified(t.sch, t.name);
      const columns = cat.columns.filter((c) => c.sch === t.sch && c.tbl === t.name).map((c) => c.col);
      const [r] = (await dst.query<{ n: number; h: string }>(contentHashSql(key, columns))).rows;
      actual[key] = { n: Number(r.n), h: r.h };
    }
    const cmp = compareTables(manifest, actual);
    const matched = cmp.filter((c) => c.ok).length;

    console.log(`\nاستُعيدت نسخة ${manifest.takenAt} (${manifest.source.database}) إلى ${dinfo.db} — ${loaded} صفّاً`);
    console.log(`  الجداول: ${matched} من ${cmp.length} مطابقة`);
    for (const c of cmp.filter((x) => !x.ok)) {
      console.log(`    ✕ ${c.table}: متوقَّع ${c.expected.n} صفّاً، وُجد ${c.actual?.n ?? "لا جدول"}`);
    }
    console.log(`  المخطّط: ${schemaDiff.length === 0 ? "مطابق في أقسامه السبعة" : `افترق في: ${schemaDiff.join("، ")}`}`);

    const ok = matched === cmp.length && schemaDiff.length === 0;
    if (ok && attestBy) {
      const file = "ops-attestation.json";
      const att = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
      att.backupRestored = { at: new Date().toISOString().slice(0, 10), by: attestBy, into: dinfo.db };
      writeFileSync(file, JSON.stringify(att, null, 2) + "\n");
      console.log(`  ✓ سُجّل backupRestored في ${file}`);
    }
    console.log(ok ? "\n✓ النسخة تُستعاد وتطابق.\n" : "\n✕ النسخة لا تطابق ما استُعيد منها.\n");
    process.exit(ok ? 0 : 1);
  } catch (e) {
    await dst.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    await dst.end().catch(() => undefined);
  }
}

main().catch((e) => { console.error("✕", (e as Error).message); process.exit(1); });
