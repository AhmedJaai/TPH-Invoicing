/**
 * استيرادُ ملفّ مبيعات — إلى مجال المبيعات القائم، لا إلى نموذجٍ ثانٍ.
 *
 * ── ثلاثُ طبقاتٍ تمنع التكرار ──
 *
 *   ١. **بصمةُ الملفّ** (`sales_imports.file_sha256` فريد) — الملفّ
 *      عينُه مرّتين يُردّ بإعلانٍ ويُرجَع استيرادُه السابق. ولا يُعَدّ
 *      ذلك فشلاً: رفعُ الملفّ ثانيةً فعلٌ طبيعيّ، والجوابُ الصحيح
 *      «هذا مستورَدٌ من قبل، وهذه نتيجتُه».
 *
 *   ٢. **المفتاحُ الطبيعيّ للبيعة** (`sales_uniq` على المصدر والمعرّف
 *      الخارجيّ) — فملفٌّ **آخر** يغطّي اليومَ نفسه لا يضاعفه. وهذه
 *      هي الطبقةُ التي تنجو حين يتغيّر الملفّ ويبقى الواقعُ واحداً.
 *
 *   ٣. **مفتاحُ السطر** (`sale_lines_external_uniq`).
 *
 * والدرسُ الذي بنى هذا مكتوبٌ في `CLAUDE.md`: كشفٌ بنكيّ استُورد ثلاث
 * مرّات فصارت ١٤٢٨ حركة ‏٤٢٨٤؛ ثمّ تغيّرت دالّةُ البصمة فدخل كشفٌ كامل
 * مرّةً ثانية — ١٤١٣ حركة بـ‏٩١٢٬٧١١ ريالاً. **فالمنعُ على المفتاح
 * الطبيعيّ لا على بصمةٍ تُحسَب.**
 *
 * ── والمنعُ لا يبتلع تصحيحاً ──
 *
 * وهذا هو الوجهُ الآخر، وهو أخطر: تصديرُ فودكس لا يحمل رقمَ نسخةٍ ولا
 * طابعَ إنشاء (فُحص ملفٌّ حقيقيّ). فطلبٌ أُلغي بعد تصدير الأمس يصل
 * اليوم بحال `Void` — ولو رُدّ الملفُّ «مكرَّراً» لبقي في قيدنا **مبيعاً
 * لم يقع**، ولحُسب استهلاكُه في الجرد.
 *
 * فالمفتاحُ يقول «هو هو»، و**بصمةُ المحتوى تقول «تغيّر»**:
 *
 *   مفتاحٌ جديد          ← يُكتَب        `PARSED`
 *   مفتاحٌ قائم وبصمةٌ نفسُها ← لا يُكتَب  `DUPLICATE`
 *   مفتاحٌ قائم وبصمةٌ اختلفت ← **يُحدَّث** `REVISED`
 *
 * وبصمةُ الملفّ تبقى الطبقةَ الأولى: الملفُّ عينُه بايتاً ببايت يُردّ
 * قبل أن يُقرأ — فذاك تكرارٌ يقينيّ لا مراجعةَ فيه.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  branches, posProducts, saleLines, sales, salesImportRows, salesImports, salesSources,
} from "@/db/schema";
import { readWorkbookSafely } from "@/lib/bank/parsers/safe-xlsx";
import { adapterFor } from "@/lib/sales/foodics-excel";
import { milliToDecimal } from "@/lib/inventory/units";
import type { ParsedSale, ParsedSalesFile } from "@/lib/sales/file-import";
import { recordAudit } from "@/lib/audit";
import { createId } from "@/lib/id";
import type { Conn } from "./types";

export const FOODICS_SOURCE_NAME = "فودكس";

export interface ImportResult {
  importId: string;
  status: "IMPORTED" | "PARTIAL" | "FAILED" | "DUPLICATE";
  adapter: string;
  shape: string;
  periodStart: string | null;
  periodEnd: string | null;
  totals: {
    rows: number;
    parsed: number;
    skipped: number;
    errors: number;
    duplicates: number;
    /** أسطرٌ كانت مقيَّدةً فتغيّر ما يقوله المصدر عنها — حُدّثت ولم تُردّ. */
    revised: number;
    salesWritten: number;
    salesRestated: number;
    lineCount: number;
    unitsMilli: number;
  };
  /** ماذا تغيّر بالضبط في المُراجَع — يُعرَض، فالتحديثُ الصامت لا يُراجَع. */
  revisions: { saleExternalId: string; lineExternalId: string; was: string; now: string }[];
  messages: string[];
  recognisedColumns: string[];
  unrecognisedColumns: string[];
  /**
   * أصنافٌ **مباعة** في هذا الملفّ لا صنفَ لها عندنا — تحتاج ربطاً.
   *
   * كان العددُ «ما لم يكن معروفاً قبل الملفّ» بلا تمييز، فدخلته الخياراتُ
   * (دبل شوت، حليب الشوفان) وهي لا تُربَط ولا وصفةَ لها بقرارٍ مكتوب —
   * فيقول الاستيرادُ «١١ تحتاج ربطاً» وصفحةُ الربط تقول «كلُّ ما بِيع
   * مربوط». وكان يعدّ الجديدَ وحده، فصنفٌ غيرُ مربوطٍ من ملفٍّ سابق لا
   * يُذكَر ثانيةً وهو ما زال ينتظر.
   */
  unmappedProducts: number;
  blocked?: string;
}

