import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* المحطّةُ على الخادم: بلا مفتاح لا شيء، ولا يُجلب رابطٌ من غير محطّتنا، والحدُّ وهو يُقرأ */
const getMock = vi.fn();
const delMock = vi.fn();
const listMock = vi.fn();
vi.mock("@vercel/blob", () => ({
  get: (...a: unknown[]) => getMock(...a),
  del: (...a: unknown[]) => delMock(...a),
  list: (...a: unknown[]) => listMock(...a),
}));

import { blobAuthOptions, blobUploadMode, discardStaged, largeUploadsEnabled, readStaged, StagedFileError, sweepStaleStaged } from "./blob-staging";

const OURS = "https://store1.private.blob.vercel-storage.com/staging/inv-x1.pdf";
const streamOf = (...parts: Uint8Array[]) => new ReadableStream<Uint8Array>({
  start(c) { for (const p of parts) c.enqueue(p); c.close(); },
});

beforeEach(() => { getMock.mockReset(); delMock.mockReset().mockResolvedValue(undefined); listMock.mockReset(); });
afterEach(() => vi.unstubAllEnvs());

describe("بلا مفتاح المخزن", () => {
  it("الطريقُ مطفأ، والقراءةُ تُردّ، والحذفُ والكنسُ لا يلمسان شيئاً", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("BLOB_STORE_ID", "");
    expect(largeUploadsEnabled()).toBe(false);
    expect(blobUploadMode()).toBeNull();
    expect(blobAuthOptions()).toBeNull();
    await expect(readStaged(OURS)).rejects.toBeInstanceOf(StagedFileError);
    await discardStaged(OURS);
    expect(await sweepStaleStaged()).toBe(0);
    expect(getMock).not.toHaveBeenCalled();
    expect(delMock).not.toHaveBeenCalled();
    expect(listMock).not.toHaveBeenCalled();
  });
});

describe("بـOIDC: المخزنُ وحده بلا مفتاح", () => {
  beforeEach(() => { vi.stubEnv("BLOB_READ_WRITE_TOKEN", ""); vi.stubEnv("BLOB_STORE_ID", "store_Store1"); });

  it("مفعَّل، ويُمرَّر معرّفُ المخزن لا مفتاحٌ فارغ", async () => {
    expect(largeUploadsEnabled()).toBe(true);
    expect(blobUploadMode()).toBe("oidc");
    getMock.mockResolvedValue({ statusCode: 200, stream: streamOf(new Uint8Array([1])), blob: { size: 1 } });
    await readStaged(OURS);
    const opts = getMock.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.storeId).toBe("store_Store1");
    expect("token" in opts).toBe(false);
    await discardStaged(OURS);
    expect(delMock.mock.calls[0][1]).toEqual({ storeId: "store_Store1" });
  });

  it("ورابطُ مخزنٍ آخر لا يُجلب", async () => {
    await expect(readStaged("https://other.private.blob.vercel-storage.com/staging/x.pdf")).rejects.toBeInstanceOf(StagedFileError);
    expect(getMock).not.toHaveBeenCalled();
  });
});

describe("المفتاحُ والمخزنُ معاً — المفتاحُ يغلب", () => {
  beforeEach(() => { vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_store1_secret"); vi.stubEnv("BLOB_STORE_ID", "store_store1"); });

  it("يقرأ بالمفتاح وحده", async () => {
    expect(blobUploadMode()).toBe("token");
    expect(blobAuthOptions()).toEqual({ token: "vercel_blob_rw_store1_secret" });
    getMock.mockResolvedValue({ statusCode: 200, stream: streamOf(new Uint8Array([1])), blob: { size: 1 } });
    await readStaged(OURS);
    const opts = getMock.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.token).toBe("vercel_blob_rw_store1_secret");
    expect("storeId" in opts).toBe(false);
  });
});

describe("بالمفتاح", () => {
  beforeEach(() => vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_store1_secret"));

  it("رابطٌ من غير محطّتنا لا يُجلب ولا يُحذف", async () => {
    await expect(readStaged("https://other.private.blob.vercel-storage.com/staging/x.pdf")).rejects.toBeInstanceOf(StagedFileError);
    await expect(readStaged("https://example.com/staging/x.pdf")).rejects.toBeInstanceOf(StagedFileError);
    await discardStaged("https://example.com/staging/x.pdf");
    expect(getMock).not.toHaveBeenCalled();
    expect(delMock).not.toHaveBeenCalled();
  });

  it("يقرأ بايتات ملفّ المحطّة بمفتاح الخادم", async () => {
    getMock.mockResolvedValue({ statusCode: 200, stream: streamOf(new Uint8Array([37, 80]), new Uint8Array([68, 70])), blob: { size: 4 } });
    const buf = await readStaged(OURS);
    expect([...buf]).toEqual([37, 80, 68, 70]);
    expect(getMock).toHaveBeenCalledWith(OURS, expect.objectContaining({ access: "private", token: "vercel_blob_rw_store1_secret" }));
  });

  it("ملفٌّ اختفى يُقال بنصّه", async () => {
    getMock.mockResolvedValue(null);
    await expect(readStaged(OURS)).rejects.toThrow("لم يعد الملف المؤقت موجوداً");
  });

  it("ما جاوز ٢٥ ميجابايت يُردّ — بالحجم المعلن، أو وهو يُقرأ", async () => {
    getMock.mockResolvedValue({ statusCode: 200, stream: streamOf(), blob: { size: 26 * 1024 * 1024 } });
    await expect(readStaged(OURS)).rejects.toThrow("٢٥");
    const big = new Uint8Array(13 * 1024 * 1024);
    getMock.mockResolvedValue({ statusCode: 200, stream: streamOf(big, big), blob: { size: 10 } });
    await expect(readStaged(OURS)).rejects.toThrow("٢٥");
  });

  it("الكنسُ يحذف ما جاوز يوماً وحده", async () => {
    const now = Date.parse("2026-10-23T12:00:00Z");
    listMock.mockResolvedValue({ blobs: [
      { url: "old", uploadedAt: new Date(now - 25 * 3600_000) },
      { url: "fresh", uploadedAt: new Date(now - 3600_000) },
    ] });
    expect(await sweepStaleStaged(now)).toBe(1);
    expect(delMock).toHaveBeenCalledWith(["old"], expect.anything());
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ prefix: "staging/" }));
  });

  it("تعذُّرُ الحذف لا يُسقط ما قبله", async () => {
    delMock.mockRejectedValue(new Error("network"));
    await expect(discardStaged(OURS)).resolves.toBeUndefined();
  });
});
