/**
 * محوِّلُ تصدير فودكس — **مبنيٌّ على ملفٍّ حقيقيّ فُحص، لا على عاداتِ
 * نقاط البيع.**
 *
 * ── ما أثبته الملفّ (٢٬٠٨١ صفّاً · ١٬٠٩٠ طلباً · سبعةُ أيّام) ──
 *
 *   • صيغتُه **بنودُ طلبات**: صفٌّ لكلّ بندٍ في كلّ طلب.
 *   • `order_reference` هويّةُ الطلب، **ولا معرّفَ للبند**.
 *   • `status` (على البند) يقول `Done` · `Returned` · `Void`
 *     — **والكمّيّةُ موجبةٌ في الثلاث**. فلا سالبَ يدلّ على مرتجَع.
 *   • حالُ البند **تغلب** حالَ الطلب: طلبٌ واحد فيه أربعةُ بنودٍ ملغاة
 *     وبندٌ تامّ.
 *   • المُعدِّل صفٌّ مستقلّ (`type = خيار الإضافة`) مرتبطٌ بأصله
 *     بـ`parent_item_sku`، **كمّيّتُه كمّيّةُ أصله دائماً** (٣٦٤ من ٣٦٤)،
 *     **وسعرُ الأصل يشمله** (٤٠ صفّاً فيها `سعر×كمّيّة ≠ الإجمالي`،
 *     والفرقُ بالضبط مجموعُ أسعار مُعدِّلاته).
 *   • `business_date` **عددٌ تسلسليّ**، ويُصيَّر «9/19/26» بسنةٍ من
 *     خانتين وترتيبٍ يتبع تنسيقَ الملفّ. فيُقرأ من القيمة الخام.
 *   • لا وقتَ بيعٍ إطلاقاً، ولا عَلَمَ ضيافة، ولا رقمَ نسخةٍ للتصدير.
 *
 * ── وما بُني على ذلك ──
 *
 * المُعدِّلُ يُحفَظ سطراً موسوماً لا يُستهلَك ولا يُجمَع إيرادُه —
 * فيبقى الأثرُ تامّاً ولا يتضاعف رقم. و«دبل شوت» **خيارٌ داخل الوصفة**
 * كما قال صاحبُ المقهى، ويؤيّده الملفّ: سعرُه صفرٌ في ١٥٨ مرّة.
 */
import { mapColumns, FIELD_LABEL, type ColumnMap } from "./columns";
import {
  detectDateOrder, parseBusinessDate, parseMoneyMinor, parseQuantityMilli,
  parseSoldAt, parseSourceCostMinor, type DateOrder,
} from "./values";
import type { ParsedRow, ParsedSale, ParsedSaleLine, SalesFileAdapter } from "./file-import";

export const FOODICS_ADAPTER = "FOODICS_XLSX";
/** بنودُ طلبات — الصيغةُ التي أثبتها الملفّ الحقيقيّ. */
export const SHAPE_ORDER_ITEMS = "FOODICS_ORDER_ITEMS";
/** ملخّصُ يومٍ بلا أرقام طلبات — صيغةٌ أخرى يقبلها المحوِّل. */
export const SHAPE_PRODUCT_MIX = "FOODICS_PRODUCT_MIX";

const HEADER_SCAN = 15;

/** قيمُ `type` كما وردت — والعربيّةُ في البيانات لا في الترويسة. */
const MODIFIER_TYPES = new Set(["خيار الاضافه", "خيارالاضافه", "modifier", "option", "addon"]);

/** قيمُ `status` كما وردت. */
const RETURNED = new Set(["returned", "return", "refunded", "مرتجع", "مرتجعه"]);
const VOIDED = new Set(["void", "voided", "cancelled", "canceled", "ملغي", "ملغاه", "ملغى"]);

function fold(text: string): string {
  return text.trim().toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/\s+/g, "");
}

/**
 * بصمةُ محتوى السطر — دالّةٌ نقيّة بلا حزمة.
 *
 * ‏FNV‑1a: تكفي للتفريق بين «هو هو» و«تغيّر»، وليست حرزاً أمنيّاً —
 * فلا يُحتاج هنا إلى مقاومة تصادمٍ مقصود.
 */
