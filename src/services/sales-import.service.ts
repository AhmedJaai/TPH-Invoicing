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

  if (seen) {
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

  for (const sheet of workbook.sheets) {
    const adapter = adapterFor(sheet.grid);
    if (!adapter) continue;
    adapterName = adapter.name;
    parsed = adapter.parse({ grid: sheet.grid, raw: sheet.raw }, {
      fallbackBusinessDate: input.fallbackBusinessDate,
      branchLabel: input.branchLabel,
    });
    if (!parsed.blocked) break;
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

  const messages: string[] = [...workbook.warnings, ...file.warnings];
  const written = await writeImport({
    file, sourceId, branchId, sha, input, messages, conn,
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
}

async function writeImport(w: WriteInput): Promise<ImportResult> {
  const { file, sourceId, branchId, sha, input } = w;
  const messages = [...w.messages];

  return w.conn.transaction(async (tx) => {
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
    const existing = new Map(
      wanted.length === 0 ? [] : (await tx
        .select({ id: sales.id, externalId: sales.externalId })
        .from(sales)
        .where(and(eq(sales.sourceId, sourceId), inArray(sales.externalId, wanted)))
      ).map((r) => [r.externalId, r.id] as const),
    );

    const saleIdByExternal = new Map<string, string>();
    /** رقمُ الصفّ ← ما وقع له، فيُكتَب في الخام بحاله وسببه. */
    const rowOutcome = new Map<number, { status: "PARSED" | "DUPLICATE" | "REVISED"; reason: string | null }>();
    const revisions: ImportResult["revisions"] = [];

    let salesWritten = 0;
    let salesRestated = 0;
    let lineCount = 0;
    let unitsMilli = 0;

    for (const sale of file.sales) {
      const prior = existing.get(sale.externalId);
      let saleId: string;

      if (prior) {
        /*
          ── الطلبُ مقيَّد، والملفُّ يتكلّم عنه ثانيةً ──

          ولا يُردّ: قد يكون تصديراً مصحَّحاً. تُحدَّث مجاميعُ البيعة
          دائماً (فهي مشتقّة)، ثمّ يُقرَّر لكلّ سطرٍ على حدة.
        */
        await tx
          .update(sales)
          .set({
            branchId,
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
          })
          .where(eq(sales.id, prior));
        saleId = prior;
        salesRestated++;
      } else {
        const [row] = await tx
          .insert(sales)
          .values({
            sourceId, branchId,
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
          })
          .returning({ id: sales.id });
        saleId = row.id;
        salesWritten++;
      }

      saleIdByExternal.set(sale.externalId, saleId);
      lineCount += sale.lines.length;
      unitsMilli += sale.lines
        .filter((l) => !l.isModifier)
        .reduce((s, l) => s + (l.isVoid ? 0 : l.isRefund ? -l.quantityMilli : l.quantityMilli), 0);

      const outcome = await writeLines(tx, saleId, sale, posByExternal, Boolean(prior));
      for (const rev of outcome.revised) {
        revisions.push({ saleExternalId: sale.externalId, ...rev });
      }
      for (const [rowNumber, o] of outcome.byRow) rowOutcome.set(rowNumber, o);
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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface LineOutcome {
  byRow: Map<number, { status: "PARSED" | "DUPLICATE" | "REVISED"; reason: string | null }>;
  revised: { lineExternalId: string; was: string; now: string }[];
}

/**
 * يكتب أسطر البيعة، ويقرّر لكلّ سطرٍ: جديدٌ أم مكرَّرٌ أم مُراجَع.
 *
 * ── ولا يُحذَف سطرٌ لم يذكره الملفّ ──
 *
 * تصديرٌ أضيق (يومٌ واحد من أسبوع، أو تقريرٌ مرشَّح) لا يعني أنّ ما
 * سكت عنه لم يقع. فالحذفُ على السكوت يُفقد بيعاتٍ حقيقيّة بلا أثر —
 * والنقصُ لا يُرى في أيّ مجموع. فما سكت عنه الملفّ يبقى كما هو.
 */
async function writeLines(
  tx: Tx,
  saleId: string,
  sale: ParsedSale,
  posByExternal: ReadonlyMap<string, string>,
  saleExisted: boolean,
): Promise<LineOutcome> {
  const out: LineOutcome = { byRow: new Map(), revised: [] };
  if (sale.lines.length === 0) return out;

  const prior = saleExisted
    ? new Map(
        (await tx
          .select({
            id: saleLines.id, externalId: saleLines.externalId,
            contentHash: saleLines.contentHash, sourceStatus: saleLines.sourceStatus,
            quantity: saleLines.quantity,
          })
          .from(saleLines)
          .where(eq(saleLines.saleId, saleId))
        ).filter((r): r is typeof r & { externalId: string } => r.externalId !== null)
         .map((r) => [r.externalId, r] as const),
      )
    : new Map();

  const fresh: (typeof saleLines.$inferInsert)[] = [];

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
      modifiers: (l.modifiers ?? null) as never,
      contentHash: l.contentHash,
    };

    const was = prior.get(l.externalId);
    if (!was) {
      fresh.push(values);
      for (const n of l.rowNumbers) out.byRow.set(n, { status: "PARSED", reason: null });
      continue;
    }

    if (was.contentHash === l.contentHash) {
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
    await tx.update(saleLines).set(values).where(eq(saleLines.id, was.id));
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

  for (let i = 0; i < fresh.length; i += 500) {
    await tx.insert(saleLines).values(fresh.slice(i, i + 500)).onConflictDoNothing();
  }
  return out;
}
