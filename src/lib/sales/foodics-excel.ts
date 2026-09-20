/**
 * محوِّلُ ملفّ فودكس — الطريقُ الأوّل إلى مجال المبيعات.
 *
 * ── صيغتان لا واحدة ──
 *
 *   **تصديرُ الطلبات** — لكلّ صفٍّ رقمُ طلبه، فالبيعةُ بيعةٌ حقيقيّة
 *   وهويّتُها رقمُ الطلب عند فودكس.
 *
 *   **تصديرُ مزيج الأصناف** — لا رقمَ طلبٍ فيه، بل «كم بِيع من كلّ
 *   صنفٍ في اليوم». فتُصطنَع بيعةٌ واحدة لليوم والفرع، هويّتُها
 *   `PMIX:{الفرع}:{التاريخ}` — **ومعنى ذلك أنّ ملفّاً ثانياً يغطّي
 *   اليوم نفسه يُعيد بيانَه ولا يضيفه**، وهو الصواب: التقريران عن
 *   اليوم الواحد ليسا بيعتين.
 *
 * ── والهويّة من البيانات لا من الملفّ ──
 *
 * بصمةُ الملفّ تمنع رفعَ الملفّ عينِه مرّتين، ولا تمنع أن يغطّي ملفّان
 * مختلفان اليومَ نفسه. فالمنعُ الحقيقيّ على المفتاح الذي تعطيه
 * البيانات — الدرسُ نفسه الذي كلّف كشفاً بنكياً ١٤١٣ حركةً مكرّرة
 * حين تغيّرت دالّةُ بصمته.
 */
import {
  mapColumns, FIELD_LABEL,
  type ColumnMap, type SalesColumn,
} from "./columns";
import {
  detectDateOrder, parseBusinessDate, parseFlag, parseMoneyMinor,
  parseQuantityMilli, parseSoldAt, type DateOrder,
} from "./values";
import type {
  ParsedRow, ParsedSale, ParsedSaleLine, SalesFileAdapter,
} from "./file-import";

export const FOODICS_ADAPTER = "FOODICS_XLSX";
export const SHAPE_ORDERS = "FOODICS_ORDERS";
export const SHAPE_PRODUCT_MIX = "FOODICS_PRODUCT_MIX";

/** أقصى عددِ صفوفٍ تُقرأ قبل الترويسة بحثاً عنها. */
const HEADER_SCAN = 15;

interface HeaderFound {
  rowIndex: number;
  columns: ColumnMap;
}

