/**
 * يملأ `documents.drive_md5` لما قُيّد قبل الهجرة ٠٣٣.
 *
 *   npm run db:backfill-md5                                  (عرضٌ بلا كتابة)
 *   npm run db:backfill-md5 -- --i-know-this-is-production   (يكتب)
 *
 * الدرايف يُقرأ ولا يُكتب فيه شيء: `getFileMeta` وحدها. والقاعدة يُكتب فيها
 * عمودٌ واحد لصفوفٍ فارغةٍ فيه — فالتشغيل مرّتين لا يغيّر ما كُتب.
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, documents } from "@/db/schema";
import { driveForCli, getFileMeta } from "@/lib/drive";
import { writeAllowed } from "./lib/guard-write";

async function main() {
  const write = writeAllowed();
  const drive = await driveForCli(async () => {
    const [a] = await db.select({ t: accounts.refresh_token }).from(accounts)
      .where(and(eq(accounts.provider, "google"), isNotNull(accounts.refresh_token))).limit(1);
    return a?.t ?? null;
  });

  const rows = await db.select({ id: documents.id, fileId: documents.driveFileId, name: documents.fileName })
    .from(documents)
    .where(and(isNotNull(documents.driveFileId), isNull(documents.driveMd5)));

  let found = 0, missing = 0;
  for (const r of rows) {
    const meta = await getFileMeta(drive, r.fileId!);
    if (!meta?.md5Checksum) { missing++; continue; }
    found++;
    if (write) {
      await db.update(documents).set({ driveMd5: meta.md5Checksum })
        .where(and(eq(documents.id, r.id), isNull(documents.driveMd5)));
    }
  }

  console.log(`${rows.length} مستنداً بلا بصمة درايف · وُجدت لـ${found} · لا بصمة لـ${missing}`);
  console.log(write ? "كُتبت." : "لم يُكتب شيء — أعد الأمر مع --i-know-this-is-production");
  process.exit(0);
}

main().catch((e) => { console.error("\nخطأ:", (e as Error).message); process.exit(1); });
