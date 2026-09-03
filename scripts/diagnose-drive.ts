/** تشخيص مسار الرفع بلا رفع: يفحص كل خطوة ويقيس زمنها. */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, users } from "@/db/schema";
import { driveForUser, findOrCreateFolder, existingNamesIn } from "@/lib/drive";
import { resolveNameCollision } from "@/lib/naming";
import { driveConfig } from "@/config/drive";

const step = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const t = Date.now();
  try {
    const r = await fn();
    console.log(`  ✓ ${label} — ${((Date.now() - t) / 1000).toFixed(1)}ث`);
    return r;
  } catch (e) {
    console.log(`  ✕ ${label} — ${((Date.now() - t) / 1000).toFixed(1)}ث — ${(e as Error).message}`);
    throw e;
  }
};

async function main() {
  const [u] = await db.select({ id: users.id, email: users.email }).from(users).limit(1);
  console.log(`\nالمستخدم: ${u?.email ?? "لا يوجد"}`);

  const [acc] = await db
    .select({ token: accounts.refresh_token })
    .from(accounts)
    .where(and(eq(accounts.userId, u.id), eq(accounts.provider, "google")));

  if (!acc?.token) { console.log("  ✕ لا يوجد refresh_token"); process.exit(1); }
  console.log(`  ✓ refresh_token موجود (${acc.token.length} حرفاً)\n`);

  const drive = driveForUser(acc.token);
  const year = driveConfig.yearFolderIds["2026"];

  const monthId = await step("إيجاد مجلد الشهر 2026-08", () => findOrCreateFolder(drive, year, "2026-08"));
  const folderId = await step("إيجاد مجلد المورّد BeCof (بيكوف)", () => findOrCreateFolder(drive, monthId, "BeCof (بيكوف)"));
  const names = await step("قراءة أسماء الملفات في المجلد", () => existingNamesIn(drive, folderId));

  console.log(`\n  الملفات الموجودة: ${names.length}`);
  for (const n of names.slice(0, 6)) console.log(`     · ${n}`);

  const desired = "2026-08-13_BeCof_Invoice_00282_SAR150.00.pdf";
  console.log(`\n  الاسم المطلوب : ${desired}`);
  console.log(`  الاسم المحسوب : ${resolveNameCollision(desired, names)}`);
  console.log(`\n  (لم يُرفع شيء — تشخيص فقط)\n`);
  process.exit(0);
}
main().catch((e) => { console.error("\nتوقّف:", e.message, "\n"); process.exit(1); });