export function fileSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** مصدرُ المبيعات — صفٌّ واحد يخدم الإكسلَ اليوم والواجهةَ غداً. */
export async function ensureFoodicsSource(conn: Conn = db): Promise<string> {
  const [existing] = await conn
    .select({ id: salesSources.id })
    .from(salesSources)
    .where(eq(salesSources.name, FOODICS_SOURCE_NAME))
    .limit(1);
  if (existing) return existing.id;

  const [row] = await conn
    .insert(salesSources)
    .values({ name: FOODICS_SOURCE_NAME, kind: "POS", isConnected: false })
    .returning({ id: salesSources.id });
  return row.id;
}

/**
 * الفرعُ من الملفّ، وإلّا الفرعُ الافتراضيّ، وإلّا الفرعُ الوحيد.
 *
 * والأخيرُ ليس تخميناً: مقهىً بفرعٍ واحدٍ مسجَّل لا يحتمل غيرَه، وترْكُ
 * الفرع فارغاً فيه يعني أنّ كلّ بيعةٍ تبقى «مجهولة الفرع» بلا سبب.
 * أمّا فرعان فأكثر فلا يُرجَّح أحدُهما — ويبقى الفراغُ إعلاناً بأنّنا
 * لا نعرف.
 */
async function resolveBranch(label: string | null, conn: Conn): Promise<string | null> {
  if (!label) {
    const active = await conn
      .select({ id: branches.id, isDefault: branches.isDefault })
      .from(branches)
      .where(eq(branches.isActive, true))
      .limit(2);
    return active.find((b) => b.isDefault)?.id ?? (active.length === 1 ? active[0].id : null);
  }
  const [row] = await conn
    .select({ id: branches.id })
    .from(branches)
    .where(sql`lower(${branches.nameAr}) = lower(${label}) or lower(${branches.nameEn}) = lower(${label}) or lower(${branches.code}) = lower(${label})`)
    .limit(1);
  return row?.id ?? null;
}

export interface ImportInput {
  buffer: Buffer;
  fileName: string;
  actorId: string;
  fallbackBusinessDate?: string;
  branchLabel?: string;
}

/**
 * يقرأ الملفّ ويكتبه.
 *
 * والقراءةُ خارج المعاملة والكتابةُ داخلها: قراءةُ مصنّفٍ كبير تأخذ
 * ثوانيَ، وحجزُ اتّصالِ المعاملة طوالها على Vercel — حيث الاتّصالُ
 * واحد — يوقف الطلبات الأخرى.
 */
