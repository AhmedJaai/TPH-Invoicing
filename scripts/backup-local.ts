/**
 * النسخة الاحتياطيّة اليوميّة على جهاز المالك — قراءةٌ كلّها، لا يُكتب في القاعدة ولا في الدرايف.
 *
 *   npm run backup:local                 ← يدوياً
 *   npm run backup:install               ← يُجدوِلها كلَّ يوم (launchd)
 *
 * تُكتب في ~/TPH-Backups (أو BACKUP_ROOT):
 *   days/<اليوم>/db/        القاعدة كاملةً بنصّ `db:backup` ولقطتِه المتّسقة
 *   days/<اليوم>/code/      المستودع بكلّ فروعه وتاريخه (git bundle) + الشجرة كما هي الآن بما لم يُرفع
 *   days/<اليوم>/secrets/   ملفّات .env — لا تُشارَك ولا تُرفع
 *   days/<اليوم>/memory/    ذاكرة Claude لهذا المشروع
 *   days/<اليوم>/drive-index.json   كلُّ ملفٍّ في الأرشيف بمساره وبصمته يومَها
 *   drive/files/            مرآة الأرشيف — تُزاد ولا يُحذف منها
 *   drive/_versions/        ما تغيّر محتواه في الدرايف تُحفظ نسختُه القديمة هنا
 *   last-run.json · backup.log
 *
 * يبقى ١٤ يوماً كاملة، ثمّ أوّلُ نسخةٍ من كلّ شهر لسنتين (`src/lib/ops/local-backup.ts`).
 * وإن فشل جزءٌ ظهر إشعارٌ على الجهاز، وكُتب في last-run.json، ولم تُحذف نسخةٌ قديمة.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, copyFileSync, cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync,
  renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { drive_v3 } from "googleapis";
import { Client } from "pg";
import { driveForCli, getFileMeta, isFolder, listChildren, type DriveFile } from "@/lib/drive";
import {
  daysToPrune, disambiguate, GOOGLE_EXPORTS, mirrorVersion, needsDownload, safeSegment,
} from "@/lib/ops/local-backup";
import { todayInRiyadh } from "@/lib/riyadh-time";

const REPO = path.resolve(__dirname, "..");
const ROOT = process.env.BACKUP_ROOT ?? path.join(homedir(), "TPH-Backups");
const DAY = todayInRiyadh();
const DAY_DIR = path.join(ROOT, "days", DAY);
const MIRROR = path.join(ROOT, "drive");
const STATE_FILE = path.join(MIRROR, "state.json");

const log = (s: string) => {
  const line = `${new Date().toISOString()}  ${s}`;
  console.log(line);
  try { writeFileSync(path.join(ROOT, "backup.log"), line + "\n", { flag: "a" }); } catch { /* المجلّد لم يُنشأ بعد */ }
};

