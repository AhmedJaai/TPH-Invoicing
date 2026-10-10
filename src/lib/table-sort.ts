/**
 * ترتيبُ الجدول بعمودٍ يختاره القارئ — «من أكبرُ دَين؟» بضغطةٍ لا بقراءة القائمة.
 *
 * الترتيبُ في العنوان (`?sort=amount.desc`) كالتصفية: يُحفَظ ويُشارَك ويعود
 * مع الرجوع. والخادمُ يرتّب ما سيرسمه، فالجدولُ يبقى مكوّنَ خادم.
 *
 * **والمجهولُ ليس صفراً:** قيمةٌ `null` تقع في آخر القائمة صعوداً ونزولاً —
 * لا تتصدّر «الأصغر» كأنّها صفر، ولا تختفي.
 *
 * دوالُّ خالصة — تُختبَر.
 */
export type SortDir = "asc" | "desc";
export interface SortState {
  key: string;
  dir: SortDir;
}
export type SortValue = number | string | null | undefined;

/** يقرأ `amount.desc` — وما لا يُفهم يُهمَل (لا ترتيب) ولا يرمي. */
export function parseSort(raw: string | null | undefined, allowed: readonly string[]): SortState | null {
  if (!raw) return null;
  const m = /^([A-Za-z0-9_-]+)\.(asc|desc)$/.exec(raw);
  if (!m || !allowed.includes(m[1])) return null;
  return { key: m[1], dir: m[2] === "asc" ? "asc" : "desc" };
}

export function formatSort(s: SortState | null): string | null {
  return s ? `${s.key}.${s.dir}` : null;
}

/**
 * الضغطةُ التالية على رأس عمود: الأوّلى بالاتّجاه الطبيعيّ (المالُ من الأكبر،
 * والنصُّ من الألف)، والثانيةُ تعكسه، والثالثةُ تعيد ترتيبَ الخادم.
 */
export function nextSort(current: SortState | null, key: string, first: SortDir): SortState | null {
  if (!current || current.key !== key) return { key, dir: first };
  if (current.dir === first) return { key, dir: first === "asc" ? "desc" : "asc" };
  return null;
}

const collator = new Intl.Collator("ar", { numeric: true, sensitivity: "base" });

/** ترتيبٌ ثابت: المتساويان يبقيان على ترتيب الخادم. والمجهولُ آخراً في الاتّجاهين. */
export function sortRows<T>(rows: readonly T[], valueOf: (row: T) => SortValue, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: valueOf(row) }))
    .sort((a, b) => {
      const an = a.v === null || a.v === undefined || a.v === "";
      const bn = b.v === null || b.v === undefined || b.v === "";
      if (an || bn) return an && bn ? a.i - b.i : an ? 1 : -1;
      const c =
        typeof a.v === "number" && typeof b.v === "number"
          ? a.v - b.v
          : collator.compare(String(a.v), String(b.v));
      return c !== 0 ? c * sign : a.i - b.i;
    })
    .map((x) => x.row);
}