export function contentFingerprint(parts: readonly (string | number)[]): string {
  let h = 0x811c9dc5;
  const text = parts.join("\u0001");
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

interface HeaderFound {
  rowIndex: number;
  columns: ColumnMap;
}

/**
 * يجد صفَّ الترويسة.
 *
 * ولا يُفترَض أنّه الأوّل: تقاريرُ فودكس قد تبدأ بأسطرِ عنوان. ويُطلَب
 * أقلُّ ما لا يقوم الاستيراد بدونه — اسمُ الصنف والكمّيّة.
 */
export function findHeader(grid: readonly string[][]): HeaderFound | null {
  for (let i = 0; i < Math.min(grid.length, HEADER_SCAN); i++) {
    const columns = mapColumns(grid[i] ?? []);
    if (columns.index.productName !== undefined && columns.index.quantity !== undefined) {
      return { rowIndex: i, columns };
    }
  }
  return null;
}

function cell(row: readonly string[] | undefined, at: number | undefined): string | undefined {
  if (at === undefined || row === undefined) return undefined;
  const value = row[at];
  return value === undefined ? undefined : String(value);
}

function rawOf(header: readonly string[], row: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < header.length; i++) {
    const key = (header[i] ?? "").trim() || `عمود ${i + 1}`;
    const value = (row[i] ?? "").trim();
    if (value !== "") out[key] = value;
  }
  return out;
}

function slug(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase().slice(0, 80);
}