export async function importSalesFile(input: ImportInput, conn: Conn = db): Promise<ImportResult> {
  const sha = fileSha256(input.buffer);

  /* ── الطبقة الأولى: أهذا الملفّ عينُه؟ ── */
  const [seen] = await conn
    .select({
      id: salesImports.id, status: salesImports.status, adapter: salesImports.adapter,
      shape: salesImports.shape, periodStart: salesImports.periodStart, periodEnd: salesImports.periodEnd,
      totalRows: salesImports.totalRows, importedRows: salesImports.importedRows,
      skippedRows: salesImports.skippedRows, errorRows: salesImports.errorRows,
      duplicateRows: salesImports.duplicateRows, fileName: salesImports.fileName,
    })
    .from(salesImports)
    .where(eq(salesImports.fileSha256, sha))
    .limit(1);

  /*
    ── يُردّ بالبصمة ما استُورد كاملاً وحده ──

    ملفٌّ انتهى `FAILED` (لم يُفهَم منه سطر) أو `PARTIAL` (سقطت منه صفوف) كان
    يُردّ إلى الأبد «مستورَدٌ من قبل» — فإن أُصلح القارئُ لم يستطع صاحبُه رفعَ
    الملفّ نفسِه. فيُعاد، والمنعُ من التكرار باقٍ على مفتاح الطلب والسطر.
  */
  const retryOf = seen && seen.status !== "IMPORTED" ? seen.id : null;

  if (seen && retryOf === null) {
    return {
      importId: seen.id,
      status: "DUPLICATE",
      adapter: seen.adapter,
      shape: seen.shape ?? "",
      periodStart: seen.periodStart,
      periodEnd: seen.periodEnd,
      totals: {
        rows: seen.totalRows, parsed: seen.importedRows, skipped: seen.skippedRows,
        errors: seen.errorRows, duplicates: seen.duplicateRows, revised: 0,
        salesWritten: 0, salesRestated: 0, lineCount: 0, unitsMilli: 0,
      },
      revisions: [],
      messages: [`هذا الملفّ مستورَدٌ من قبل باسم «${seen.fileName}» — ولم يُكتب شيءٌ ثانيةً.`],
      recognisedColumns: [],
      unrecognisedColumns: [],
      unmappedProducts: 0,
    };
  }

  /*
    ── القيمُ الخام تُطلَب ──

    `business_date` عددٌ تسلسليّ يُصيَّر «9/19/26»: سنةٌ من خانتين
    وترتيبٌ يتبع تنسيقَ الملفّ. والعددُ نفسُه لا لبسَ فيه.
  */
  const workbook = readWorkbookSafely(input.buffer, { includeRaw: true });
  let parsed: ParsedSalesFile | null = null;
  let adapterName = "";
  let truncatedSheet: string | null = null;

  for (const sheet of workbook.sheets) {
    const adapter = adapterFor(sheet.grid);
    if (!adapter) continue;
    adapterName = adapter.name;
    parsed = adapter.parse({ grid: sheet.grid, raw: sheet.raw }, {
      fallbackBusinessDate: input.fallbackBusinessDate,
      branchLabel: input.branchLabel,
    });
    truncatedSheet = sheet.truncated.rows ? sheet.name : null;
    if (!parsed.blocked) break;
  }

  /*
    ── الورقةُ المبتورة لا تُستورَد ──

    القارئُ يقصّ عند حدّه ويكتفي بتحذير. والاستيرادُ يُلغي كلَّ سطرٍ مقيَّدٍ
    لبيعةٍ وردت في الملفّ ولم يرد هو فيه («غاب عن التصدير الأحدث») — وذاك
    يصحّ إن كان الملفُّ كاملاً. فطلبٌ قُصّ نصفُه يُلغى نصفُه الآخر صامتاً،
    وينخفض الاستهلاكُ المتوقَّع. فيُرفَض ولا يُكتَب شيء.
  */
  if (parsed && !parsed.blocked && truncatedSheet !== null) {
    parsed = {
      ...parsed,
      blocked:
        `الورقة «${truncatedSheet}» أطولُ ممّا يُقرأ في مرّة، فقُرئ أوّلُها فقط — ولم يُكتَب شيء. ` +
        "صدِّر من فودكس أسبوعاً واحداً في الملفّ وارفع كلَّ أسبوعٍ وحده.",
    };
  }

  if (!parsed || parsed.blocked) {
    const blocked = parsed?.blocked
      ?? "لم يُفهَم هذا الملفّ: لم يُعثَر على جدولٍ فيه «اسم الصنف» و«الكمّيّة».";
    return {
      importId: "",
      status: "FAILED",
      adapter: adapterName || "—",
      shape: "UNKNOWN",
      periodStart: null, periodEnd: null,
      totals: { rows: 0, parsed: 0, skipped: 0, errors: 0, duplicates: 0, revised: 0, salesWritten: 0, salesRestated: 0, lineCount: 0, unitsMilli: 0 },
      revisions: [],
      messages: [...workbook.warnings, blocked],
      recognisedColumns: parsed?.recognisedColumns ?? [],
      unrecognisedColumns: parsed?.unrecognisedColumns ?? [],
      unmappedProducts: 0,
      blocked,
    };
  }

  const file = parsed;
  const sourceId = await ensureFoodicsSource(conn);
  const branchId = await resolveBranch(input.branchLabel ?? file.sales[0]?.branchLabel ?? null, conn);

  /*
    ── مفتاحُ مزيج المنتجات من الفرع المعروف لا من نصّه ──

    كان `PMIX:{نصّ الفرع}:{اليوم}`: ملفٌّ فيه عمودُ الفرع وآخرُ بلا عمود، أو
    الاسمُ بالعربيّة مرّةً وبالإنجليزيّة أخرى — مفتاحان لليوم نفسه، فيُحسَب
    بيعُه مرّتين. والفرعُ يُحَلّ هنا إلى معرّفه.
  */
  for (const sale of file.sales) {
    if (sale.externalId.startsWith("PMIX:")) sale.externalId = `PMIX:${branchId ?? "no-branch"}:${sale.businessDate}`;
  }

  /*
    ── الطبقة الثانية: أهذه الأيّامُ مغطّاةٌ بصيغةٍ أخرى؟ ──

    «أصنافُ الطلبات» مفتاحُها الطلب (`FDX:`)، و«مزيجُ المنتجات» مفتاحُها اليوم
    (`PMIX:`) — فلا يرى أحدُهما الآخر، وتقريرا الأسبوع نفسه يُحسبان معاً:
    يتضاعف الاستهلاكُ المتوقَّع ويظهر فرقٌ كبيرٌ كاذب. فيُرفض الملفُّ ويُقال أيُّ
    الأيّام، ولا يُكتب شيء.
  */
  const kind = file.sales[0]?.externalId.startsWith("PMIX:") ? "PMIX" : "FDX";
  const days = [...new Set(file.sales.map((x) => x.businessDate))];
  if (days.length > 0) {
    const clash = (await conn.execute<{ day: string }>(sql`
      select distinct to_char(business_date::date, 'YYYY-MM-DD') as day
        from sales
       where source_id = ${sourceId}
         and business_date::date = any(${`{${days.join(",")}}`}::date[])
         and split_part(external_id, ':', 1) <> ${kind}
         and (branch_id is null or ${branchId}::text is null or branch_id = ${branchId})
       order by 1
    `)).rows.map((r) => r.day);
    if (clash.length > 0) {
      const blocked = `أيّامُ هذا الملفّ مستورَدةٌ من قبل بتقريرٍ آخر من فودكس (${kind === "PMIX" ? "أصناف الطلبات" : "مزيج المنتجات"}): `
        + `${clash.slice(0, 5).join("، ")}${clash.length > 5 ? ` و${clash.length - 5} غيرها` : ""}. `
        + "ولو استُورد لحُسب بيعُها مرّتين. استورد تقريراً واحداً لكلّ أسبوع — وأصنافُ الطلبات أدقّ.";
      return {
        importId: "", status: "FAILED", adapter: adapterName, shape: file.shape,
        periodStart: file.periodStart, periodEnd: file.periodEnd,
        totals: { rows: file.rows.length, parsed: 0, skipped: 0, errors: 0, duplicates: 0, revised: 0, salesWritten: 0, salesRestated: 0, lineCount: 0, unitsMilli: 0 },
        revisions: [], messages: [blocked], recognisedColumns: file.recognisedColumns, unrecognisedColumns: file.unrecognisedColumns,
        unmappedProducts: 0, blocked,
      };
    }
  }

  const messages: string[] = [...workbook.warnings, ...file.warnings];
  if (retryOf !== null) {
    messages.push("هذا الملفُّ رُفع من قبل ولم يُستورَد كاملاً — أُعيدت قراءتُه، وما كان مقيَّداً منه لم يُكتَب مرّتين.");
  }
  const written = await writeImport({
    file, sourceId, branchId, sha, input, messages, conn, retryOf,
  });

  await recordAudit({
    actorId: input.actorId,
    action: "SALES_IMPORTED",
    entityType: "sales_import",
    entityId: written.importId,
    after: {
      الملفّ: input.fileName,
      الصيغة: file.shape,
      الفترة: `${file.periodStart ?? "؟"} → ${file.periodEnd ?? "؟"}`,
      بيعات_كُتبت: written.totals.salesWritten,
      أسطر_مُراجَعة: written.totals.revised,
      صفوف_مقروءة: written.totals.parsed,
      صفوف_مكرَّرة: written.totals.duplicates,
      صفوف_مردودة: written.totals.errors,
    },
  }, conn);

  return written;
}

