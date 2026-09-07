/**
 * طبقة الوصول إلى جوجل درايف.
 *
 * مبدأ ثابت: هذا الملف لا يحذف شيئاً أبداً. لا توجد فيه دالة حذف ولا نقل،
 * وأدوات المرحلة صفر تعمل بصلاحية قراءة فقط حتى تكون الكتابة مستحيلة تقنياً.
 */
import { google, type drive_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";

export const DRIVE_SCOPE_READONLY = "https://www.googleapis.com/auth/drive.readonly";
export const DRIVE_SCOPE_FULL = "https://www.googleapis.com/auth/drive";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  modifiedTime?: string;
  parents?: string[];
}

export const FOLDER_MIME = "application/vnd.google-apps.folder";

export function createOAuthClient(redirectUri?: string): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID أو GOOGLE_CLIENT_SECRET غير مضبوط.\n" +
        "راجع قسم «إعداد جوجل» في README.md",
    );
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * عميل درايف لأدوات الطرفية.
 *
 * يفضّل تفويض مستخدم مسجَّل في قاعدة البيانات على متغيّر بيئة منفصل —
 * فمن سجّل دخوله ووافق على صلاحية الدرايف يكفي، ولا حاجة لخطوة إعداد ثانية.
 */
export async function driveForCli(
  lookupStoredToken?: () => Promise<string | null>,
): Promise<drive_v3.Drive> {
  const token = process.env.GOOGLE_DRIVE_REFRESH_TOKEN ?? (await lookupStoredToken?.()) ?? null;
  if (!token) {
    throw new Error(
      "لا يوجد تفويض درايف. سجّل دخولك في التطبيق مرة واحدة، أو شغّل: npm run drive:auth",
    );
  }
  const auth = createOAuthClient();
  auth.setCredentials({ refresh_token: token });
  return google.drive({ version: "v3", auth });
}

/** نسخة متزامنة تعتمد متغيّر البيئة وحده. */
export function driveFromEnv(): drive_v3.Drive {
  const token = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (!token) {
    throw new Error("GOOGLE_DRIVE_REFRESH_TOKEN غير مضبوط. شغّل: npm run drive:auth");
  }
  const auth = createOAuthClient();
  auth.setCredentials({ refresh_token: token });
  return google.drive({ version: "v3", auth });
}

/** يسرد كل أبناء مجلد، مع اجتياز الصفحات كاملةً. قراءة فقط. */
export async function listChildren(
  drive: drive_v3.Drive,
  folderId: string,
): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime, parents)",
      pageSize: 1000,
      orderBy: "name",
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    for (const f of res.data.files ?? []) {
      if (!f.id || !f.name || !f.mimeType) continue;
      out.push({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size ? Number(f.size) : undefined,
        modifiedTime: f.modifiedTime ?? undefined,
        parents: f.parents ?? undefined,
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return out;
}

export const isFolder = (f: DriveFile): boolean => f.mimeType === FOLDER_MIME;

/** عميل درايف بصلاحية مستخدم بعينه — الرفع يتم باسمه لا باسم حساب مشترك. */
export function driveForUser(refreshToken: string): drive_v3.Drive {
  const auth = createOAuthClient();
  auth.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: "v3", auth });
}

/** يبحث عن مجلد باسمه داخل أب، أو ينشئه. لا يحذف ولا ينقل شيئاً. */
export async function findOrCreateFolder(
  drive: drive_v3.Drive,
  parentId: string,
  name: string,
): Promise<string> {
  const escaped = name.replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name = '${escaped}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: "files(id, name)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const existing = res.data.files?.[0]?.id;
  if (existing) return existing;

  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: "id",
    supportsAllDrives: true,
  });

  const id = created.data.id;
  if (!id) throw new Error(`تعذّر إنشاء المجلد: ${name}`);
  return id;
}

/** أسماء الملفات الموجودة في مجلد — لحساب لاحقة النسخة عند التكرار. */
export async function existingNamesIn(
  drive: drive_v3.Drive,
  folderId: string,
): Promise<string[]> {
  const files = await listChildren(drive, folderId);
  return files.map((f) => f.name);
}

export interface UploadResult {
  fileId: string;
  fileName: string;
  folderId: string;
  webViewLink?: string;
}