function sizeOf(p: string): number {
  if (!existsSync(p)) return 0;
  const s = statSync(p);
  if (!s.isDirectory()) return s.size;
  return readdirSync(p).reduce((a, n) => a + sizeOf(path.join(p, n)), 0);
}
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} م.ب`;

/* ── ١. القاعدة ── */
function backupDatabase(): string {
  const out = path.join(DAY_DIR, "db");
  rmSync(out, { recursive: true, force: true }); // تشغيلٌ ثانٍ في اليوم نفسه يأخذ لقطةً أحدث
  const tsx = path.join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
  const r = spawnSync(process.execPath, [tsx, "--env-file=.env", "scripts/backup.ts", out], {
    cwd: REPO, encoding: "utf8", timeout: 20 * 60_000,
  });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || "توقّف بلا رسالة").trim().split("\n").slice(-3).join(" "));
  // البيان يحمل بصمة كلّ ملفّ — يُفحص فوراً أنّ ما على القرص هو ما كُتب.
  const manifest = JSON.parse(readFileSync(path.join(out, "manifest.json"), "utf8")) as {
    files: Record<string, string>; tables: Record<string, { n: number }>;
  };
  for (const [name, sum] of Object.entries(manifest.files)) {
    const got = createHash("md5").update(readFileSync(path.join(out, name))).digest("hex");
    if (got !== sum) throw new Error(`ملفّ ${name} لا يطابق بصمته`);
  }
  const rows = Object.values(manifest.tables).reduce((a, t) => a + t.n, 0);
  return `${Object.keys(manifest.tables).length} جدولاً · ${rows} صفّاً · ${mb(sizeOf(out))}`;
}

/* ── ٢. الشيفرة ── */
function backupCode(): string {
  const out = path.join(DAY_DIR, "code");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const git = (...a: string[]) => execFileSync("git", a, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  git("bundle", "create", path.join(out, "repo.bundle"), "--all");
  // ما في الشجرة الآن، بما لم يُرفع ولم يُلتزَم — بلا node_modules ولا ما يتجاهله git.
  const files = git("ls-files", "-z", "--cached", "--others", "--exclude-standard")
    .split("\0").filter((f) => f && !f.startsWith(".claude/worktrees/") && existsSync(path.join(REPO, f)));
  const list = path.join(out, ".files");
  writeFileSync(list, files.join("\0"));
  execFileSync("tar", ["-czf", path.join(out, "worktree.tar.gz"), "--null", "-T", list], { cwd: REPO });
  rmSync(list);
  writeFileSync(path.join(out, "status.txt"), git("status", "--short", "--branch") + "\n" + git("log", "-1", "--format=%H %s"));
  return `${files.length} ملفّاً · ${mb(sizeOf(out))}`;
}

/* ── ٣. الأسرار والذاكرة ── */
function backupSecrets(): string {
  const out = path.join(DAY_DIR, "secrets");
  mkdirSync(out, { recursive: true });
  chmodSync(out, 0o700);
  const names = readdirSync(REPO).filter((n) => n.startsWith(".env") && n !== ".env.example");
  for (const n of names) {
    copyFileSync(path.join(REPO, n), path.join(out, n));
    chmodSync(path.join(out, n), 0o600);
  }
  for (const n of ["ops-attestation.json", "truth-audit.json"]) {
    if (existsSync(path.join(REPO, n))) copyFileSync(path.join(REPO, n), path.join(out, n));
  }
  const memory = path.join(homedir(), ".claude", "projects", REPO.replace(/[^A-Za-z0-9]/g, "-"), "memory");
  if (existsSync(memory)) cpSync(memory, path.join(DAY_DIR, "memory"), { recursive: true });
  return `${names.join(" · ")}${existsSync(memory) ? " + الذاكرة" : ""}`;
}

/* ── ٤. الدرايف ── */
interface MirrorEntry { version: string | null; path: string; name: string; drivePath: string }
type MirrorState = Record<string, MirrorEntry>;

async function storedDrive(pg: Client): Promise<drive_v3.Drive> {
  return driveForCli(async () => {
    const r = await pg.query<{ t: string }>(
      "select refresh_token t from accounts where provider = 'google' and refresh_token is not null limit 1",
    );
    return r.rows[0]?.t ?? null;
  });
}

async function download(drive: drive_v3.Drive, f: DriveFile, dest: string): Promise<void> {
  mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  const exp = GOOGLE_EXPORTS[f.mimeType];
  const res = exp
    ? await drive.files.export({ fileId: f.id, mimeType: exp.mime }, { responseType: "stream" })
    : await drive.files.get({ fileId: f.id, alt: "media", supportsAllDrives: true }, { responseType: "stream" });
  await pipeline(res.data as NodeJS.ReadableStream, createWriteStream(tmp));
  renameSync(tmp, dest); // لا يبقى في المرآة نصفُ ملفّ يُظنّ كاملاً
}

async function backupDrive(): Promise<string> {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  await pg.query("set default_transaction_read_only = on");
  let drive: drive_v3.Drive;
  let referenced: string[];
  try {
    drive = await storedDrive(pg);
    referenced = (await pg.query<{ id: string }>(
      `select drive_file_id id from documents where drive_file_id is not null
       union select contract_drive_file_id from suppliers where contract_drive_file_id is not null`,
    )).rows.map((r) => r.id);
  } finally {
    await pg.end();
  }

  const rootId = process.env.DRIVE_ACCOUNTS_FOLDER_ID;
  if (!rootId) throw new Error("DRIVE_ACCOUNTS_FOLDER_ID غير مضبوط");

  // المشي على الأرشيف كلّه: كلّ ملفٍّ بمساره من الجذر.
  const found: { file: DriveFile; rel: string; drivePath: string }[] = [];
  const walk = async (folderId: string, rel: string, drivePath: string) => {
    const children = await listChildren(drive, folderId);
    const used = new Set<string>();
    for (const c of children) {
      let seg = safeSegment(c.name);
      if (!isFolder(c) && GOOGLE_EXPORTS[c.mimeType]) seg += GOOGLE_EXPORTS[c.mimeType].ext;
      if (used.has(seg.toLowerCase())) seg = disambiguate(seg, c.id);
      used.add(seg.toLowerCase());
      if (isFolder(c)) await walk(c.id, path.join(rel, seg), `${drivePath}/${c.name}`);
      else found.push({ file: c, rel: path.join(rel, seg), drivePath: `${drivePath}/${c.name}` });
    }
  };
  await walk(rootId, "ACCOUNTS", "ACCOUNTS");

  // وما يشير إليه دفترُنا خارج الأرشيف (عقدٌ في مجلّدٍ آخر مثلاً).
  const seen = new Set(found.map((x) => x.file.id));
  const missing: string[] = [];
  for (const id of referenced) {
    if (seen.has(id)) continue;
    const meta = await getFileMeta(drive, id).catch(() => null);
    if (!meta || isFolder(meta)) { missing.push(id); continue; }
    found.push({ file: meta, rel: path.join("_خارج الأرشيف", disambiguate(safeSegment(meta.name), meta.id)), drivePath: `(خارج الأرشيف)/${meta.name}` });
    seen.add(id);
  }

  mkdirSync(MIRROR, { recursive: true });
  const state: MirrorState = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
  const onDisk = (p: string) => existsSync(path.join(MIRROR, "files", p));
  const todo = found.filter(({ file, rel }) => needsDownload(state[file.id], mirrorVersion(file), rel, onDisk));

  let done = 0;
  const failed: string[] = [];
  const queue = [...todo];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const { file, rel, drivePath } = job;
      const prev = state[file.id];
      try {
        // نسخةٌ تغيّر محتواها: القديمة تُنقل إلى _versions ولا تُستبدَل.
        if (prev && prev.version !== mirrorVersion(file) && onDisk(prev.path)) {
          const old = path.join(MIRROR, "_versions", DAY, prev.path);
          mkdirSync(path.dirname(old), { recursive: true });
          renameSync(path.join(MIRROR, "files", prev.path), old);
        }
        await download(drive, file, path.join(MIRROR, "files", rel));
        state[file.id] = { version: mirrorVersion(file), path: rel, name: file.name, drivePath };
        done++;
        if (done % 50 === 0) {
          writeFileSync(STATE_FILE, JSON.stringify(state)); // انقطاعٌ في منتصف أوّل تشغيل لا يُعيد ما نُزِّل
          log(`  الدرايف: ${done}/${todo.length}`);
        }
      } catch (e) {
        failed.push(`${drivePath}: ${(e as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  writeFileSync(STATE_FILE, JSON.stringify(state));

  writeFileSync(path.join(DAY_DIR, "drive-index.json"), JSON.stringify(found.map(({ file, rel, drivePath }) => ({
    id: file.id, drivePath, mirrorPath: rel, size: file.size ?? null, md5: file.md5Checksum ?? null,
    modifiedTime: file.modifiedTime ?? null,
  })), null, 1));

  const summary = `${found.length} ملفّاً في الأرشيف · ${done} نُزِّل اليوم · المرآة ${mb(sizeOf(path.join(MIRROR, "files")))}` +
    (missing.length ? ` · ${missing.length} مشارٌ إليه في الدفتر لم يُعثر عليه (drive-missing.txt)` : "");
  if (missing.length) writeFileSync(path.join(DAY_DIR, "drive-missing.txt"), missing.join("\n"));
  if (failed.length > 0) {
    writeFileSync(path.join(DAY_DIR, "drive-failures.txt"), failed.join("\n"));
    throw new Error(`${failed.length} ملفّاً تعذّر تنزيله (drive-failures.txt) — ${summary}`);
  }
  return summary;
}

function notify(title: string, body: string) {
  const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  spawnSync("osascript", ["-e", `display notification "${q(body)}" with title "${q(title)}"`]);
}

async function main() {
  mkdirSync(DAY_DIR, { recursive: true });
  log(`— نسخة ${DAY} في ${DAY_DIR}`);

  const steps: [string, () => string | Promise<string>][] = [
    ["القاعدة", backupDatabase],
    ["الشيفرة", backupCode],
    ["الأسرار", backupSecrets],
    ["الدرايف", backupDrive],
  ];
  const results: Record<string, { ok: boolean; detail: string }> = {};
  for (const [name, fn] of steps) {
    try {
      const detail = await fn();
      results[name] = { ok: true, detail };
      log(`✓ ${name}: ${detail}`);
    } catch (e) {
      results[name] = { ok: false, detail: (e as Error).message };
      log(`✕ ${name}: ${(e as Error).message}`);
    }
  }

  const ok = Object.values(results).every((r) => r.ok);
  writeFileSync(path.join(DAY_DIR, "report.json"), JSON.stringify({ day: DAY, at: new Date().toISOString(), ok, results }, null, 2));

  // الكنس بعد نجاحٍ كامل وحده: يومٌ فاشل لا يحذف نسخةً سليمة.
  if (ok) {
    for (const d of daysToPrune(readdirSync(path.join(ROOT, "days")))) {
      rmSync(path.join(ROOT, "days", d), { recursive: true, force: true });
      log(`  حُذفت نسخة ${d} (خارج مدّة الحفظ)`);
    }
  }

  const prev = existsSync(path.join(ROOT, "last-run.json")) ? JSON.parse(readFileSync(path.join(ROOT, "last-run.json"), "utf8")) : {};
  writeFileSync(path.join(ROOT, "last-run.json"), JSON.stringify({
    lastAttempt: new Date().toISOString(), lastSuccess: ok ? new Date().toISOString() : prev.lastSuccess ?? null, day: DAY, ok, results,
  }, null, 2));
  log(`${ok ? "✓ اكتملت" : "✕ ناقصة"} — الحجم الكلّي ${mb(sizeOf(ROOT))}`);

  if (!ok) {
    const bad = Object.entries(results).filter(([, r]) => !r.ok).map(([n]) => n).join("، ");
    notify("نسخة ذا بوبليك هاوس ناقصة", `تعذّر: ${bad}. التفصيل في ~/TPH-Backups/backup.log`);
    process.exit(1);
  }
}

main().catch((e) => {
  log(`✕ ${(e as Error).message}`);
  notify("نسخة ذا بوبليك هاوس فشلت", (e as Error).message.slice(0, 120));
  process.exit(1);
});
