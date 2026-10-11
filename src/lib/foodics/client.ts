/**
 * عميلُ واجهة فودكس — **قراءةٌ وحدها**.
 *
 * لا يملك هذا الملفّ إلّا `GET`: المفتاحُ صلاحياتُه قراءة، والنظامُ يتّخذ فودكس
 * شاهداً يُقارَن به لا دفتراً يُكتب فيه. والمفتاحُ من البيئة (`FOODICS_API_TOKEN`)
 * ولا يُكتب في سجلٍّ ولا في رسالة خطأ.
 *
 * والصفحاتُ خمسون خمسون؛ والواجهةُ تحدّ الطلبات في الدقيقة، فيُنتظر عند ٤٢٩
 * بما تقوله ترويستُها ثمّ يُعاد — مرّاتٍ معدودة، ثمّ يُقال العطل.
 */
import { z } from "zod";

export const FOODICS_BASE_URL = "https://api.foodics.com/v5";
/** مهلةُ الصفحة الواحدة. صفحةُ الطلبات بكامل تفصيلها ربعُ ميجابايت. */
const PAGE_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 4;

export class FoodicsNotConfiguredError extends Error {
  constructor() {
    super("فودكس غير موصول: مفتاحُ الربط `FOODICS_API_TOKEN` غير مضبوطٍ في البيئة.");
    this.name = "FoodicsNotConfiguredError";
  }
}

export class FoodicsApiError extends Error {
  constructor(readonly status: number, path: string) {
    super(
      status === 401 || status === 403
        ? `فودكس رفض المفتاح (${status}) عند ${path} — قد يكون أُلغي من «Authorized Apps» أو نقصته صلاحية.`
        : `فودكس ردّ بـ${status} عند ${path}.`,
    );
    this.name = "FoodicsApiError";
  }
}

export function foodicsConfigured(): boolean {
  return (process.env.FOODICS_API_TOKEN ?? "").trim() !== "";
}

function token(): string {
  const t = (process.env.FOODICS_API_TOKEN ?? "").trim();
  if (t === "") throw new FoodicsNotConfiguredError();
  return t;
}

const Page = z.object({
  data: z.array(z.unknown()),
  meta: z.object({ current_page: z.number(), last_page: z.number(), total: z.number() }),
});

export type Query = Record<string, string | number>;

function urlFor(path: string, query: Query): string {
  const url = new URL(`${FOODICS_BASE_URL}/${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  return url.toString();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getPage(path: string, query: Query): Promise<z.infer<typeof Page>> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(urlFor(path, query), {
        headers: { Authorization: `Bearer ${token()}`, Accept: "application/json" },
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (e) {
      if (e instanceof FoodicsNotConfiguredError || attempt >= MAX_RETRIES) throw e;
      await sleep(1_000 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= MAX_RETRIES) throw new FoodicsApiError(res.status, path);
      const wait = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 60) * 1_000 : 2_000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new FoodicsApiError(res.status, path);
    const body: unknown = JSON.parse(await res.text());
    return Page.parse(body);
  }
}

export interface PageOf<T> {
  items: T[];
  /** صفوفٌ لم تطابق المخطّط — تُعدّ وتُقال، ولا تُسقِط الصفحة. */
  rejected: number;
  page: number;
  lastPage: number;
  total: number;
}

/** صفحةٌ واحدة مفحوصةٌ بمخطّطها. */
export async function fetchPage<S extends z.ZodType>(path: string, schema: S, query: Query, page: number): Promise<PageOf<z.infer<S>>> {
  const body = await getPage(path, { ...query, page });
  const items: z.infer<S>[] = [];
  let rejected = 0;
  for (const raw of body.data) {
    const read = schema.safeParse(raw);
    if (read.success) items.push(read.data);
    else rejected++;
  }
  return { items, rejected, page: body.meta.current_page, lastPage: body.meta.last_page, total: body.meta.total };
}

/** كلُّ الصفحات — لما هو قليلٌ معروفُ الحجم (المورّدون، المشتريات، الصناديق). */
export async function fetchAll<S extends z.ZodType>(path: string, schema: S, query: Query = {}): Promise<{ items: z.infer<S>[]; rejected: number }> {
  const items: z.infer<S>[] = [];
  let rejected = 0;
  for (let page = 1; ; page++) {
    const got = await fetchPage(path, schema, query, page);
    items.push(...got.items);
    rejected += got.rejected;
    if (page >= got.lastPage) break;
  }
  return { items, rejected };
}
