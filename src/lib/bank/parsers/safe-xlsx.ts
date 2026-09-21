/**
 * قراءةُ جدولٍ من ملفٍّ يرفعه مستخدم — بحرسٍ حول `xlsx`.
 *
 * `xlsx@0.18.5` على npm فيه ثغرتان عاليتان (تلويثُ النموذج الأوّليّ
 * `GHSA-4r6h-8v6p-xvw6`، وحجبُ خدمةٍ بتعبيرٍ نمطيّ `GHSA-5pgg-2g8v-p4x9`).
 * **والمثبَّت اليوم 0.20.3 المُصلَحة** من موقع SheetJS (انظر `package.json`)
 * — فالثغرتان مغلقتان في المصدر.
 *
 * وهذا الملفّ يبقى لأنّ الحدود التي يفرضها صحيحةٌ في ذاتها: الملفّ
 * يرفعه مستخدم، وورقةٌ بمليون صفّ كلفةٌ ولو لم يُرَد بها سوء. وما قُصّ
 * يُعلَن — صفوفاً وأعمدةً وخلايا.
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
  /**
   * القيمُ الخام قبل التصيير — تُطلَب بـ`includeRaw` ولا تُحسَب بغيرها.
   *
   * ── ولماذا لزمت ──
   *
   * التصييرُ يتبع تنسيقَ الخليّة: تاريخُ فودكس المخزَّن عدداً تسلسليّاً
   * (‏٤٦٢٨٤) يخرج نصّاً «9/19/26» — بسنةٍ من خانتين وترتيبٍ يتبع تنسيق
   * الملفّ لا لغةَ قارئه. فمن قرأ المصيَّر قرأ **تفسيرَ إكسل** للقيمة،
   * وذلك التفسير يختلف بين ملفٍّ وآخر ولو كان الرقمُ واحداً.
   *
   * والعددُ التسلسليُّ نفسُه لا لبسَ فيه. فالخامُ يُتاح لمن يحتاجه،
   * ويبقى `grid` كما هو لمن بُني عليه — فلا يُبطَل مسارٌ قائم.
   */
  raw?: string[][];
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
export interface ReadOptions {
  /** يُرفق القيمَ الخام مع المصيَّرة — للتواريخ التي يُفسدها التصيير. */
  includeRaw?: boolean;
}

export function readWorkbookSafely(buffer: Buffer, options: ReadOptions = {}): SafeWorkbook {
  const warnings: string[] = [];

  const wb = XLSX.read(buffer, {
    type: "buffer",
    cellDates: false,
    /* يتوقّف التحليل عند الحدّ — لا يقرأ الكلّ ثمّ نقصّه */
    /* صفٌّ زائد يُطلَب ليُعرَف أنّ الورقة أطول — لا ليُقرأ */
    sheetRows: MAX_ROWS + 1,
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

    const rowsTruncated = raw.length > MAX_ROWS;
    const clipped = raw.slice(0, MAX_ROWS);

    let colsTruncated = false;
    let cellsTruncated = 0;
    const grid = clipped.map((row) => {
      const cells = Array.isArray(row) ? row : [];
      if (cells.length > MAX_COLS) colsTruncated = true;
      return cells.slice(0, MAX_COLS).map((c) => {
        const text = typeof c === "string" ? c : String(c ?? "");
        if (text.length > MAX_CELL_CHARS) {
          cellsTruncated++;
          return text.slice(0, MAX_CELL_CHARS);
        }
        return text;
      });
    });

    if (rowsTruncated) {
      warnings.push(`الورقة «${name}» أطول من ${MAX_ROWS} صفّاً — قُرئ أوّلُها فقط.`);
    }
    /* القصّ يُعلَن — وصفٌ مبتور بلا علمٍ يُطابَق على ما ليس فيه */
    if (cellsTruncated > 0) {
      warnings.push(`في الورقة «${name}» ${cellsTruncated} خليّةٌ أطول من ${MAX_CELL_CHARS} حرفاً — قُصّت.`);
    }
    if (colsTruncated) {
      warnings.push(`الورقة «${name}» أعرض من ${MAX_COLS} عموداً — قُرئ أوّلُها فقط.`);
    }

    let rawGrid: string[][] | undefined;
    if (options.includeRaw) {
      const rawRows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
        header: 1, raw: true, defval: "",
      });
      rawGrid = stripPrototypeKeys(
        rawRows.slice(0, MAX_ROWS).map((row) =>
          (Array.isArray(row) ? row : [])
            .slice(0, MAX_COLS)
            .map((c) => (c === null || c === undefined ? "" : String(c)).slice(0, MAX_CELL_CHARS)),
        ),
      );
    }

    return {
      name,
      grid: stripPrototypeKeys(grid),
      raw: rawGrid,
      truncated: { rows: rowsTruncated, cols: colsTruncated },
    };
  });

  return { sheets, warnings };
}
