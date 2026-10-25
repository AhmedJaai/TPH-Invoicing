import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  ورقةُ المستند من الدرايف: بالحارس، وبتفويض الناظر، وقراءةً محضة، وبترويساتٍ تعرضها
  في مكانها ولا تُخزَّن إلّا عنده. الحارسُ والقاعدةُ والدرايف مُحاكاة — لا جلسة ولا شبكة.
*/
const guardMock = vi.fn();
vi.mock("@/services/guard", () => ({
  guard: (...a: unknown[]) => guardMock(...a),
  respondTo: (e: unknown) =>
    e instanceof Error && e.message === "forbidden"
      ? Response.json({ error: "ليست لديك صلاحية هذا الإجراء." }, { status: 403 })
      : null,
}));
const refMock = vi.fn();
vi.mock("@/services/document-file.service", () => ({ documentFileRef: (id: string) => refMock(id) }));
const tokenMock = vi.fn();
vi.mock("@/services/drive.service", () => ({ refreshTokenFor: (id: string) => tokenMock(id) }));
const downloadMock = vi.fn();
const driveClient = { files: { get: vi.fn(), update: vi.fn(), delete: vi.fn() } };
vi.mock("@/lib/drive", async (orig) => {
  const real = await orig<typeof import("@/lib/drive")>();
  return {
    ...real,
    driveForUser: vi.fn(() => driveClient),
    downloadFile: (...a: unknown[]) => downloadMock(...a),
    renameFile: vi.fn(() => { throw new Error("لا تسمية من هنا"); }),
  };
});

import { GET } from "./route";
import { DriveFileTooLargeError } from "@/lib/drive";

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(600 * 1024, 7)]);
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(32)]);
const get = (id = "doc_1") => GET(new Request(`http://localhost/api/document-file?id=${encodeURIComponent(id)}`));

beforeEach(() => {
  guardMock.mockReset().mockResolvedValue({ id: "u1", role: "PURCHASING" });
  refMock.mockReset().mockResolvedValue({ driveFileId: "drv_1", mimeType: "application/pdf", fileName: "فاتورة المراعي.pdf" });
  tokenMock.mockReset().mockResolvedValue("refresh");
  downloadMock.mockReset().mockResolvedValue({ data: PDF, mimeType: "application/pdf" });
});

describe("/api/document-file", () => {
  it("يحرسه بصلاحية عرض المستندات — صلاحيةِ زرّ «افتح الملف» نفسِه", async () => {
    await get();
    expect(guardMock).toHaveBeenCalledWith("document-file", "document:view");
  });

  it("من لا يرى المستندات يُردّ ٤٠٣ ولا يُنزَّل شيء", async () => {
    guardMock.mockRejectedValue(new Error("forbidden"));
    const res = await get();
    expect(res.status).toBe(403);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("يعرض الـPDF في مكانه، بنوعه المقيَّد، ويُخزَّن عند الناظر وحده خمس دقائق", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(`inline; filename*=UTF-8''${encodeURIComponent("فاتورة المراعي.pdf")}`);
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-length")).toBe(String(PDF.length));
    /* متدفّقاً قطعاً، والبايتاتُ كما هي */
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
  });

  it("ينزّل بتفويض الناظر نفسه، قراءةً لا غير", async () => {
    await get();
    expect(tokenMock).toHaveBeenCalledWith("u1");
    expect(downloadMock).toHaveBeenCalledWith(driveClient, "drv_1");
    expect(driveClient.files.update).not.toHaveBeenCalled();
    expect(driveClient.files.delete).not.toHaveBeenCalled();
  });

  it("الصورةُ بنوعها", async () => {
    refMock.mockResolvedValue({ driveFileId: "drv_2", mimeType: "image/png", fileName: "x.png" });
    downloadMock.mockResolvedValue({ data: PNG, mimeType: "image/png" });
    const res = await get();
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("ملفٌّ يدّعي PDF وبايتاتُه HTML لا يُعرض من أصل التطبيق", async () => {
    downloadMock.mockResolvedValue({ data: Buffer.from("<html><script>alert(1)</script></html>"), mimeType: "application/pdf" });
    const res = await get();
    expect(res.status).toBe(415);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("المقيَّدُ خطأً يُصحَّح ببايتاته (صورةٌ قُيّدت PDF)", async () => {
    downloadMock.mockResolvedValue({ data: PNG, mimeType: "application/octet-stream" });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("المعرّفُ الغريب يُردّ قبل القاعدة", async () => {
    const res = await get("../../etc");
    expect(res.status).toBe(400);
    expect(refMock).not.toHaveBeenCalled();
  });

  it("مستندٌ بلا ملفٍّ في الدرايف: ٤٠٤ يقول ذلك", async () => {
    refMock.mockResolvedValue({ driveFileId: null, mimeType: "application/pdf", fileName: "x.pdf" });
    const res = await get();
    expect(res.status).toBe(404);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("بلا تفويض درايف (المعاينة): ٤٠٩ يدلّ على الدرايف، ولا يستعير تفويضاً", async () => {
    tokenMock.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("الدرايف");
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("الملفُّ فوق الحدّ (٢٥ ميجابايت): ٤١٣ بحجمه", async () => {
    downloadMock.mockRejectedValue(new DriveFileTooLargeError(40 * 1024 * 1024));
    const res = await get();
    expect(res.status).toBe(413);
    expect((await res.json()).error).toContain("25");
  });

  it("التفويضُ المنتهي يُقال ٤٢٨، والغائبُ من الدرايف ٤٠٤، وغيرُهما ٥٠٢ بلا نصّ جوجل", async () => {
    downloadMock.mockRejectedValueOnce(Object.assign(new Error("invalid_grant"), { code: 400 }));
    expect((await get()).status).toBe(428);
    downloadMock.mockRejectedValueOnce(Object.assign(new Error("File not found: drv_1"), { code: 404 }));
    expect((await get()).status).toBe(404);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    downloadMock.mockRejectedValueOnce(new Error("socket hang up drv_1"));
    const res = await get();
    expect(res.status).toBe(502);
    expect((await res.json()).error).not.toContain("drv_1");
    spy.mockRestore();
  });
});