interface WriteInput {
  file: ParsedSalesFile;
  sourceId: string;
  branchId: string | null;
  sha: string;
  input: ImportInput;
  messages: string[];
  conn: Conn;
  /** استيرادٌ سابقٌ للملفّ عينِه لم يكتمل — يُخلي بصمتَه لهذا ويبقى أثراً. */
  retryOf: string | null;
}

async function writeImport(w: WriteInput): Promise<ImportResult> {
  const { file, sourceId, branchId, sha, input } = w;
  const messages = [...w.messages];

  return w.conn.transaction(async (tx) => {
    /*
      بصمةُ الملفّ فريدة. فالمحاولةُ السابقة تُخلي البصمةَ **داخل المعاملة** —
      إن سقطت هذه عادت تلك كما كانت — وتبقى بصفوفها الخام وأسبابها.
    */
    if (w.retryOf !== null) {
      await tx.update(salesImports)
        .set({ fileSha256: `${sha}:superseded:${w.retryOf}` })
        .where(eq(salesImports.id, w.retryOf));
    }

    const [imp] = await tx
      .insert(salesImports)
      .values({
        sourceId,
        branchId,
        fileName: input.fileName,
        fileSha256: sha,
        byteSize: input.buffer.byteLength,
        adapter: file.adapter,
        shape: file.shape,
        periodStart: file.periodStart,
        periodEnd: file.periodEnd,
        status: "PENDING",
        totalRows: file.rows.length,
      })
      .returning({ id: salesImports.id });

    /* ── أصنافُ نقاط البيع: تُقيَّد بمعرّفها الخارجيّ، وتُربَط لاحقاً بيدِ إنسان ── */
    const products = new Map<string, {
      name: string; category: string | null; priceMinor: number | null;
      kind: "PRODUCT" | "MODIFIER"; parentExternalId: string | null;
    }>();
    for (const sale of file.sales) {
      for (const line of sale.lines) {
        if (!products.has(line.productExternalId)) {
          products.set(line.productExternalId, {
            name: line.name,
            category: line.category,
            priceMinor: line.unitPriceMinor || null,
            /*
              خيارُ الإضافة يُقيَّد ويُوسَم — ولا يدخل طابور الربط.
              ولو دخله لطُلب من صاحب المقهى أن يربط «Double shots»
              بصنفٍ يُباع، وهو ليس كذلك ولا وصفةَ له.
            */
            kind: line.isModifier ? "MODIFIER" : "PRODUCT",
            parentExternalId: line.parentExternalId,
          });
        }
      }
    }

    const externalIds = [...products.keys()];
    if (externalIds.length > 0) {
      const values = externalIds.map((externalId) => {
        const p = products.get(externalId)!;
        return {
          sourceId, externalId,
          name: p.name, category: p.category, priceMinor: p.priceMinor,
          kind: p.kind, parentExternalId: p.parentExternalId,
        };
      });
      for (let i = 0; i < values.length; i += 300) {
        await tx
          .insert(posProducts)
          .values(values.slice(i, i + 300))
          /* القائمُ لا يُمَسّ: قد يكون مربوطاً بصنفٍ عندنا، والربطُ عملُ إنسانٍ لا يُداس */
          .onConflictDoNothing();
      }
    }

    const [{ unmappedProducts }] = externalIds.length === 0
      ? [{ unmappedProducts: 0 }]
      : await tx
          .select({ unmappedProducts: sql<number>`count(*)::int` })
          .from(posProducts)
          .where(and(
            eq(posProducts.sourceId, sourceId),
            inArray(posProducts.externalId, externalIds),
            eq(posProducts.kind, "PRODUCT"),
            sql`${posProducts.productId} is null`,
          ));

    const posByExternal = new Map(
      (await tx
        .select({ id: posProducts.id, externalId: posProducts.externalId })
        .from(posProducts)
        .where(and(eq(posProducts.sourceId, sourceId), inArray(posProducts.externalId, externalIds.length > 0 ? externalIds : [""])))
      ).map((r) => [r.externalId, r.id] as const),
    );

    /* ── البيعات: المفتاحُ يقول «هو هو»، والبصمةُ تقول «تغيّر» ── */
    const wanted = file.sales.map((s) => s.externalId);
    const existing = new Map<string, string>();
    for (const part of chunks(wanted, 1000)) {
      const rows = await tx
        .select({ id: sales.id, externalId: sales.externalId })
        .from(sales)
        .where(and(eq(sales.sourceId, sourceId), inArray(sales.externalId, part)));
      for (const r of rows) existing.set(r.externalId, r.id);
    }

    const saleIdByExternal = new Map<string, string>();
    /** رقمُ الصفّ ← ما وقع له، فيُكتَب في الخام بحاله وسببه. */
    const rowOutcome = new Map<number, { status: "PARSED" | "DUPLICATE" | "REVISED"; reason: string | null }>();
    const revisions: ImportResult["revisions"] = [];

    let salesWritten = 0;
    let salesRestated = 0;
    let lineCount = 0;
    let unitsMilli = 0;

    /*
      ── دفعاتٌ لا طلبٌ طلباً ──

      كان لكلّ بيعةٍ إدراجٌ أو تحديث ثمّ قراءةُ أسطرها ثمّ إدراجُها: أسبوعٌ
      حقيقيّ (١٬٠٩٠ طلباً) أكثرُ من ثلاثة آلاف رحلةٍ إلى القاعدة في معاملةٍ
      واحدة تحت مهلة ستّين ثانية — وملفُّ شهرٍ يسقط بها. فالبيعاتُ تُكتَب
      دفعةً (الجديدُ يُدرَج، والقائمُ يُحدَّث بمفتاحه الأساسيّ)، وأسطرُ
      القائم تُقرأ باستعلامٍ لكلّ ألف بيعة، ثمّ يُقرَّر في الذاكرة ويُكتَب دفعةً.
    */
    const saleRows = file.sales.map((sale) => {
      const prior = existing.get(sale.externalId);
      const id = prior ?? createId();
      saleIdByExternal.set(sale.externalId, id);
      if (prior) salesRestated++;
      else salesWritten++;
      lineCount += sale.lines.length;
      unitsMilli += sale.lines
        .filter((l) => !l.isModifier)
        .reduce((s, l) => s + (l.isVoid ? 0 : l.isRefund ? -l.quantityMilli : l.quantityMilli), 0);
      return {
        id, sourceId, branchId,
        externalId: sale.externalId,
        soldAt: sale.soldAt,
        businessDate: sale.businessDate,
        grossMinor: sale.grossMinor,
        discountMinor: sale.discountMinor,
        refundMinor: sale.refundMinor,
        vatMinor: sale.vatMinor,
        netMinor: sale.netMinor,
        orderCount: sale.orderCount,
        isVoid: sale.isVoid,
        importId: imp.id,
      };
    });
    for (const part of chunks(saleRows, 500)) {
      await tx.insert(sales).values(part).onConflictDoUpdate({
        target: sales.id,
        /*
          الطلبُ مقيَّد والملفُّ يتكلّم عنه ثانيةً: مجاميعُه مشتقّةٌ فتُحدَّث
          دائماً، ثمّ يُقرَّر لكلّ سطرٍ على حدة.
        */
        set: {
          /* تصديرٌ بلا فرعٍ لا يمحو فرعاً عُرف — المجهولُ لا يغلب المعلوم */
          branchId: sql`coalesce(excluded.branch_id, sales.branch_id)`,
          soldAt: sql`excluded.sold_at`,
          businessDate: sql`excluded.business_date`,
          grossMinor: sql`excluded.gross_minor`,
          discountMinor: sql`excluded.discount_minor`,
          refundMinor: sql`excluded.refund_minor`,
          vatMinor: sql`excluded.vat_minor`,
          netMinor: sql`excluded.net_minor`,
          orderCount: sql`excluded.order_count`,
          isVoid: sql`excluded.is_void`,
          importId: sql`excluded.import_id`,
        },
      });
    }

    /* أسطرُ البيعات القائمة — كلُّها باستعلامٍ لكلّ ألف بيعة */
    const priorLines = new Map<string, Map<string, PriorLine>>();
    for (const part of chunks([...existing.values()], 1000)) {
      const rows = await tx
        .select({
          id: saleLines.id, saleId: saleLines.saleId, externalId: saleLines.externalId,
          contentHash: saleLines.contentHash, sourceStatus: saleLines.sourceStatus,
          quantity: saleLines.quantity, isComplimentary: saleLines.isComplimentary,
          isModifier: saleLines.isModifier, parentLineExternalId: saleLines.parentLineExternalId,
        })
        .from(saleLines)
        .where(inArray(saleLines.saleId, part));
      for (const r of rows) {
        if (r.externalId === null) continue;
        let of = priorLines.get(r.saleId);
        if (!of) priorLines.set(r.saleId, (of = new Map()));
        of.set(r.externalId, { ...r, externalId: r.externalId });
      }
    }

    const fresh: SaleLineRow[] = [];
    const changed: (SaleLineRow & { id: string })[] = [];
    const removed: string[] = [];
    for (const sale of file.sales) {
      const saleId = saleIdByExternal.get(sale.externalId)!;
      const outcome = decideLines(saleId, sale, posByExternal, priorLines.get(saleId) ?? new Map());
      fresh.push(...outcome.fresh);
      changed.push(...outcome.changed);
      removed.push(...outcome.removed);
      for (const rev of outcome.revised) revisions.push({ saleExternalId: sale.externalId, ...rev });
      for (const [rowNumber, o] of outcome.byRow) rowOutcome.set(rowNumber, o);
      if (outcome.keptDespiteAbsence > 0) {
        messages.push(
          `يومُ ${sale.businessDate}: الملفُّ يذكر أقلَّ من نصف أصنافه المقيَّدة — يبدو تقريراً مرشَّحاً، ` +
          `فلم يُلغَ ما غاب عنه (${outcome.keptDespiteAbsence}). إن كان التقريرُ كاملاً فارفعه بلا ترشيح.`,
        );
      }
    }

    for (const part of chunks(fresh, 500)) {
      await tx.insert(saleLines).values(part).onConflictDoNothing();
    }
    for (const part of chunks(changed, 500)) {
      await tx.insert(saleLines).values(part).onConflictDoUpdate({
        target: saleLines.id,
        set: {
          posProductId: sql`excluded.pos_product_id`,
          description: sql`excluded.description`,
          quantity: sql`excluded.quantity`,
          unitPriceMinor: sql`excluded.unit_price_minor`,
          lineTotalMinor: sql`excluded.line_total_minor`,
          sourceStatus: sql`excluded.source_status`,
          isRefund: sql`excluded.is_refund`,
          isVoid: sql`excluded.is_void`,
          isComplimentary: sql`excluded.is_complimentary`,
          isModifier: sql`excluded.is_modifier`,
          parentExternalId: sql`excluded.parent_external_id`,
          parentLineExternalId: sql`excluded.parent_line_external_id`,
          modifiers: sql`excluded.modifiers`,
          contentHash: sql`excluded.content_hash`,
        },
      });
    }
    for (const part of chunks(removed, 1000)) {
      await tx.update(saleLines)
        .set({
          isVoid: true,
          sourceStatus: REMOVED_STATUS,
          contentHash: sql`concat(${REMOVED_STATUS}::text, ':', sale_lines.external_id)`,
        })
        .where(inArray(saleLines.id, part));
    }

    /* ── وكلُّ صفٍّ يُحفَظ خاماً بحاله وسببه ── */
    const rowValues = file.rows.map((r) => {
      const decided = rowOutcome.get(r.rowNumber);
      return {
        importId: imp.id,
        rowNumber: r.rowNumber,
        raw: r.raw as never,
        status: decided ? decided.status : r.status,
        reason: decided ? decided.reason : r.reason,
        saleId: r.saleExternalId ? saleIdByExternal.get(r.saleExternalId) ?? null : null,
      };
    });
    for (let i = 0; i < rowValues.length; i += 500) {
      await tx.insert(salesImportRows).values(rowValues.slice(i, i + 500));
    }

    const counts = {
      parsed: rowValues.filter((r) => r.status === "PARSED").length,
      skipped: rowValues.filter((r) => r.status === "SKIPPED").length,
      errors: rowValues.filter((r) => r.status === "ERROR").length,
      duplicates: rowValues.filter((r) => r.status === "DUPLICATE").length,
      revised: rowValues.filter((r) => r.status === "REVISED").length,
    };

    /*
      ── «لم يُكتب شيء» ليست «فشلاً» ──

      ملفٌّ كلُّ أسطره مقيَّدةٌ بلا تغيير استيرادٌ ناجحٌ لا شيءَ فيه
      جديد. والفشلُ أن يُقرأ الملفُّ فلا يخرج منه سطرٌ مفهومٌ أصلاً.
    */
    const understood = counts.parsed + counts.duplicates + counts.revised;
    const status: ImportResult["status"] =
      understood === 0 ? "FAILED" : counts.errors > 0 ? "PARTIAL" : "IMPORTED";

    if (counts.errors > 0) {
      messages.push(`${counts.errors} صفّاً لم يُقرأ — محفوظٌ بنصّه وسببه، ويُعرَض أدناه.`);
    }
    if (counts.revised > 0) {
      messages.push(
        `${counts.revised} سطراً كان مقيَّداً وتغيّر ما يقوله المصدر عنه — حُدّث ولم يُردّ. والتفصيل أدناه.`,
      );
    }
    if (counts.duplicates > 0) {
      messages.push(`${counts.duplicates} سطراً مقيَّدٌ من قبل بلا تغيير — لم يُكتب مرّتين.`);
    }

    await tx
      .update(salesImports)
      .set({
        status,
        importedRows: counts.parsed,
        skippedRows: counts.skipped,
        errorRows: counts.errors,
        duplicateRows: counts.duplicates,
        revisedRows: counts.revised,
        messages: messages as never,
      })
      .where(eq(salesImports.id, imp.id));

    return {
      importId: imp.id,
      status,
      adapter: file.adapter,
      shape: file.shape,
      periodStart: file.periodStart,
      periodEnd: file.periodEnd,
      totals: {
        rows: file.rows.length,
        parsed: counts.parsed,
        skipped: counts.skipped,
        errors: counts.errors,
        duplicates: counts.duplicates,
        revised: counts.revised,
        salesWritten, salesRestated, lineCount, unitsMilli,
      },
      revisions,
      messages,
      recognisedColumns: file.recognisedColumns,
      unrecognisedColumns: file.unrecognisedColumns,
      unmappedProducts: Number(unmappedProducts),
    };
  });
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type SaleLineRow = typeof saleLines.$inferInsert;

interface PriorLine {
  id: string;
  externalId: string;
  contentHash: string | null;
  sourceStatus: string | null;
  quantity: string | null;
  isComplimentary: boolean;
  isModifier: boolean;
  parentLineExternalId: string | null;
}

interface LineOutcome {
  byRow: Map<number, { status: "PARSED" | "DUPLICATE" | "REVISED"; reason: string | null }>;
  revised: { lineExternalId: string; was: string; now: string }[];
  /** أسطرٌ لم تكن مقيَّدة — تُدرَج. */
  fresh: SaleLineRow[];
  /** أسطرٌ مقيَّدة تغيّر ما يُكتَب لها — تُحدَّث بمفتاحها. */
  changed: (SaleLineRow & { id: string })[];
  /** أسطرٌ مقيَّدة غابت عن الملفّ — تُلغى ولا تُحذف. */
  removed: string[];
  /** غابت ولم تُلغَ: الملفُّ يبدو مرشَّحاً لا كاملاً. */
  keptDespiteAbsence: number;
}

/** أقلُّ من نصف أصناف اليوم المقيَّدة ← التقريرُ مرشَّحٌ لا مصحَّح. */
const PRODUCT_MIX_COMPLETE_SHARE = 0.5;

/**
 * يقرّر لكلّ سطرٍ في البيعة: جديدٌ أم مكرَّرٌ أم مُراجَع — **في الذاكرة**،
 * والكتابةُ دفعةً بعده.
 *
 * ── وما غاب عن التصدير الأحدث يُلغى ولا يُحذف ──
 *
 * البيعةُ في الملفّ كاملة (الطلبُ كلُّه، أو اليومُ كلُّه في مزيج المنتجات)؛
 * فسطرٌ قُيِّد من تصديرٍ سابقٍ ولم يرد في هذا لم يعد في المصدر — طلبٌ صُحّح
 * فنقص صنفاً، أو تكرّر الصنفُ مرّةً أقلّ. فيُعلَّم ملغًى ويُعلَن في «ما
 * رُوجع»، ولا يُحذف: إعادةُ استيراد الملفّ الكامل تعيده.
 *
 * **و«كاملة» تُفحَص في مزيج المنتجات**: مفتاحُه اليوم، وتقريرٌ مرشَّحٌ بتصنيفٍ
 * واحد يحمل المفتاحَ نفسَه — فكان بقيّةُ اليوم يُلغى صامتاً وينخفض الاستهلاك.
 * فإن ذكر الملفُّ أقلَّ من نصف أصناف اليوم المقيَّدة لم يُلغَ شيءٌ ويُقال ذلك.
 */
export function decideLines(
  saleId: string,
  sale: ParsedSale,
  posByExternal: ReadonlyMap<string, string>,
  prior: ReadonlyMap<string, PriorLine>,
): LineOutcome {
  const out: LineOutcome = { byRow: new Map(), revised: [], fresh: [], changed: [], removed: [], keptDespiteAbsence: 0 };
  if (sale.lines.length === 0) return out;

  for (const l of sale.lines) {
    const values = {
      saleId,
      posProductId: posByExternal.get(l.productExternalId) ?? null,
      externalId: l.externalId,
      description: l.name,
      quantity: milliToDecimal(l.quantityMilli),
      unitPriceMinor: l.unitPriceMinor,
      lineTotalMinor: l.lineTotalMinor,
      sourceStatus: l.sourceStatus,
      isRefund: l.isRefund,
      isVoid: l.isVoid,
      isComplimentary: l.isComplimentary,
      isModifier: l.isModifier,
      parentExternalId: l.parentExternalId,
      parentLineExternalId: l.parentLineExternalId,
      modifiers: (l.modifiers ?? null) as never,
      contentHash: l.contentHash,
    };

    const was = prior.get(l.externalId);
    if (!was) {
      out.fresh.push(values);
      for (const n of l.rowNumbers) out.byRow.set(n, { status: "PARSED", reason: null });
      continue;
    }

    if (was.contentHash === l.contentHash) {
      /*
        ما يقوله المصدرُ لم يتغيّر — وما **نشتقّه نحن** منه قد تغيّر: سطرُ الأصل
        للخيار (`065`) وعَلَمُ المجانيّ لم يكونا يُكتبان. فيُملآن بلا إعلان
        مراجعة: المصدرُ لم يراجِع شيئاً.
      */
      if (was.isComplimentary !== l.isComplimentary || was.parentLineExternalId !== l.parentLineExternalId) {
        out.changed.push({ ...values, id: was.id });
      }
      for (const n of l.rowNumbers) {
        out.byRow.set(n, { status: "DUPLICATE", reason: "مقيَّدٌ من قبل بلا تغيير — لم يُكتب مرّتين" });
      }
      continue;
    }

    /*
      ── تغيّر ما يقوله المصدر: يُحدَّث ويُعلَن ──

      وأخطرُ ما يقع هنا أن يُردّ: طلبٌ أُلغي بعد تصدير الأمس يصل اليوم
      بحال `Void`. فردُّه «مكرَّراً» يُبقي في قيدنا مبيعاً لم يقع،
      ويُحسَب استهلاكُه في الجرد.
    */
    out.changed.push({ ...values, id: was.id });
    const describe = (status: string | null, qty: string | null) =>
      `${status ?? "—"} × ${qty ?? "—"}`;
    out.revised.push({
      lineExternalId: l.externalId,
      was: describe(was.sourceStatus, was.quantity),
      now: describe(l.sourceStatus, milliToDecimal(l.quantityMilli)),
    });
    for (const n of l.rowNumbers) {
      out.byRow.set(n, {
        status: "REVISED",
        reason: `تغيّر ما يقوله المصدر: ${describe(was.sourceStatus, was.quantity)} ← ${describe(l.sourceStatus, milliToDecimal(l.quantityMilli))}`,
      });
    }
  }

  const inFile = new Set(sale.lines.map((l) => l.externalId));
  const absent = [...prior.values()].filter((was) => !inFile.has(was.externalId) && was.sourceStatus !== REMOVED_STATUS);
  if (absent.length === 0) return out;

  if (sale.externalId.startsWith("PMIX:")) {
    const live = [...prior.values()].filter((was) => !was.isModifier && was.sourceStatus !== REMOVED_STATUS).length;
    const named = sale.lines.filter((l) => !l.isModifier).length;
    if (live > 0 && named < live * PRODUCT_MIX_COMPLETE_SHARE) {
      out.keptDespiteAbsence = absent.length;
      return out;
    }
  }

  for (const was of absent) {
    out.removed.push(was.id);
    out.revised.push({
      lineExternalId: was.externalId,
      was: `${was.sourceStatus ?? "—"} × ${was.quantity ?? "—"}`,
      now: "غاب عن التصدير الأحدث — أُلغي",
    });
  }
  return out;
}

/** حالُ سطرٍ غاب عن تصديرٍ أحدث للبيعة نفسها — يُلغى ولا يُحذف. */
const REMOVED_STATUS = "REMOVED_IN_LATER_EXPORT";
