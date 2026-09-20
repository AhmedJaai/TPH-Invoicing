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
    salesWritten: number;
    salesRestated: number;
    lineCount: number;
    unitsMilli: number;
  };
  messages: string[];
  recognisedColumns: string[];
  unrecognisedColumns: string[];
  /** أصنافُ فودكس التي لم تكن معروفة قبل هذا الملفّ — تحتاج ربطاً. */
  newPosProducts: number;
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
        errors: seen.errorRows, duplicates: seen.duplicateRows,
        salesWritten: 0, salesRestated: 0, lineCount: 0, unitsMilli: 0,
      },
      messages: [`هذا الملفّ مستورَدٌ من قبل باسم «${seen.fileName}» — ولم يُكتب شيءٌ ثانيةً.`],
      recognisedColumns: [],
      unrecognisedColumns: [],
      newPosProducts: 0,
    };
  }

  const workbook = readWorkbookSafely(input.buffer);
  let parsed: ParsedSalesFile | null = null;
  let adapterName = "";

  for (const sheet of workbook.sheets) {
    const adapter = adapterFor(sheet.grid);
    if (!adapter) continue;
    adapterName = adapter.name;
    parsed = adapter.parse(sheet.grid, {
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
      totals: { rows: 0, parsed: 0, skipped: 0, errors: 0, duplicates: 0, salesWritten: 0, salesRestated: 0, lineCount: 0, unitsMilli: 0 },
      messages: [...workbook.warnings, blocked],
      recognisedColumns: parsed?.recognisedColumns ?? [],
      unrecognisedColumns: parsed?.unrecognisedColumns ?? [],
      newPosProducts: 0,
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
      بيعات_أُعيد_بيانها: written.totals.salesRestated,
      صفوف_مقروءة: written.totals.parsed,
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
    const products = new Map<string, { name: string; category: string | null; priceMinor: number | null }>();
    for (const sale of file.sales) {
      for (const line of sale.lines) {
        if (!products.has(line.productExternalId)) {
          products.set(line.productExternalId, {
            name: line.name,
            category: line.category,
            priceMinor: line.unitPriceMinor || null,
          });
        }
      }
    }

    let newPosProducts = 0;
    const externalIds = [...products.keys()];
    if (externalIds.length > 0) {
      const values = externalIds.map((externalId) => ({
        sourceId,
        externalId,
        name: products.get(externalId)!.name,
        category: products.get(externalId)!.category,
        priceMinor: products.get(externalId)!.priceMinor,
      }));
      for (let i = 0; i < values.length; i += 300) {
        const inserted = await tx
          .insert(posProducts)
          .values(values.slice(i, i + 300))
          /* القائمُ لا يُمَسّ: قد يكون مربوطاً بصنفٍ عندنا، والربطُ عملُ إنسانٍ لا يُداس */
          .onConflictDoNothing()
          .returning({ id: posProducts.id });
        newPosProducts += inserted.length;
      }
    }

    const posByExternal = new Map(
      (await tx
        .select({ id: posProducts.id, externalId: posProducts.externalId })
        .from(posProducts)
        .where(and(eq(posProducts.sourceId, sourceId), inArray(posProducts.externalId, externalIds.length > 0 ? externalIds : [""])))
      ).map((r) => [r.externalId, r.id] as const),
    );

    /* ── البيعات: المفتاحُ الطبيعيّ يقرّر أتُكتَب أم يُعاد بيانُها أم تُترَك ── */
    const wanted = file.sales.map((s) => s.externalId);
    const existing = new Map(
      wanted.length === 0 ? [] : (await tx
        .select({ id: sales.id, externalId: sales.externalId })
        .from(sales)
        .where(and(eq(sales.sourceId, sourceId), inArray(sales.externalId, wanted)))
      ).map((r) => [r.externalId, r.id] as const),
    );

    const saleIdByExternal = new Map<string, string>();
    const duplicateSales = new Set<string>();
    let salesWritten = 0;
    let salesRestated = 0;
    let lineCount = 0;
    let unitsMilli = 0;

    for (const sale of file.sales) {
      const prior = existing.get(sale.externalId);

      if (prior && file.shape !== "FOODICS_PRODUCT_MIX") {
        /*
          طلبٌ مقيَّدٌ من قبل. ولا يُعاد بيانُه: رقمُ الطلب عند فودكس
          هويّةٌ لعمليّةٍ وقعت مرّةً، فاختلافُ الملفّين عنها اختلافُ
          تصديرٍ لا اختلافُ واقع.
        */
        duplicateSales.add(sale.externalId);
        saleIdByExternal.set(sale.externalId, prior);
        continue;
      }

      let saleId: string;
      if (prior) {
        /*
          «مزيجُ الأصناف» تقريرٌ عن يومٍ لا عمليّةٌ بعينها. فملفٌّ
          أحدثُ عن اليوم نفسه **يُعيد بيانَه**: تُحذَف أسطرُه وتُكتب
          من جديد. والتقاريرُ المقفَلة لا تتأثّر — أرقامُها مجمَّدةٌ
          في أسطرها ولقطتُها تحفظ أصولَها.
        */
        await tx.delete(saleLines).where(eq(saleLines.saleId, prior));
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
            sourceId,
            branchId,
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
      unitsMilli += sale.lines.reduce((s, l) => s + (l.isVoid ? 0 : l.isRefund ? -l.quantityMilli : l.quantityMilli), 0);

      await writeLines(tx, saleId, sale, posByExternal);
    }

    /* ── وكلُّ صفٍّ يُحفَظ خاماً بحاله وسببه ── */
    const rowValues = file.rows.map((r) => {
      const isDuplicate = r.saleExternalId !== null && duplicateSales.has(r.saleExternalId);
      return {
        importId: imp.id,
        rowNumber: r.rowNumber,
        raw: r.raw as never,
        status: isDuplicate ? ("DUPLICATE" as const) : r.status,
        reason: isDuplicate ? "هذا الطلب مقيَّدٌ من قبل — لم يُكتب مرّتين" : r.reason,
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
    };

    const status: ImportResult["status"] =
      counts.parsed === 0 ? "FAILED" : counts.errors > 0 ? "PARTIAL" : "IMPORTED";

    if (counts.errors > 0) {
      messages.push(`${counts.errors} صفّاً لم يُقرأ — محفوظٌ بنصّه وسببه، ويُعرَض أدناه.`);
    }
    if (salesRestated > 0) {
      messages.push(`${salesRestated} يوماً كان مستورَداً من قبل، فأُعيد بيانُه من هذا الملفّ.`);
    }
    if (counts.duplicates > 0) {
      messages.push(`${counts.duplicates} صفّاً يخصّ طلباتٍ مقيَّدةً من قبل — لم تُكتب مرّتين.`);
    }

    await tx
      .update(salesImports)
      .set({
        status,
        importedRows: counts.parsed,
        skippedRows: counts.skipped,
        errorRows: counts.errors,
        duplicateRows: counts.duplicates,
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
        salesWritten, salesRestated, lineCount, unitsMilli,
      },
      messages,
      recognisedColumns: file.recognisedColumns,
      unrecognisedColumns: file.unrecognisedColumns,
      newPosProducts,
    };
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function writeLines(
  tx: Tx,
  saleId: string,
  sale: ParsedSale,
  posByExternal: ReadonlyMap<string, string>,
): Promise<void> {
  if (sale.lines.length === 0) return;
  const values = sale.lines.map((l) => ({
    saleId,
    posProductId: posByExternal.get(l.productExternalId) ?? null,
    externalId: l.externalId,
    description: l.name,
    quantity: milliToDecimal(l.quantityMilli),
    unitPriceMinor: l.unitPriceMinor,
    lineTotalMinor: l.lineTotalMinor,
    isRefund: l.isRefund,
    isVoid: l.isVoid,
    isComplimentary: l.isComplimentary,
    modifiers: (l.modifiers ?? null) as never,
  }));
  for (let i = 0; i < values.length; i += 500) {
    await tx.insert(saleLines).values(values.slice(i, i + 500)).onConflictDoNothing();
  }
}
