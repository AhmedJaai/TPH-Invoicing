import { beforeAll, describe, expect, it } from "vitest";
import type { drive_v3 } from "googleapis";
import {
  archivePlace, DriveArchiveInvisibleError, misplacedFiles, missingFromDrive, recentMonths, walkArchive,
} from "./drive-sync";
import { DriveAuthExpiredError, FOLDER_MIME, isDriveAuthError, isDriveNotFound } from "./drive";

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

/** أرشيفٌ صغير في الذاكرة: أبٌ ← أبناؤه. والمجلّدُ الذي في `broken` يُردّ بـ٥٠٠. */
function archive(tree: Record<string, { id: string; name: string; folder?: boolean }[]>, broken: readonly string[] = []): drive_v3.Drive {
  return {
    files: {
      list: async (params: { q: string }) => {
        const parent = /'([^']+)' in parents/.exec(params.q)?.[1] ?? "";
        if (broken.includes(parent)) throw Object.assign(new Error("Backend Error"), { code: 500 });
        if (!(parent in tree)) throw Object.assign(new Error("File not found"), { code: 404 });
        return {
          data: {
            files: tree[parent].map((c) => ({
              id: c.id, name: c.name, parents: [parent], mimeType: c.folder ? FOLDER_MIME : "application/pdf",
            })),
          },
        };
      },
    },
  } as unknown as drive_v3.Drive;
}

const TREE = {
  y2026: [{ id: "m09", name: "2026-09", folder: true }],
  m09: [
    { id: "aval", name: "AVAL", folder: true },
    { id: "kohi", name: "Kohi", folder: true },
    { id: "loose", name: "فاتورة ذابوبليك هاوس 27-09.pdf" },
  ],
  aval: [{ id: "a1", name: "a1.pdf" }, { id: "a2", name: "a2.pdf" }, { id: "sub", name: "إشعارات دائنة", folder: true }],
  kohi: [{ id: "k1", name: "k1.pdf" }],
};

describe("المشي يقول ما لم يقرأه", () => {
  it("حسابٌ لا يرى ولا سنةً واحدة — خطأٌ مسمّى لا «لا جديد»", async () => {
    await expect(walkArchive(archive({}))).rejects.toBeInstanceOf(DriveArchiveInvisibleError);
  });

  it("عطبٌ في مجلّد مورّدٍ واحد لا يُسقط الباقي — ويُذكَر", async () => {
    const r = await walkArchive(archive(TREE, ["kohi"]));
    expect(r.entries.map((e) => e.file.id).sort()).toEqual(["a1", "a2", "loose"]);
    expect(r.notes.some((n) => n.includes("2026-09/Kohi") && n.includes("تعذّر سردُه"))).toBe(true);
    /* ما لم يُسرَد لا يُحكَم على ما فيه بالغياب */
    expect(r.walkedFolderIds.has("kohi")).toBe(false);
    expect(r.walkedFolderIds.has("aval")).toBe(true);
  });

  it("والمجلّدُ الفرعيّ داخل مجلّد المورّد يُعلَن", async () => {
    const r = await walkArchive(archive(TREE));
    expect(r.notes).toEqual([expect.stringContaining("2026-09/AVAL/إشعارات دائنة")]);
  });

  it("والملفُّ في مجلّد الشهر نفسه يُرى بلا مجلّد مورّد", async () => {
    const r = await walkArchive(archive(TREE));
    expect(r.entries.find((e) => e.file.id === "loose")).toMatchObject({ month: "2026-09", folderName: "" });
  });
});

describe("ما قُيِّد ولم يعد في مجلّده", () => {
  it("يُحكَم على المجلّد المسرود وحده، والمعروفُ المرئيّ ليس غائباً", async () => {
    const walk = await walkArchive(archive(TREE, ["kohi"]), { knownFileIds: new Set(["a1", "gone", "k1", "k-gone"]) });
    const missing = missingFromDrive([
      { driveFileId: "a1", driveFolderId: "aval" },
      { driveFileId: "gone", driveFolderId: "aval" },
      { driveFileId: "k-gone", driveFolderId: "kohi" },
      { driveFileId: "elsewhere", driveFolderId: "m08-folder" },
      { driveFileId: "no-folder", driveFolderId: null },
    ], walk);
    expect(missing.map((m) => m.driveFileId)).toEqual(["gone"]);
  });
});

describe("موضعُ الملفّ من الأرشيف — للقراءة بالمعرّف", () => {
  const years = ["y2026", "y2027"];
  const month = { name: "2026-09", parents: ["y2026"] };

  it("في مجلّد مورّدٍ داخل شهر", () => {
    expect(archivePlace({ name: "AVAL", parents: ["m09"] }, month, years))
      .toEqual({ ok: true, month: "2026-09", folderName: "AVAL" });
  });

  it("في مجلّد الشهر مباشرةً — كان يُتخطّى بصمت", () => {
    expect(archivePlace(month, null, years)).toEqual({ ok: true, month: "2026-09", folderName: "" });
  });

  it("الأبُ ليس شهراً: يُسأل عن الجدّ قبل الحكم", () => {
    expect(archivePlace({ name: "AVAL", parents: ["m09"] }, null, years)).toMatchObject({ ok: false, needsGrandparent: true });
  });

  it("مجلّدٌ اسمُه شهرٌ خارج سنوات الأرشيف لا يُقبل — لا يُرسَل ملفٌّ خاصّ إلى النموذج", () => {
    const foreign = { name: "2026-09", parents: ["my-private-folder"] };
    expect(archivePlace({ name: "أوراقي", parents: ["x"] }, foreign, years)).toMatchObject({ ok: false, needsGrandparent: false });
    expect(archivePlace(foreign, null, years)).toMatchObject({ ok: false });
  });
});

describe("الأشهر الأخيرة بتوقيت الرياض", () => {
  it("الواحدة فجراً أوّلَ أكتوبر في الرياض (والخادمُ ما زال في سبتمبر)", () => {
    expect(recentMonths(2, new Date("2026-09-30T22:00:00Z"))).toEqual(["2026-10", "2026-09"]);
  });

  it("وتعبر رأس السنة", () => {
    expect(recentMonths(3, new Date("2027-01-15T10:00:00Z"))).toEqual(["2027-01", "2026-12", "2026-11"]);
  });
});
