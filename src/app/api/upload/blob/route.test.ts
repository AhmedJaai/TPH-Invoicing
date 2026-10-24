import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  إذنُ رفع الملفّ الكبير: بالحارس نفسه الذي للرفع العاديّ، ولا شيء بلا مخزن، والحدّ
  والنوع على الإذن نفسه. الحارسُ والحزمةُ مُحاكيان — لا جلسة ولا شبكة.
*/
const guardMock = vi.fn();
vi.mock("@/services/guard", () => ({
  guard: (...a: unknown[]) => guardMock(...a),
  respondTo: (e: unknown) =>
    e instanceof Error && e.message === "forbidden"
      ? Response.json({ error: "ليست لديك صلاحية هذا الإجراء." }, { status: 403 })
      : null,
}));
const handleUploadMock = vi.fn();
vi.mock("@vercel/blob/client", () => ({ handleUpload: (o: unknown) => handleUploadMock(o) }));
vi.mock("@vercel/blob", () => ({ del: vi.fn(), get: vi.fn(), list: vi.fn(async () => ({ blobs: [] })) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));

import { POST } from "./route";

const tokenRequest = (pathname: string, contentType: string | null) =>
  new Request("http://localhost/api/upload/blob", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: { pathname, multipart: false, clientPayload: contentType === null ? null : JSON.stringify({ contentType }) },
    }),
  });

beforeEach(() => {
  guardMock.mockReset().mockResolvedValue({ id: "u1", role: "OWNER" });
  handleUploadMock.mockReset().mockResolvedValue({ type: "blob.generate-client-token", clientToken: "ct" });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/api/upload/blob", () => {
  it("يحرسه بصلاحية الرفع نفسها", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_store1_secret");
    await POST(tokenRequest("staging/a.pdf", "application/pdf"));
    expect(guardMock).toHaveBeenCalledWith("upload-blob", "document:upload");
  });

  it("من لا يملك الرفع يُردّ ٤٠٣ ولا يُعطى إذناً", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_store1_secret");
    guardMock.mockRejectedValue(new Error("forbidden"));
    const res = await POST(tokenRequest("staging/a.pdf", "application/pdf"));
    expect(res.status).toBe(403);
    expect(handleUploadMock).not.toHaveBeenCalled();
  });

  it("بلا مخزن: ٤٠٤ برسالةٍ تقول الحدّ — ولا إذن", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    const res = await POST(tokenRequest("staging/a.pdf", "application/pdf"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("٣ ميجابايت");
    expect(handleUploadMock).not.toHaveBeenCalled();
  });

  it("نوعٌ غير PDF ولا صورة يُردّ ٤٠٠ قبل الإذن", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_store1_secret");
    const res = await POST(tokenRequest("staging/a.html", "text/html"));
    expect(res.status).toBe(400);
    expect(handleUploadMock).not.toHaveBeenCalled();
  });

  it("اسمٌ خارج staging/ يُردّ ٤٠٠", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_store1_secret");
    const res = await POST(tokenRequest("archive/a.pdf", "application/pdf"));
    expect(res.status).toBe(400);
    expect(handleUploadMock).not.toHaveBeenCalled();
  });

  it("الطلبُ بشكلٍ آخر (نداءُ اكتمالٍ مزعوم) يُردّ ٤٠٠", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_store1_secret");
    const res = await POST(new Request("http://localhost/api/upload/blob", {
      method: "POST",
      body: JSON.stringify({ type: "blob.upload-completed", payload: { blob: {} } }),
    }));
    expect(res.status).toBe(400);
    expect(handleUploadMock).not.toHaveBeenCalled();
  });

  it("المقبولُ يُعطى إذناً بحدّ ٢٥ ميجابايت وأنواع PDF والصور وعمرٍ قصير", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_store1_secret");
    const res = await POST(tokenRequest("staging/a.pdf", "application/pdf"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: "blob.generate-client-token", clientToken: "ct" });
    const opts = handleUploadMock.mock.calls[0][0] as { onBeforeGenerateToken: () => Promise<Record<string, unknown>> };
    const token = await opts.onBeforeGenerateToken();
    expect(token.maximumSizeInBytes).toBe(25 * 1024 * 1024);
    expect(token.allowedContentTypes).toEqual(expect.arrayContaining(["application/pdf", "image/jpeg", "image/heic"]));
    expect(token.allowedContentTypes).not.toContain("text/html");
    expect(token.addRandomSuffix).toBe(true);
    expect(Number(token.validUntil) - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
  });
});