/**
 * يرفع ملفاً جديداً. لا يستبدل ملفاً قائماً أبداً — عند تعارض الاسم
 * يجب أن يكون المتصل قد حسم الاسم البديل عبر resolveNameCollision.
 */
export async function uploadFile(
  drive: drive_v3.Drive,
  options: { folderId: string; fileName: string; mimeType: string; data: Buffer },
): Promise<UploadResult> {
  const { Readable } = await import("node:stream");
  const created = await drive.files.create({
    requestBody: { name: options.fileName, parents: [options.folderId] },
    media: { mimeType: options.mimeType, body: Readable.from(options.data) },
    fields: "id, name, webViewLink",
    supportsAllDrives: true,
  });

  const id = created.data.id;
  if (!id) throw new Error("لم يرجع الدرايف معرّف الملف بعد الرفع");

  return {
    fileId: id,
    fileName: created.data.name ?? options.fileName,
    folderId: options.folderId,
    webViewLink: created.data.webViewLink ?? undefined,
  };
}

/**
 * ينزّل محتوى ملف من الدرايف. قراءة محضة — لا يعدّل شيئاً.
 *
 * يُستعمل لقراءة الأرشيف القائم بمحتواه لا بأسماء ملفاته: الاسم يعطي
 * الإجمالي وحده، والمحتوى يعطي التفصيل الضريبي والبنود.
 */
export async function downloadFile(
  drive: drive_v3.Drive,
  fileId: string,
): Promise<{ data: Buffer; mimeType: string }> {
  const meta = await drive.files.get({
    fileId,
    fields: "mimeType",
    supportsAllDrives: true,
  });

  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );

  return {
    data: Buffer.from(res.data as ArrayBuffer),
    mimeType: meta.data.mimeType ?? "application/octet-stream",
  };
}

/**
 * بيانات ملفٍّ بعينه — بمعرّفه، بلا مشيٍ على الأرشيف.
 *
 * لأنّ قراءة ملفّين لا تستحقّ إعادةَ المشي على الأرشيف كلّه. وكان
 * ذلك يقع: كلّ دفعةِ قراءةٍ تمشي من جديد على السنوات والأشهر ومجلّدات
 * المورّدين — عشرون ثانية تُهدَر قبل أن يُقرأ حرف.
 */
export async function getFileMeta(
  drive: drive_v3.Drive,
  fileId: string,
): Promise<DriveFile | null> {
  try {
    const res = await drive.files.get({
      fileId,
      fields: "id, name, mimeType, size, modifiedTime, parents",
      supportsAllDrives: true,
    });
    const f = res.data;
    if (!f.id || !f.name || !f.mimeType) return null;
    return {
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size ? Number(f.size) : undefined,
      modifiedTime: f.modifiedTime ?? undefined,
      parents: f.parents ?? undefined,
    };
  } catch {
    return null;
  }
}

/**
 * إعادة تسمية ملفٍّ في الأرشيف — العمليّةُ الكتابيّةُ الوحيدة عليه.
 *
 * وأوّلُ قيدٍ في هذا المشروع: «لا يُمسّ أرشيف جوجل درايف — لا حذف ولا
 * نقل ولا إعادة تسمية **بلا طلب صريح من أحمد**». وقد طلبها صراحةً في
 * ٧ سبتمبر ٢٠٢٦، مقيَّدةً بما يلي:
 *
 *   ١. **التسمية وحدها.** لا حذف، ولا نقل بين المجلّدات، ولا تغيير
 *      محتوى، ولا لمس ملفٍّ لا سجلَّ له عندنا.
 *   ٢. **الاسم المقترَح يُشتقّ من بياناتٍ مقيَّدة** — مورّدٍ وتاريخٍ
 *      ونوعٍ وإجماليّ — لا من تخمين نموذج.
 *   ٣. **لا يقع شيء بلا معاينة**: تُعرَض الأسماء قديمُها وجديدُها،
 *      ويُختار ملفٌّ ملفّاً.
 *   ٤. **يُسجَّل كلُّ تغيير** في سجلّ التدقيق بالاسمين ومعرّف الملفّ.
 *
 * ولا تُستدعى من سكربت ولا من مسار آليّ — من فعل إنسانٍ وحده.
 */
export async function renameFile(
  drive: drive_v3.Drive,
  fileId: string,
  newName: string,
): Promise<void> {
  await drive.files.update({
    fileId,
    requestBody: { name: newName },
    supportsAllDrives: true,
  });
}
