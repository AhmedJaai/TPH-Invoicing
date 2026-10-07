import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * بصمةُ الدرايف موصولةٌ من طرفيها — حارسٌ نصّيّ.
 *
 * المزامنة بالاسم لا تُنزِّل الملفّ فلا `sha256` له، فرفعُه ثانيةً كان
 * يُقرأ بنداءٍ مدفوع. والوصلُ ثلاث قطع: الدرايف يُسأل عن `md5Checksum`،
 * والمزامنة تحفظه، والتحليل يقابله. وسقوطُ واحدةٍ منها لا يرميه شيء:
 * الحقل الغائب من `fields` يعود `undefined` بصمت.
 */
const read = (...p: string[]) => readFileSync(path.join("src", ...p), "utf8");

describe("drive_md5 موصولٌ من الدرايف إلى التحليل", () => {
  it("القائمةُ وبياناتُ الملفّ تطلبان md5Checksum", () => {
    const drive = read("lib", "drive.ts");
    /* قائمةُ الحقول واحدةٌ للبابين — وفيها البصمتان */
    const fields = /const FILE_FIELDS =\s*"([^"]+)"/.exec(drive)?.[1] ?? "";
    expect(fields).toMatch(/\bmd5Checksum\b/);
    expect(fields).toMatch(/\bsha256Checksum\b/);
    expect(drive).toMatch(/fields: `nextPageToken, files\(\$\{FILE_FIELDS\}\)`/);
    expect(drive).toMatch(/fields: FILE_FIELDS,/);
  });

  it("المزامنة تحفظه في المسارين", () => {
    const sync = read("app", "api", "drive-sync", "route.ts");
    expect(sync.match(/driveMd5:/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("والتحليل يقابله قبل القراءة", () => {
    const analyze = read("app", "api", "analyze", "route.ts");
    const check = analyze.indexOf("eq(documents.driveMd5, md5)");
    const extract = analyze.indexOf("extractDocument(");
    expect(check).toBeGreaterThan(-1);
    expect(extract === -1 || check < extract).toBe(true);
  });
});