/**
 * يجد صفَّ الترويسة.
 *
 * تقاريرُ فودكس تبدأ بأسطرِ عنوانٍ وفترةٍ واسمِ منشأة قبل الجدول. فلا
 * يُفترَض أنّ الصفّ الأوّل ترويسة: يُبحَث عن أوّل صفٍّ يُفهَم منه
 * **اسمُ الصنف والكمّيّة** معاً — وهما أقلُّ ما لا يقوم الاستيراد
 * بدونه.
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

function cell(row: readonly string[], at: number | undefined): string | undefined {
  if (at === undefined) return undefined;
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

  parse(grid, options) {
    const warnings: string[] = [];
    const header = findHeader(grid);

    if (!header) {
      return {
        adapter: FOODICS_ADAPTER,
        shape: "UNKNOWN",
        sales: [], rows: [],
        periodStart: null, periodEnd: null,
        warnings,
        recognisedColumns: [], unrecognisedColumns: [],
        blocked:
          "لم يُفهَم هذا الملفّ: لم يُعثَر على عمودَي «اسم الصنف» و«الكمّيّة». " +
          "صدِّر من فودكس تقريرَ الأصناف أو تقريرَ الطلبات بترويسةٍ واحدة.",
      };
    }

    const { index } = header.columns;
    const headerRow = grid[header.rowIndex] ?? [];
    const body = grid.slice(header.rowIndex + 1);
    const shape = index.orderId !== undefined ? SHAPE_ORDERS : SHAPE_PRODUCT_MIX;

    /* ترتيبُ اليوم والشهر يُستنتَج من الملفّ كلّه قبل قراءة صفٍّ واحد */
    const dateColumn: SalesColumn | null =
      index.businessDate !== undefined ? "businessDate" : index.soldAt !== undefined ? "soldAt" : null;
    const samples = dateColumn
      ? body.map((r) => cell(r, index[dateColumn]) ?? "").filter((s) => s !== "").slice(0, 200)
      : [];
    const order: DateOrder = detectDateOrder(samples);
    if (order === "AMBIGUOUS" && samples.length > 0) {
      warnings.push(
        "لم يقطع الملفّ بترتيب اليوم والشهر في تواريخه — قُرئت **اليومُ أوّلاً** (٠٣/٠٩ = ٣ سبتمبر). " +
        "راجِع الفترة المعروضة أدناه قبل الاعتماد.",
      );
    }
    if (!dateColumn) {
      warnings.push(
        options.fallbackBusinessDate
          ? `لا عمودَ تاريخٍ في الملفّ — نُسبت الصفوفُ كلُّها إلى ${options.fallbackBusinessDate} كما اخترتَ.`
          : "لا عمودَ تاريخٍ في الملفّ، ولم يُحدَّد يومُ عملٍ — فلا يُعرَف متى بِيع.",
      );
    }

    const rows: ParsedRow[] = [];
    const sales = new Map<string, ParsedSale>();
    const lineSeen = new Map<string, ParsedSaleLine>();
    const occurrence = new Map<string, number>();

    body.forEach((row, i) => {
      const rowNumber = header.rowIndex + i + 2; // رقمُ الصفّ في الملفّ، ١‑مبنيّ ومعه الترويسة
      const raw = rawOf(headerRow, row);

      const reject = (status: ParsedRow["status"], reason: string) => {
        rows.push({ rowNumber, raw, status, reason, saleExternalId: null });
      };

      /* صفٌّ فارغٌ تماماً ليس خطأً — تقاريرُ فودكس تفصل أقسامَها بفراغ */
      if (Object.keys(raw).length === 0) {
        reject("SKIPPED", "صفٌّ فارغ");
        return;
      }

      const name = (cell(row, index.productName) ?? "").trim();
      if (name === "") {
        reject("SKIPPED", "لا اسمَ صنفٍ في الصفّ — غالباً سطرُ مجموعٍ أو فاصل");
        return;
      }

      /*
        ── الخانةُ الفارغة ليست الخانةَ المعطوبة ──

        تقاريرُ فودكس تحمل سطرَ مجموعٍ في ذيل كلّ قسم: خانةُ الصنف فيه
        «الإجمالي» وخانةُ الكمّيّة فارغة. ولو عُدّ ذلك **خطأً** لخرج من
        كلّ استيرادٍ خطآن أو ثلاثة لا شيءَ فيها — ومن يرى خطأً كلَّ مرّة
        يتعلّم ألّا ينظر، فيمرّ الخطأُ الحقيقيّ معها.

        فالفارغُ يُتخطّى بسببه، والمكتوبُ الذي لا يُقرأ خطأٌ يُعلَن.
      */
      const quantityCell = (cell(row, index.quantity) ?? "").trim();
      if (quantityCell === "") {
        reject("SKIPPED", "لا كمّيّة في الصفّ — غالباً سطرُ مجموعٍ أو فاصل");
        return;
      }
      const quantityMilli = parseQuantityMilli(quantityCell);
      if (quantityMilli === null) {
        reject("ERROR", `تعذّرت قراءة ${FIELD_LABEL.quantity}: «${quantityCell}»`);
        return;
      }

      const businessDate = dateColumn
        ? parseBusinessDate(cell(row, index[dateColumn]), order)
        : (options.fallbackBusinessDate ?? null);
      if (!businessDate) {
        reject("ERROR", "لا يُعرَف يومُ عمل هذا الصفّ — وبيعةٌ في اليوم الخطأ تُحسَب بوصفةٍ أخرى");
        return;
      }

      const branchLabel = (cell(row, index.branch) ?? options.branchLabel ?? "").trim() || null;
      const productExternalId = (cell(row, index.productExternalId) ?? "").trim() || `NAME:${slug(name)}`;

      const lineTotalMinor = parseMoneyMinor(cell(row, index.lineTotal)) ?? 0;
      const unitPriceMinor = parseMoneyMinor(cell(row, index.unitPrice))
        ?? (quantityMilli !== 0 ? Math.round((lineTotalMinor * 1000) / quantityMilli) : 0);

      /*
        الكمّيّة السالبة مرتجَعٌ ضمنيّ — كثيرٌ من التصديرات تكتفي بها
        ولا تضع عموداً. وتُقلَب موجبةً ويُوسَم السطرُ مرتجَعاً، فيبقى
        حساب الاستهلاك واحداً مهما اختلفت صيغةُ الملفّ.
      */
      const explicitRefund = parseFlag(cell(row, index.isRefund)) === true;
      const isRefund = explicitRefund || quantityMilli < 0;
      const isVoid = parseFlag(cell(row, index.isVoid)) === true;
      const isComplimentary = parseFlag(cell(row, index.isComplimentary)) === true
        || (lineTotalMinor === 0 && !isVoid && !isRefund && quantityMilli > 0 && index.lineTotal !== undefined);

      const modifiersRaw = (cell(row, index.modifiers) ?? "").trim();
      const modifiers = modifiersRaw === ""
        ? null
        : modifiersRaw.split(/[,،;|+]/).map((m) => m.trim()).filter((m) => m !== "");

      const orderId = (cell(row, index.orderId) ?? "").trim();
      const saleExternalId = shape === SHAPE_ORDERS && orderId !== ""
        ? `FDX:${orderId}`
        : `PMIX:${slug(branchLabel ?? "الفرع")}:${businessDate}`;

      let sale = sales.get(saleExternalId);
      if (!sale) {
        sale = {
          externalId: saleExternalId,
          businessDate,
          soldAt: parseSoldAt(cell(row, index.soldAt), businessDate),
          branchLabel,
          grossMinor: 0, discountMinor: 0, refundMinor: 0, vatMinor: 0, netMinor: 0,
          orderCount: shape === SHAPE_ORDERS ? 1 : 0,
          isVoid: false,
          lines: [],
        };
        sales.set(saleExternalId, sale);
      }

      /*
        مفتاحُ السطر داخل بيعته: الصنفُ وحالُه وترتيبُ تكراره.
        و`occurrence` آخرُ ما يدخل المفتاح لا أوّلُه — فاتنان من
        الصنف نفسه في الطلب الواحد حقيقةٌ تقع، ولا يُفرَّق بينهما
        إلّا به.
      */
      const stateKey = `${saleExternalId}|${productExternalId}|${isRefund ? "R" : ""}${isVoid ? "V" : ""}${isComplimentary ? "C" : ""}`;
      const mix = shape === SHAPE_PRODUCT_MIX;

      /*
        ── ولماذا لا يدخل الترتيبُ مفتاحَ سطرِ «مزيج الأصناف» ──

        في تصدير الطلبات، صنفان متطابقان في الطلب الواحد **واقعتان**:
        كوبان بِيعا معاً، ولا يفرّق بينهما إلّا الترتيب. وفي تصدير مزيج
        الأصناف الصفُّ **ملخّصٌ ليومٍ كامل**، فذكرُ الصنف مرّتين (قسمان
        في التقرير) شيءٌ واحد يُجمَع.

        فلو أُدخل الترتيبُ في الحالين لخرج من اليوم الواحد سطران
        لصنفٍ واحد، ولصار إعادةُ الاستيراد تكتب سطرين جديدين بمفتاحين
        جديدين. والترتيبُ آخرُ ما يدخل الهويّة ولا يدخلها إلّا بحاجة.
      */
      const n = mix ? 1 : (occurrence.get(stateKey) ?? 0) + 1;
      if (!mix) occurrence.set(stateKey, n);
      const lineExternalId = `${productExternalId}#${isRefund ? "R" : "S"}#${n}`;

      const mergeKey = `${saleExternalId}|${lineExternalId}`;
      const existing = mix ? lineSeen.get(mergeKey) : undefined;

      const absQuantity = Math.abs(quantityMilli);
      const absTotal = Math.abs(lineTotalMinor);

      if (existing) {
        existing.quantityMilli += absQuantity;
        existing.lineTotalMinor += absTotal;
        existing.rowNumbers.push(rowNumber);
      } else {
        const line: ParsedSaleLine = {
          externalId: lineExternalId,
          productExternalId,
          name,
          category: (cell(row, index.category) ?? "").trim() || null,
          quantityMilli: absQuantity,
          unitPriceMinor: Math.abs(unitPriceMinor),
          lineTotalMinor: absTotal,
          isRefund, isVoid, isComplimentary,
          modifiers,
          rowNumbers: [rowNumber],
        };
        sale.lines.push(line);
        lineSeen.set(mergeKey, line);
      }

      /* المرتجَعُ يُجمَع في خانته لا في الإجمالي — فيبقى الصافي صافياً */
      if (!isVoid) {
        if (isRefund) sale.refundMinor += absTotal;
        else {
          sale.grossMinor += parseMoneyMinor(cell(row, index.gross)) ?? absTotal;
          sale.netMinor += absTotal;
        }
        sale.discountMinor += parseMoneyMinor(cell(row, index.discount)) ?? 0;
        sale.vatMinor += parseMoneyMinor(cell(row, index.vat)) ?? 0;
      }

      rows.push({ rowNumber, raw, status: "PARSED", reason: null, saleExternalId });
    });

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
