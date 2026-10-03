import { beforeAll, describe, expect, it } from "vitest";
import type { drive_v3 } from "googleapis";
import { misplacedFiles, walkArchive } from "./drive-sync";
import { DriveAuthExpiredError, isDriveAuthError, isDriveNotFound } from "./drive";

/**
 * التفويض المنتهي لا يُقرأ «لا جديد».
 *
 * وقع في ١٤ سبتمبر ٢٠٢٦: رمز التجديد يُردّ بـ`invalid_grant`، والمشي
 * يبتلع الخطأ عند مجلّد السنة، فتقول الشاشة «٠ ملفّات جديدة».
 */
function driveThat(fail: (parent: string) => unknown): drive_v3.Drive {
  return {
    files: {
      list: async (params: { q: string }) => {
        const parent = /'([^']+)' in parents/.exec(params.q)?.[1] ?? "";
        const err = fail(parent);
        if (err) throw err;
        return { data: { files: [] } };
      },
    },
  } as unknown as drive_v3.Drive;
}

beforeAll(() => {
  process.env.DRIVE_YEAR_2026_FOLDER_ID = "y2026";
  process.env.DRIVE_YEAR_2027_FOLDER_ID = "y2027";
});

describe("مشي الأرشيف لا يبتلع التفويض المنتهي", () => {
  it("invalid_grant يُرمى خطأَ تفويضٍ بالعربية", async () => {
    const drive = driveThat(() => new Error("invalid_grant"));
    await expect(walkArchive(drive)).rejects.toBeInstanceOf(DriveAuthExpiredError);
  });

  it("والسنة غير الموجودة (٤٠٤) وحدها تُتخطّى", async () => {
    const drive = driveThat((p) => (p === "y2027" ? Object.assign(new Error("File not found"), { code: 404 }) : null));
    await expect(walkArchive(drive)).resolves.toMatchObject({ entries: [] });
  });

  it("وعطبٌ آخر لا يُتخطّى بصمت", async () => {
    const drive = driveThat(() => Object.assign(new Error("Backend Error"), { code: 500 }));
    await expect(walkArchive(drive)).rejects.toThrow("Backend Error");
  });

  it("التصنيف", () => {
    expect(isDriveAuthError(new Error("invalid_grant"))).toBe(true);
    expect(isDriveAuthError({ response: { status: 401 } })).toBe(true);
    expect(isDriveAuthError({ code: 404 })).toBe(false);
    expect(isDriveNotFound({ code: 404 })).toBe(true);
  });
});

describe("ملفٌّ في مجلد شهرٍ غير شهر فاتورته", () => {
  it("فاتورتا زاكوباك لأغسطس في مجلد سبتمبر — تُذكران، وما في شهره لا", () => {
    const seen = new Map([["f1", "2026-09"], ["f2", "2026-09"], ["f3", "2026-08"]]);
    const out = misplacedFiles(seen, [
      { driveFileId: "f1", month: "2026-08", fileName: "2026-08-08_Zacopack_Invoice_2823.pdf", documentId: "d1" },
      { driveFileId: "f2", month: "2026-09", fileName: "3068.pdf", documentId: "d2" },
      { driveFileId: "f3", month: "2026-08", fileName: "2894.pdf", documentId: "d3" },
      { driveFileId: "f9", month: "2026-07", fileName: "غيرُ مرئيّ.pdf", documentId: "d9" },
    ]);
    expect(out).toEqual([{ documentId: "d1", fileName: "2026-08-08_Zacopack_Invoice_2823.pdf", folderMonth: "2026-09", month: "2026-08" }]);
  });
});
