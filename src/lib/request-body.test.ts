import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readJson } from "./request-body";

const Body = z.object({ total: z.string().optional(), ids: z.array(z.string()).optional() });
const req = (body: string) => new Request("http://x/api", { method: "POST", body, headers: { "content-type": "application/json" } });

describe("readJson — الطلبُ يُفحَص لا يُصبّ", () => {
  it("رقمٌ حيث يُنتظر نصّ ← ٤٠٠ يسمّي الحقل، لا ٥٠٠", async () => {
    const r = await readJson(req(JSON.stringify({ total: 123 })), Body);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(400);
      expect((await r.response.json()).error).toContain("total");
    }
  });

  it("نصٌّ حيث تُنتظر قائمة ← ٤٠٠", async () => {
    const r = await readJson(req(JSON.stringify({ ids: "x" })), Body);
    expect(r.ok).toBe(false);
  });

  it("الصحيحُ يمرّ بنوعه", async () => {
    const r = await readJson(req(JSON.stringify({ total: "12.5", ids: ["a"] })), Body);
    expect(r.ok && r.body).toEqual({ total: "12.5", ids: ["a"] });
  });

  it("وجسمٌ فارغ مقبولٌ حيث يُعلَن", async () => {
    expect((await readJson(req(""), Body, { emptyOk: true })).ok).toBe(true);
    expect((await readJson(req(""), Body)).ok).toBe(false);
  });
});
