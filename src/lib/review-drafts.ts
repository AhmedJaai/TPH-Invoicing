/**
 * مسوّداتُ المراجعة — ما قُرئ وصُحّح في صفحة الرفع ولم يُؤرشَف بعد، محفوظاً في
 * هذا المتصفّح (IndexedDB) حتّى يُؤرشَف أو يُزال.
 *
 * كانت في حالة React وحدها: من رفع خمس فواتير وصحّح ثلاثاً ثمّ أُعيد تحميلُ
 * اللسان (أو انتقل بالخطأ) بدأ من الصفر ودفع قراءةَ الذكاء ثانيةً.
 *
 * - **لا يغادر الجهاز:** هو الملفُّ نفسُه الذي اختاره صاحبُه، في تخزين هذا الموقع.
 * - **يُمحى** حين يُؤرشَف أو يُزال من القائمة، وبعد يومين في كلّ حال — مسوّدةٌ
 *   نُسيت لا تبقى فاتورةً في متصفّح.
 * - **الفشلُ صامتٌ عمداً:** متصفّحٌ يمنع التخزين (وضعٌ خاصّ) يعود إلى ما كان —
 *   بلا استعادة، ومعه تحذيرُ الخروج. والحفظُ الحقيقيّ الأرشفة لا هذا.
 *
 * والمحفوظُ **مدخلٌ لا حكم**: بعد الاستعادة يعيد الخادمُ الفحصَ والحسابَ عند
 * التأكيد كما يفعل دائماً.
 *
 * للمتصفّح وحده. و`expired` خالصةٌ تُختبَر.
 */
const DB = "tph-review";
const STORE = "drafts";
export const DRAFT_TTL_MS = 2 * 24 * 60 * 60 * 1000;

export interface StoredDraft {
  id: string;
  savedAt: number;
  /** ما يحفظه القارئ — يُفحَص شكلُه عند القراءة ولا يُصدَّق. */
  payload: unknown;
}

export function expired(savedAt: number, now: number): boolean {
  return !Number.isFinite(savedAt) || now - savedAt > DRAFT_TTL_MS || savedAt > now + 60_000;
}

function isStoredDraft(x: unknown): x is StoredDraft {
  if (typeof x !== "object" || x === null) return false;
  return "id" in x && typeof x.id === "string" && "savedAt" in x && typeof x.savedAt === "number" && "payload" in x;
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | null): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise<T | null>((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = work(tx.objectStore(STORE));
      let out: T | null = null;
      if (req) req.onsuccess = () => { out = req.result; };
      tx.oncomplete = () => { db.close(); resolve(out); };
      tx.onerror = () => { db.close(); resolve(null); };
      tx.onabort = () => { db.close(); resolve(null); };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

/** `false` حين لم يُحفَظ (تخزينٌ ممنوع أو ممتلئ) — فيعرف القارئُ أنّ الخروج يُضيع ما صُحّح. */
export async function saveDraft(id: string, payload: unknown): Promise<boolean> {
  const row: StoredDraft = { id, savedAt: Date.now(), payload };
  return (await withStore("readwrite", (s) => s.put(row))) !== null;
}

export async function deleteDraft(id: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(id));
}

/** ما بقي صالحاً، الأقدمُ أوّلاً — وما انتهت مدّتُه يُمحى في الطريق. */
export async function loadDrafts(): Promise<StoredDraft[]> {
  const all = await withStore<unknown[]>("readonly", (s) => s.getAll());
  if (!all) return [];
  const now = Date.now();
  const rows = all.filter(isStoredDraft);
  const stale = rows.filter((r) => expired(r.savedAt, now));
  if (stale.length > 0) {
    await withStore("readwrite", (s) => {
      stale.forEach((r) => s.delete(r.id));
      return null;
    });
  }
  return rows.filter((r) => !expired(r.savedAt, now)).sort((a, b) => a.savedAt - b.savedAt);
}
