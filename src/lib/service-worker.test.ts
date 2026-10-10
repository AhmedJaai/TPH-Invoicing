import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { sharedFileName, takeShared, SHARE_CACHE } from "./shared-inbox";

/*
  عاملُ الخدمة مكتوبٌ باليد ولا يُرى في الاختبارات النقيّة — فيُحمَّل نصُّه هنا في
  بيئةٍ مقلَّدة (`self` · `caches`) وتُطلَق عليه الأحداثُ نفسُها التي يطلقها المتصفّح.
  وأهمُّ ما يُحرَس: **لا يعترض إلّا التنقّلَ ومسارَ المشاركة** — ردٌّ ماليّ من خزينٍ
  قديم أسوأ من صفحة خطأ.
*/
type Handler = (event: FetchLike) => void;
interface FetchLike {
  request: Request;
  respondWith: (r: Response | Promise<Response>) => void;
}

class FakeCache {
  store = new Map<string, Response>();
  async put(key: string | Request, value: Response) { this.store.set(typeof key === "string" ? key : key.url, value); }
  async keys() { return [...this.store.keys()].map((k) => new Request(k)); }
  async match(key: string | Request) { return this.store.get(typeof key === "string" ? key : key.url)?.clone(); }
  async delete(key: string | Request) { return this.store.delete(typeof key === "string" ? key : key.url); }
}

const origin = "https://tph.example";
let cachesFake: { all: Map<string, FakeCache>; open: (n: string) => Promise<FakeCache>; has: (n: string) => Promise<boolean> };
let handlers: Record<string, Handler>;
let netFetch: (req: Request) => Promise<Response>;

function load() {
  const all = new Map<string, FakeCache>();
  cachesFake = {
    all,
    open: async (n) => { if (!all.has(n)) all.set(n, new FakeCache()); return all.get(n)!; },
    has: async (n) => all.has(n),
  };
  handlers = {};
  const self = {
    location: { origin },
    addEventListener: (type: string, h: Handler) => { handlers[type] = h; },
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
  };
  const source = readFileSync("public/sw.js", "utf8");
  new Function("self", "caches", "fetch", source)(self, cachesFake, (req: Request) => netFetch(req));
}

/** طلبٌ بوضع التنقّل — `Request` في Node لا يقبل `mode: "navigate"` فيُقلَّد حقلُه. */
function navigation(url: string): Request {
  const req = new Request(url);
  Object.defineProperty(req, "mode", { value: "navigate" });
  return req;
}

async function dispatch(request: Request): Promise<Response | null> {
  let answer: Response | Promise<Response> | null = null;
  handlers.fetch({ request, respondWith: (r) => { answer = r; } });
  return answer === null ? null : await answer;
}

