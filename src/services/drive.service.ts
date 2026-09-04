/**
 * خدمة الدرايف: الرفع وحده.
 *
 * مبدأ ثابت يسري على الملف كلّه: لا حذف ولا نقل ولا إعادة تسمية لملف قائم.
 * الدوال هنا تُنشئ مجلداً إن غاب، وترفع ملفاً باسم لم يُستعمل — لا أكثر.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { driveConfig } from "@/config/drive";
import { driveForUser, existingNamesIn, findOrCreateFolder, uploadFile } from "@/lib/drive";
import { resolveNameCollision } from "@/lib/naming";

/** خطأ يُترجم في الواجهة إلى ٤٢٨: لا تفويض درايف لهذا المستخدم. */
export class NoDriveAuthorizationError extends Error {
  constructor() {
    super("لا يوجد تفويض درايف لحسابك. سجّل الخروج ثم الدخول ووافق على صلاحية الدرايف.");
    this.name = "NoDriveAuthorizationError";
  }
}

/** خطأ يُترجم إلى ٥٠٢: الدرايف رفض أو تعذّر الوصول إليه. */
export class DriveUnavailableError extends Error {
  constructor(cause: string) {
    super(`تعذّر الرفع إلى الدرايف: ${cause}`);
    this.name = "DriveUnavailableError";
  }
}

/** خطأ يُترجم إلى ٤٠٠: سنة لا مجلد لها في الإعدادات. */
export class UnknownYearError extends Error {
  constructor(year: string) {
    super(`لا يوجد مجلد لسنة ${year} في الإعدادات`);
    this.name = "UnknownYearError";
  }
}

/** تفويض الدرايف الخاصّ بالمستخدم — الرفع بصلاحيته هو ما يجعل سجلّ الدرايف صادقاً. */
export async function refreshTokenFor(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ token: accounts.refresh_token })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")))
    .limit(1);
  return row?.token ?? null;
}

export interface ArchiveToDriveInput {
  userId: string;
  periodMonth: string;
  folderName: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
}

export interface ArchivedFile {
  fileId: string;
  fileName: string;
  folderId: string;
  webViewLink?: string;
  /** أُضيف رقم نسخة لأنّ الاسم مستعمل — لم يُستبدل ملف قائم */
  renamed: boolean;
}

export async function archiveToDrive(input: ArchiveToDriveInput): Promise<ArchivedFile> {
  const token = await refreshTokenFor(input.userId);
  if (!token) throw new NoDriveAuthorizationError();

  const year = input.periodMonth.slice(0, 4);
  const yearFolderId = driveConfig.yearFolderIds[year];
  if (!yearFolderId) throw new UnknownYearError(year);

  const drive = driveForUser(token);

  try {
    const monthFolderId = await findOrCreateFolder(drive, yearFolderId, input.periodMonth);
    const folderId = await findOrCreateFolder(drive, monthFolderId, input.folderName);
    const taken = await existingNamesIn(drive, folderId);
    const finalName = resolveNameCollision(input.fileName, taken);

    const uploaded = await uploadFile(drive, {
      folderId,
      fileName: finalName,
      mimeType: input.mimeType || "application/pdf",
      data: input.data,
    });

    return {
      fileId: uploaded.fileId,
      fileName: finalName,
      folderId,
      webViewLink: uploaded.webViewLink,
      renamed: finalName !== input.fileName,
    };
  } catch (e) {
    if (e instanceof UnknownYearError) throw e;
    throw new DriveUnavailableError((e as Error).message);
  }
}
