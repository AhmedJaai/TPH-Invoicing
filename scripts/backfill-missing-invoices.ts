/**
 * فاتورةٌ ناقصة لمستندٍ قُرئ — تُستدرَك من استخراجه المحفوظ.
 *
 *   npm run db:backfill-invoices            ← معاينة، لا تكتب شيئاً
 *   npm run db:backfill-invoices -- --apply ← تكتب
 *
 * ── لماذا وُجد هذا الملفّ ──
 *
 * كان `parseRiyals` يردّ «1,151.15 SR» و«437.000» — رمزُ عملةٍ ومنزلةٌ
 * ثالثة. فيُقرأ المستند كاملاً، ويُسجَّل، ثمّ يُردّ مبلغُه فلا تُنشَأ
 * له فاتورة. **فيبقى في الأرشيف بلا رقمٍ ولا اسمٍ ولا ظهورٍ في البحث،
 * ولا يشكو.**
 *
 * وأُصلح التحويل، لكنّ الإصلاح لا يبلغ ما سُجّل قبله: المزامنة لا تعيد
 * قراءة ملفٍّ مسجَّل، فتقول «٠ ملفّات جديدة» وتبقى الفجوة. وهذا هو
 * الدرس المكتوب في CLAUDE.md: **من يبني طبقةً جديدة يُعيد تشغيلها على
 * البيانات القائمة، وإلّا فهي دعوى.**
 *
 * ── وما لا يفعله ──
 *
 * لا يقرأ مستنداً من جديد ولا ينادي نموذجاً: يقرأ `extraction_json`
 * المحفوظ وحده. فما لم يُقرأ يبقى غير مقروء، ولا يُخترَع له شيء.
 *
 * ولا يمسّ فاتورةً قائمة: يُنشئ الناقص فقط، و`onConflictDoNothing`
 * تحرس ذلك مرّةً أخرى في القاعدة.
 */
import { db } from "@/db";
import { documents, invoices, suppliers } from "@/db/schema";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { parseRiyals } from "@/lib/money";
import { reviewConfirmed } from "@/lib/confirm";
import { extractionSchema } from "@/lib/extraction/schema";
import { companyConfig } from "@/config/drive";

const APPLY = process.argv.includes("--apply");

/** الأنواع التي لها فاتورة — وعرضُ السعر والإيصال ليسا منها. */
const INVOICE_KINDS = new Set(["TAX_INVOICE", "SIMPLIFIED_INVOICE", "UTILITY"]);

async function main() {
  const rows = await db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      kind: documents.kind,
      periodMonth: documents.periodMonth,
      extraction: documents.extractionJson,
      supplierId: documents.supplierId,
      issuesInvoices: suppliers.issuesInvoices,
      contractOnFile: suppliers.contractOnFile,
    })
    .from(documents)
    .leftJoin(suppliers, eq(suppliers.id, documents.supplierId))
    .where(
      and(
        ne(documents.status, "REJECTED"),
        sql`not exists (select 1 from invoices i where i.document_id = ${documents}.id)`,
        sql`${documents.extractionJson} is not null`,
        sql`${documents.supplierId} is not null`,
      ),
    );

  console.log(`مستندات بلا فاتورة ولها استخراج محفوظ: ${rows.length}\n`);

  let ready = 0;
  let skipped = 0;

  for (const r of rows) {
    if (!r.kind || !INVOICE_KINDS.has(r.kind)) {
      console.log(`  — ${String(r.fileName).slice(0, 46).padEnd(48)} نوعه ${r.kind} — لا فاتورة له`);
      skipped++;
      continue;
    }

    const parsed = extractionSchema.safeParse(r.extraction);
    const x = parsed.success ? parsed.data : null;
    if (!x) {
      console.log(`  ✗ ${String(r.fileName).slice(0, 46).padEnd(48)} استخراجٌ لا يوافق المخطّط`);
      skipped++;
      continue;
    }

    const totalMinor = parseRiyals(x.totalAmount);
    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(x.invoiceDate);
    const number = x.invoiceNumber.trim();

    if (totalMinor === null || !dateOk || !number) {
      console.log(
        `  ✗ ${String(r.fileName).slice(0, 46).padEnd(48)} ` +
          `مبلغ=${JSON.stringify(x.totalAmount)} تاريخ=${JSON.stringify(x.invoiceDate)} رقم=${JSON.stringify(number)}`,
      );
      skipped++;
      continue;
    }

    const review = reviewConfirmed(
      {
        documentKind: x.documentKind,
        supplierId: r.supplierId ?? undefined,
        invoiceNumber: x.invoiceNumber,
        invoiceDate: x.invoiceDate,
        subtotalMinor: parseRiyals(x.subtotalAmount),
        vatMinor: parseRiyals(x.vatAmount),
        totalMinor,
        sellerVat: x.sellerVatNumber,
        buyerVat: x.buyerVatNumber,
      },
      {
        companyVat: companyConfig.vatNumber,
        supplierIssuesInvoices: r.issuesInvoices ?? undefined,
        supplierContractOnFile: r.contractOnFile ?? undefined,
      },
    );

    if (!review.canCreateInvoice) {
      console.log(`  ✗ ${String(r.fileName).slice(0, 46).padEnd(48)} المراجعة تمنع الإنشاء`);
      skipped++;
      continue;
    }

    console.log(
      `  ✓ ${String(r.fileName).slice(0, 46).padEnd(48)} ` +
        `${number} · ${x.invoiceDate} · ${(totalMinor / 100).toFixed(2)}`,
    );
    ready++;

    if (APPLY) {
      await db
        .insert(invoices)
        .values({
          documentId: r.id,
          supplierId: r.supplierId!,
          invoiceNumber: number,
          invoiceDate: new Date(`${x.invoiceDate}T00:00:00Z`),
          periodMonth: r.periodMonth || x.invoiceDate.slice(0, 7),
          /* الفراغ يبقى فراغاً — المجهول لا يصير صفراً */
          subtotalMinor: parseRiyals(x.subtotalAmount),
          vatMinor: parseRiyals(x.vatAmount),
          totalMinor,
          sellerVat: x.sellerVatNumber || null,
          buyerVat: x.buyerVatNumber || null,
          taxStatus: review.taxStatus,
          inputVatStatus: review.inputVatStatus,
          isFixedAsset: review.isFixedAsset,
        })
        .onConflictDoNothing();
    }
  }

  console.log(
    `\n${APPLY ? "أُنشئت" : "ستُنشأ"} ${ready} فاتورة · تُرك ${skipped}` +
      (APPLY ? "" : "\nللتنفيذ: npm run db:backfill-invoices -- --apply"),
  );
}

main().then(() => process.exit(0));