describe("عاملُ الخدمة (public/sw.js)", () => {
  beforeEach(() => {
    load();
    netFetch = async () => new Response("ok");
  });

  it("لا يعترض ردّاً ماليّاً ولا ملفّاً ثابتاً ولا طلبَ RSC — الشبكةُ كما كانت", async () => {
    expect(await dispatch(new Request(`${origin}/api/payment-run`))).toBeNull();
    expect(await dispatch(new Request(`${origin}/api/analyze`, { method: "POST", body: "x" }))).toBeNull();
    expect(await dispatch(new Request(`${origin}/_next/static/chunk.js`))).toBeNull();
    expect(await dispatch(new Request(`${origin}/suppliers?_rsc=1`))).toBeNull();
    expect(await dispatch(navigation("https://accounts.google.com/o/oauth2"))).toBeNull();
  });

  it("ولا يخزّن شيئاً من التطبيق — لا `cache.put` ولا `addAll` خارج صندوق المشاركة", () => {
    const source = readFileSync("public/sw.js", "utf8");
    expect(source.match(/cache\.put\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/addAll\(|caches\.match\(/);
  });

  it("التنقّلُ يذهب إلى الشبكة، وما وصل يُعاد كما هو", async () => {
    netFetch = async () => new Response("الصفحة", { status: 200 });
    const res = await dispatch(navigation(`${origin}/suppliers`));
    expect(await res!.text()).toBe("الصفحة");
  });

  it("وحين لا يصل الطلب: «أنت بلا اتّصال» بالعربيّة، ٥٠٣، ولا تُخزَّن", async () => {
    netFetch = async () => { throw new TypeError("Failed to fetch"); };
    const res = await dispatch(navigation(`${origin}/payments`));
    expect(res!.status).toBe(503);
    expect(res!.headers.get("cache-control")).toBe("no-store");
    const html = await res!.text();
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("أنت بلا اتّصال");
  });

  it("المشاركة: الملفّاتُ تُحفَظ ثمّ يُحوَّل إلى صفحة الرفع، وصفحةُ الرفع تأخذها وتُفرغ الصندوق", async () => {
    const form = new FormData();
    form.append("files", new File([new Uint8Array([37, 80, 68, 70])], "فاتورة مراعي.pdf", { type: "application/pdf" }));
    form.append("files", new File([new Uint8Array([1, 2, 3])], "IMG_1.HEIC", { type: "" }));
    form.append("files", new File([], "empty.pdf", { type: "application/pdf" }));
    const res = await dispatch(new Request(`${origin}/share-target`, { method: "POST", body: form }));
    expect(res!.status).toBe(303);
    expect(res!.headers.get("location")).toBe(`${origin}/upload?shared=2`);

    /* ما كتبه العامل يقرؤه `takeShared` — العقدُ بين الملفّين (الاسمُ والنوعُ والوقت) */
    const shared = cachesFake.all.get(SHARE_CACHE)!;
    Object.defineProperty(globalThis, "caches", { value: cachesFake, configurable: true });
    try {
      const files = await takeShared();
      expect(files.map((f) => [f.name, f.type, f.size])).toEqual([
        ["فاتورة مراعي.pdf", "application/pdf", 4],
        ["IMG_1.HEIC", "", 3],
      ]);
      expect(shared.store.size).toBe(0);
      expect(await takeShared()).toEqual([]);
    } finally {
      Reflect.deleteProperty(globalThis, "caches");
    }
  });

  it("مشاركةٌ بلا ملفّ (نصٌّ أو رابط) تفتح صفحةَ الرفع وتقول ذلك — لا صفحةَ خطأ", async () => {
    const form = new FormData();
    form.append("text", "مرحبا");
    const res = await dispatch(new Request(`${origin}/share-target`, { method: "POST", body: form }));
    expect(res!.headers.get("location")).toBe(`${origin}/upload?shared=0`);
  });

  it("ما بقي في الصندوق أكثر من يومٍ يُمحى ولا يُقرأ", async () => {
    const cache = await cachesFake.open(SHARE_CACHE);
    const old = Date.now() - 25 * 60 * 60 * 1000;
    await cache.put(`${origin}/__shared/old`, new Response("x", { headers: { "content-type": "application/pdf", "x-file-name": "old.pdf", "x-shared-at": String(old) } }));
    Object.defineProperty(globalThis, "caches", { value: cachesFake, configurable: true });
    try {
      expect(await takeShared()).toEqual([]);
      expect(cache.store.size).toBe(0);
    } finally {
      Reflect.deleteProperty(globalThis, "caches");
    }
  });
});

describe("sharedFileName", () => {
  it("يفكّ الاسمَ العربيّ، ويُسقط المسار", () => {
    expect(sharedFileName(encodeURIComponent("فاتورة.pdf"), "application/pdf")).toBe("فاتورة.pdf");
    expect(sharedFileName(encodeURIComponent("../../etc/x.pdf"), "application/pdf")).toBe("x.pdf");
  });

  it("اسمٌ غائب أو فاسد يأخذ اسماً عامّاً بامتداد نوعه — فيقبله شرطُ القراءة", () => {
    expect(sharedFileName(null, "application/pdf")).toBe("مشاركة.pdf");
    expect(sharedFileName("%E0%A4%A", "image/jpeg")).toBe("مشاركة.jpg");
    expect(sharedFileName("", "image/png")).toBe("مشاركة.png");
  });
});

describe("بيانُ التثبيت يعلن هدفَ المشاركة الذي يستقبله العامل", () => {
  const manifest = JSON.parse(readFileSync("src/app/manifest.webmanifest", "utf8")) as {
    share_target?: { action: string; method: string; enctype: string; params: { files: { name: string; accept: string[] }[] } };
  };

  it("المسارُ والطريقةُ واسمُ الحقل تطابق `sw.js`", () => {
    const source = readFileSync("public/sw.js", "utf8");
    expect(manifest.share_target?.method).toBe("POST");
    expect(manifest.share_target?.enctype).toBe("multipart/form-data");
    expect(source).toContain(`const SHARE_PATH = "${manifest.share_target?.action}"`);
    expect(source).toContain(`form.getAll("${manifest.share_target?.params.files[0].name}")`);
    expect(manifest.share_target?.params.files[0].accept).toEqual(expect.arrayContaining(["image/*", "application/pdf"]));
  });
});
