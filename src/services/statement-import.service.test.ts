import { describe, expect, it, vi } from "vitest";

/* الرفضُ يقع قبل أيّ قراءةٍ من القاعدة — فالقاعدةُ هنا ترمي إن لُمست */
vi.mock("@/db", () => ({
  db: new Proxy({}, { get: () => { throw new Error("لُمست القاعدة قبل الرفض"); } }),
}));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));
const read = vi.hoisted(() => vi.fn());
vi.mock("./statement-file.service", () => ({ readStatementFile: read }));

import { runStatementImport } from "./statement-import.service";
import { respondTo } from "./guard";
import { Refused, Unreadable } from "@/lib/domain-error";

const file = { name: "statement.pdf", type: "application/pdf", buffer: Buffer.from("x") };

/**
 * رفضُ الكشف بعد نقله من المسار إلى خدمته: الرمزُ والجسمُ اللذان كان المسار يكتبهما بيده.
 */
describe("runStatementImport: رفضُ الملفّ", () => {
  it("الكشفُ المصوَّر يُعلَن ولا يُخمَّن — ٤٢٢ ومعه مصدره", async () => {
    read.mockResolvedValueOnce({ blocked: "هذا الكشف صورة", source: "PDF_SCANNED", rows: [], warnings: [] });
    const e = await runStatementImport("u", file, false).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Unreadable);
    const res = respondTo(e)!;
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "هذا الكشف صورة", source: "PDF_SCANNED" });
  });

  it("بلا حركة ٤٠٠ بسبب القارئ، أو بنصّه العامّ", async () => {
    read.mockResolvedValueOnce({ rows: [], warnings: [{ reason: "لم يُعرف شكل الملف" }] });
    const first = await runStatementImport("u", file, false).catch((x: unknown) => x);
    expect(first).toBeInstanceOf(Refused);
    expect(await respondTo(first)!.json()).toEqual({ error: "لم يُعرف شكل الملف" });

    read.mockResolvedValueOnce({ rows: [], warnings: [] });
    const second = await runStatementImport("u", file, true).catch((x: unknown) => x);
    const res = respondTo(second)!;
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "لم تُقرأ أي حركة من الملف" });
  });
});