export const foodicsExcelAdapter: SalesFileAdapter = {
  name: "فودكس (إكسل)",

  detect(grid) {
    return findHeader(grid) !== null;
  },

  parse(grids, options) {
    const grid = grids.grid;
    const warnings: string[] = [];
    const header = findHeader(grid);

    if (!header) {
      return {
        adapter: FOODICS_ADAPTER, shape: "UNKNOWN",
        sales: [], rows: [], periodStart: null, periodEnd: null, warnings,
        recognisedColumns: [], unrecognisedColumns: [],
        blocked:
          "لم يُفهَم هذا الملفّ: لم يُعثَر على عمودَي «اسم الصنف» و«الكمّيّة». " +
          "صدِّر من فودكس تقريرَ بنود الطلبات أو تقريرَ الأصناف بترويسةٍ واحدة.",
      };
    }

    const { index } = header.columns;
    const headerRow = grid[header.rowIndex] ?? [];
    const body = grid.slice(header.rowIndex + 1);
    /* الخامُ يقابل المصيَّر صفّاً بصفّ — والترويسةُ في الموضع نفسه */
    const rawBody = grids.raw ? grids.raw.slice(header.rowIndex + 1) : undefined;

    const shape = index.orderId !== undefined ? SHAPE_ORDER_ITEMS : SHAPE_PRODUCT_MIX;

    /*
      ── التاريخُ من الخام حين يوجد ──

      `business_date` عددٌ تسلسليّ يُصيَّر «9/19/26»: سنةٌ من خانتين
      وترتيبٌ يتبع تنسيقَ الملفّ لا لغةَ قارئه. والعددُ لا لبسَ فيه.
    */
    const dateCol = index.businessDate !== undefined ? index.businessDate : index.soldAt;
    const usingRawDates = rawBody !== undefined && dateCol !== undefined;
    const samples = dateCol === undefined ? [] : body.map((r) => cell(r, dateCol) ?? "").filter((x) => x !== "").slice(0, 200);
    const order: DateOrder = detectDateOrder(samples);
    if (!usingRawDates && order === "AMBIGUOUS" && samples.length > 0) {
      warnings.push(
        "لم يقطع الملفّ بترتيب اليوم والشهر في تواريخه — قُرئت **اليومُ أوّلاً**. " +
        "راجِع الفترة المعروضة أدناه قبل الاعتماد.",
      );
    }
    if (dateCol === undefined) {
      warnings.push(
        options.fallbackBusinessDate
          ? `لا عمودَ تاريخٍ في الملفّ — نُسبت الصفوفُ كلُّها إلى ${options.fallbackBusinessDate} كما اخترتَ.`
          : "لا عمودَ تاريخٍ في الملفّ، ولم يُحدَّد يومُ عملٍ — فلا يُعرَف متى بِيع.",
      );
    }

    const rows: ParsedRow[] = [];
    const sales = new Map<string, ParsedSale>();
    const occurrence = new Map<string, number>();
    /** مُعدِّلاتٌ تنتظر أصلَها: مفتاحُ الطلب+الأصل ← الأسطر. */
    const pendingModifiers: { saleKey: string; parentSku: string; line: ParsedSaleLine }[] = [];

    body.forEach((row, i) => {
      const rowNumber = header.rowIndex + i + 2;
      const raw = rawOf(headerRow, row);
      const reject = (status: ParsedRow["status"], reason: string) => {
        rows.push({ rowNumber, raw, status, reason, saleExternalId: null });
      };

      if (Object.keys(raw).length === 0) { reject("SKIPPED", "صفٌّ فارغ"); return; }

      /* المعرَّبُ يُفضَّل حين يكون مملوءاً — وهو فارغٌ في تصدير فودكس المفحوص */
      const name = ((cell(row, index.productNameLocalized) ?? "").trim())
        || (cell(row, index.productName) ?? "").trim();
      if (name === "") { reject("SKIPPED", "لا اسمَ صنفٍ في الصفّ — غالباً سطرُ مجموعٍ أو فاصل"); return; }

      const quantityCell = (cell(row, index.quantity) ?? "").trim();
      if (quantityCell === "") { reject("SKIPPED", "لا كمّيّة في الصفّ — غالباً سطرُ مجموعٍ أو فاصل"); return; }
      const quantityMilli = parseQuantityMilli(quantityCell);
      if (quantityMilli === null) {
        reject("ERROR", `تعذّرت قراءة ${FIELD_LABEL.quantity}: «${quantityCell}»`);
        return;
      }

      /* يومُ العمل: الخامُ أوّلاً، ثمّ المصيَّر، ثمّ ما اختاره المستخدم */
      const rawDate = usingRawDates ? cell(rawBody?.[i], dateCol) : undefined;
      const businessDate =
        (rawDate ? parseBusinessDate(rawDate, "ISO") : null)
        ?? (dateCol !== undefined ? parseBusinessDate(cell(row, dateCol), order) : null)
        ?? options.fallbackBusinessDate
        ?? null;
      if (!businessDate) {
        reject("ERROR", "لا يُعرَف يومُ عمل هذا الصفّ — وبيعةٌ في اليوم الخطأ تُحسَب بوصفةٍ أخرى");
        return;
      }

      const branchLabel =
        (cell(row, index.branch) ?? cell(row, index.branchName) ?? options.branchLabel ?? "").trim() || null;
      const productExternalId = (cell(row, index.productExternalId) ?? "").trim() || `NAME:${slug(name)}`;

      /* ── نوعُ السطر وحالُه: من المصدر لا من إشارة الكمّيّة ── */
      const typeText = fold(cell(row, index.lineType) ?? "");
      const parentSku = (cell(row, index.parentSku) ?? "").trim();
      const isModifier = MODIFIER_TYPES.has(typeText) || (typeText !== "" && parentSku !== "");

      const statusText = fold(cell(row, index.lineStatus) ?? cell(row, index.orderStatus) ?? "");
      const isRefund = RETURNED.has(statusText);
      const isVoid = VOIDED.has(statusText);
      const sourceStatus = (cell(row, index.lineStatus) ?? cell(row, index.orderStatus) ?? "").trim() || null;

      const lineTotalMinor = parseMoneyMinor(cell(row, index.lineTotal)) ?? 0;
      const unitPriceMinor = parseMoneyMinor(cell(row, index.unitPrice))
        ?? (quantityMilli !== 0 ? Math.round((lineTotalMinor * 1000) / quantityMilli) : 0);
      const sourceUnitCostMinor = parseSourceCostMinor(cell(row, index.unitCost));

      const orderId = (cell(row, index.orderId) ?? "").trim();
      const saleExternalId = shape === SHAPE_ORDER_ITEMS && orderId !== ""
        ? `FDX:${orderId}`
        : `PMIX:${slug(branchLabel ?? "الفرع")}:${businessDate}`;

      let sale = sales.get(saleExternalId);
      if (!sale) {
        sale = {
          externalId: saleExternalId,
          orderStatus: (cell(row, index.orderStatus) ?? "").trim() || null,
          businessDate,
          soldAt: parseSoldAt(cell(row, index.soldAt), businessDate),
          branchLabel,
          grossMinor: 0, discountMinor: 0, refundMinor: 0, vatMinor: 0, netMinor: 0,
          orderCount: shape === SHAPE_ORDER_ITEMS ? 1 : 0,
          isVoid: false,
          lines: [],
        };
        sales.set(saleExternalId, sale);
      }

      /*
        ── الترتيبُ آخرُ ما يدخل الهويّة، ولا بدّ منه ──

        لا معرّفَ للبند في التصدير، ويتكرّر (طلب · رمز · نوع) في ثمانيةَ
        عشر موضعاً — حتّى أربعِ مرّاتٍ في طلبٍ واحد. فبلا ترتيبٍ تبتلع
        النسخةُ الأولى الثلاثَ الباقيات.
      */
      const stateKey = `${saleExternalId}|${productExternalId}|${isModifier ? "M" : "P"}|${parentSku}`;
      const n = (occurrence.get(stateKey) ?? 0) + 1;
      occurrence.set(stateKey, n);

      const line: ParsedSaleLine = {
        externalId: `${productExternalId}#${isModifier ? "M" : "P"}${parentSku ? `:${parentSku}` : ""}#${n}`,
        productExternalId,
        name,
        category: (cell(row, index.category) ?? "").trim() || null,
        quantityMilli: Math.abs(quantityMilli),
        unitPriceMinor: Math.abs(unitPriceMinor),
        lineTotalMinor: Math.abs(lineTotalMinor),
        sourceStatus,
        isRefund,
        isVoid,
        /* لا عَلَمَ ضيافةٍ في هذا المصدر — ولا يُخترَع */
        isComplimentary: false,
        isModifier,
        parentExternalId: parentSku || null,
        modifiers: null,
        sourceUnitCostMinor,
        contentHash: contentFingerprint([
          quantityMilli, sourceStatus ?? "", lineTotalMinor, businessDate, branchLabel ?? "",
        ]),
        rowNumbers: [rowNumber],
      };

      sale.lines.push(line);
      if (isModifier && parentSku) pendingModifiers.push({ saleKey: saleExternalId, parentSku, line });

      /*
        ── الإيرادُ من صفوف المنتج وحدها ──

        سعرُ الأصل يشمل مُعدِّلاته (أثبته الملفّ في أربعين صفّاً). فجمعُ
        صفوف المُعدِّلات معها يضاعف ما لم يُقبَض.
      */
      if (!isModifier && !isVoid) {
        if (isRefund) sale.refundMinor += Math.abs(lineTotalMinor);
        else {
          sale.grossMinor += parseMoneyMinor(cell(row, index.gross)) ?? Math.abs(lineTotalMinor);
          sale.netMinor += Math.abs(lineTotalMinor);
        }
        sale.discountMinor += parseMoneyMinor(cell(row, index.discount)) ?? 0;
        sale.vatMinor += parseMoneyMinor(cell(row, index.vat)) ?? 0;
      }

      rows.push({ rowNumber, raw, status: "PARSED", reason: null, saleExternalId });
    });

    /* ── وصلُ المُعدِّل بأصله: يُعرَض على الأصل، ويُعلَن اليتيم ── */
    let orphans = 0;
    for (const { saleKey, parentSku, line } of pendingModifiers) {
      const sale = sales.get(saleKey);
      const parent = sale?.lines.find((l) => !l.isModifier && l.productExternalId === parentSku);
      if (!parent) { orphans++; continue; }
      parent.modifiers = [...(parent.modifiers ?? []), line.name];
    }
    if (orphans > 0) {
      warnings.push(`${orphans} خيارَ إضافةٍ لا أصلَ له في طلبه — حُفظ ولم يُنسَب.`);
    }

    /* حالُ الطلب تُحفَظ، ولا تُسقِط بنداً صُنع: الملغى يُعرَف ببنده */
    for (const sale of sales.values()) {
      sale.isVoid = sale.lines.length > 0 && sale.lines.every((l) => l.isVoid);
    }

    const dates = [...sales.values()].map((s) => s.businessDate).sort();

    return {
      adapter: FOODICS_ADAPTER,
      shape,
      sales: [...sales.values()],
      rows,
      periodStart: dates[0] ?? null,
      periodEnd: dates[dates.length - 1] ?? null,
      warnings,
      recognisedColumns: header.columns.recognised,
      unrecognisedColumns: header.columns.unrecognised,
    };
  },
};

/**
 * المحوّلاتُ المسجَّلة.
 *
 * وصيغةُ فودكس تتغيّر، والمحوّلُ الثاني يُسجَّل هنا **ولا يُمَسّ ما
 * بعده**: الخدمةُ والمحرّكُ والجردُ كلُّها تتعامل مع `ParsedSalesFile`
 * لا مع عمودٍ في ملفّ.
 */
export const SALES_FILE_ADAPTERS: readonly SalesFileAdapter[] = [foodicsExcelAdapter];

export function adapterFor(grid: readonly string[][]): SalesFileAdapter | null {
  return SALES_FILE_ADAPTERS.find((a) => a.detect(grid)) ?? null;
}
