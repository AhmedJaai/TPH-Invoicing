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

/** عميل درايف من refresh token مخزّن في البيئة — للأدوات التي تعمل من الطرفية. */
export function driveFromEnv(): drive_v3.Drive {
  const token = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (!token) {
    throw new Error(
      "GOOGLE_DRIVE_REFRESH_TOKEN غير مضبوط. شغّل أولاً:\n  npm run drive:auth",
    );
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
