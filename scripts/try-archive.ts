/** ينفّذ مسار الأرشفة كاملاً كما تفعل الواجهة، ويقيس زمن كل خطوة. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, documents, users } from "@/db/schema";
import { driveForUser, findOrCreateFolder, existingNamesIn, uploadFile } from "@/lib/drive";
import { resolveNameCollision } from "@/lib/naming";
import { driveConfig } from "@/config/drive";

const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}ث`;
const step = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const s = Date.now();
  try {
    const r = await fn();
    console.log(`  ✓ ${label} — ${((Date.now() - s) / 1000).toFixed(1)}ث  (منذ البدء ${at()})`);
    return r;
  } catch (e) {
    console.log(`  ✕ ${label} — فشل بعد ${((Date.now() - s) / 1000).toFixed(1)}ث`);
    console.log(`     ${(e as Error).message}`);
    throw e;
  }
};

async function main() {
  const path = process.argv[2];
  const doUpload = process.argv.includes("--upload");
  const data = readFileSync(path);
  console.log(`\nالملف: ${path.split("/").pop()}  (${data.length} بايت)`);
  console.log(`الوضع: ${doUpload ? "رفع فعلي" : "تشخيص بلا رفع"}\n`);

  const [u] = await step("قراءة المستخدم", async () =>
    db.select({ id: users.id, email: users.email }).from(users).limit(1),
  ).then((r) => r);

  const [acc] = await step("قراءة مفتاح الدرايف", async () =>
    db.select({ token: accounts.refresh_token }).from(accounts)
      .where(and(eq(accounts.userId, u.id), eq(accounts.provider, "google"))),
  );
  if (!acc?.token) throw new Error("لا يوجد refresh_token");

  const sha = createHash("sha256").update(data).digest("hex");
  await step("فحص التكرار بالبصمة", async () =>
    db.select({ id: documents.id }).from(documents).where(eq(documents.sha256, sha)).limit(1),
  );

  const drive = driveForUser(acc.token);
  const monthId = await step("مجلد الشهر", () =>
    findOrCreateFolder(drive, driveConfig.yearFolderIds["2026"], "2026-08"),
  );
  const folderId = await step("مجلد المورّد", () =>
    findOrCreateFolder(drive, monthId, "BeCof (بيكوف)"),
  );
  const names = await step("أسماء الملفات الموجودة", () => existingNamesIn(drive, folderId));

  const desired = "2026-08-13_BeCof_Invoice_00282_SAR150.00.pdf";
  const final = resolveNameCollision(desired, names);
  console.log(`\n  الاسم النهائي: ${final}\n`);

  if (!doUpload) {
    console.log(`  (توقّفنا قبل الرفع — أضف --upload للرفع الفعلي)\n`);
    process.exit(0);
  }

  const up = await step("الرفع إلى الدرايف", () =>
    uploadFile(drive, { folderId, fileName: final, mimeType: "application/pdf", data }),
  );
  console.log(`\n  ✓ رُفع: ${up.fileName}`);
  console.log(`    ${up.webViewLink ?? up.fileId}\n`);
  process.exit(0);
}

main().catch((e) => { console.error(`\nتوقّف عند ${at()}: ${e.message}\n`); process.exit(1); });
