/**
 * قراءةُ جدولٍ من ملفٍّ يرفعه مستخدم — بحرسٍ حول `xlsx`.
 *
 * `xlsx@0.18.5` على npm فيه ثغرتان عاليتان **بلا إصلاحٍ على npm**:
 * تلويثُ النموذج الأوّليّ (`GHSA-4r6h-8v6p-xvw6`)، وحجبُ خدمةٍ بتعبيرٍ
 * نمطيّ (`GHSA-5pgg-2g8v-p4x9`). والمشروع يقرأ بها ملفّات **يرفعها
 * مستخدم** — وهو بالضبط مدخل الاستغلال.
 *
 * **والإصلاح الحقيقي ليس هنا:** SheetJS خرجت من npm، والنسخة المُصلَحة
 * تُجلَب من موقعها:
 *
 *     npm install "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
 *
 * وهذا الملفّ حرسٌ يُقلّل الأثر حتى يقع ذلك، ويبقى نافعاً بعده —
 * فالحدود التي يفرضها صحيحةٌ في ذاتها.
 *
 * ثلاثة حروس:
 *
 *   ١. **مفاتيح النموذج الأوّليّ تُنزَع** من كلّ ما يعود. فلو أفلح
 *      التلويث في وسم الخلايا لم يبلغ كائناتنا. وهذا يمنع الأثر لا
 *      السبب — لكنّ الأثر هو ما يضرّ.
 *   ٢. **الحجم والعدد محدودان**: ورقةٌ بمليون صفّ ليست كشفَ حساب، وهي
 *      كلفةُ حجبِ خدمةٍ سواءٌ أُريد بها ذلك أم لا.
 *   ٣. **`sheetRows` تُمرَّر إلى المكتبة نفسها**، فيتوقّف التحليل عند
 *      الحدّ بدل أن يقرأ الكلّ ثمّ نقصّه — والقصّ بعد القراءة لا يمنع
 *      كلفتها.
 */
import * as XLSX from "xlsx";

/** أقصى عدد صفوفٍ يُقرأ من ورقة. كشفُ سنةٍ كاملة دون هذا بكثير. */
export const MAX_ROWS = 50_000;

/** وأقصى عدد أعمدةٍ يُحتفَظ به. */
export const MAX_COLS = 200;

/** وأقصى عدد أوراقٍ تُجرَّب. */
export const MAX_SHEETS = 20;

/** وأقصى طول نصٍّ في خلية — الوصف الأطول من هذا ليس وصفاً. */
export const MAX_CELL_CHARS = 2_000;

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

/**
 * ينزع مفاتيح النموذج الأوّليّ من الخلايا.
 *
 * والخلايا نصوصٌ في مسارنا (`raw: false`)، فالحرس هنا احتياطٌ لمن
 * يُغيّر ذلك لاحقاً — لا لما هو قائم اليوم.
 */
export function stripPrototypeKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripPrototypeKeys) as unknown as T;
  if (value === null || typeof value !== "object") return value;

  const out: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN.has(k)) continue;
    out[k] = stripPrototypeKeys(v);
  }
  return out as unknown as T;
}

export interface SafeSheet {
  name: string;
  grid: string[][];
  /** ما قُصّ، ويُعلَن — القصّ الصامت يجعل الكشف يبدو تامّاً وهو ناقص. */
  truncated: { rows: boolean; cols: boolean };
}

export interface SafeWorkbook {
  sheets: SafeSheet[];
  warnings: string[];
}

/**
 * يقرأ المصنّف بحدوده، ويُعلن ما قُصّ.
 *
 * والإعلان شرط: لو قُصّ الكشفُ صامتاً لظهر تامّاً وهو ناقص، ثمّ اختلّت
 * معادلتُه بلا سببٍ ظاهر.
 */
export function readWorkbookSafely(buffer: Buffer): SafeWorkbook {
  const warnings: string[] = [];

  const wb = XLSX.read(buffer, {
    type: "buffer",
    cellDates: false,
    /* يتوقّف التحليل عند الحدّ — لا يقرأ الكلّ ثمّ نقصّه */
    sheetRows: MAX_ROWS,
    /* ولا حاجة إلى الصيغ ولا التنسيق ولا الخصائص: كلّها سطحُ هجومٍ بلا نفع */
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    bookVBA: false,
    bookProps: false,
    bookSheets: false,
  });

  const names = wb.SheetNames.slice(0, MAX_SHEETS);
  if (wb.SheetNames.length > MAX_SHEETS) {
    warnings.push(`الملفّ فيه ${wb.SheetNames.length} ورقة، وقُرئت ${MAX_SHEETS} منها.`);
  }

  const sheets: SafeSheet[] = names.map((name) => {
    const raw = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], {
      header: 1, raw: false, defval: "",
    });

    const rowsTruncated = raw.length >= MAX_ROWS;
    const clipped = raw.slice(0, MAX_ROWS);

    let colsTruncated = false;
    const grid = clipped.map((row) => {
      const cells = Array.isArray(row) ? row : [];
      if (cells.length > MAX_COLS) colsTruncated = true;
      return cells.slice(0, MAX_COLS).map((c) => {
        const text = typeof c === "string" ? c : String(c ?? "");
        return text.length > MAX_CELL_CHARS ? text.slice(0, MAX_CELL_CHARS) : text;
      });
    });

    if (rowsTruncated) {
      warnings.push(`الورقة «${name}» أطول من ${MAX_ROWS} صفّاً — قُرئ أوّلُها فقط.`);
    }
    if (colsTruncated) {
      warnings.push(`الورقة «${name}» أعرض من ${MAX_COLS} عموداً — قُرئ أوّلُها فقط.`);
    }

    return {
      name,
      grid: stripPrototypeKeys(grid),
      truncated: { rows: rowsTruncated, cols: colsTruncated },
    };
  });

  return { sheets, warnings };
}
