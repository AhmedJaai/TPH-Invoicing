/**
 * إعادةُ حساب المطابقة على الحقائق كما هي الآن.
 *
 * موضعان يحتاجان الحسابَ نفسه: الإقرار (لا يُصدَّق اقتراحٌ حُسب لحظةَ
 * الاستيراد)، وعرضُ المرشّحين ليُختار بينهم. فهو هنا مرّةً — والقاعدةُ الواحدة تُستدعى ولا تُنسَخ.
 *
 * والخادم لا يأخذ من المتصفّح إلّا معرّفات: الفواتيرُ والمبالغُ والمورّدُ
 * تُقرأ من القاعدة، والمرشّحُ المختار يُتحقَّق أنّه ممّا حُسب هنا.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions, invoices, supplierAliases, suppliers } from "@/db/schema";
import { runReconciliation, type ReconcileResult } from "@/services/reconcile.service";

export { candidateKey, pickCandidate } from "@/services/reconcile.service";
import { loadMerchantMemory } from "@/services/counterparty.service";
import { loadSupplierProfiles } from "@/services/supplier-profile.service";
import type { SupplierIdentity } from "@/lib/bank/entities";
import type { OpenInvoice } from "@/lib/bank/candidates";

export type BankTxRow = typeof bankTransactions.$inferSelect;

export interface Recomputed {
  engine: ReconcileResult;
  /** الفواتير المفتوحة الآن — بمعرّفها. */
  invoiceById: ReadonlyMap<string, OpenInvoice>;
}

/** كم مرشّحاً يُعرَض ليُختار بينهم — وما بعدها ضجيج. */
export const MAX_SHOWN_CANDIDATES = 3;

/**
 * الفواتيرُ التي بقي عليها شيء — تُصفّى في القاعدة لا بعد جلبها.
 *
 * كان كلُّ تأكيدٍ (ولو لحركةٍ واحدة) يقرأ جميع الفواتير مضمومةً إلى
 * تخصيصاتها ثمّ يرمي المسدَّد. و`totalMinor` هنا **الإجماليّ** لا المتبقّي:
 * كان يُكتب فيه المتبقّي فتُحسَب نسبةُ القسط من رقمٍ خاطئ.
 */
export async function loadOpenInvoices(supplierIds?: readonly string[]): Promise<OpenInvoice[]> {
  if (supplierIds && supplierIds.length === 0) return [];
  const allocated = sql<number>`coalesce((select sum(pa.amount_minor)::bigint
    from payment_allocations pa where pa.invoice_id = ${invoices}.id), 0)`;
  const rows = await db
    .select({
      id: invoices.id, supplierId: invoices.supplierId,
      invoiceNumber: invoices.invoiceNumber, invoiceDate: invoices.invoiceDate,
      periodMonth: invoices.periodMonth, totalMinor: invoices.totalMinor,
      allocated,
    })
    .from(invoices)
    .where(and(
      sql`${invoices.totalMinor} > ${allocated}`,
      supplierIds ? inArray(invoices.supplierId, [...supplierIds]) : undefined,
    ));

  return rows.map((r) => ({
    id: r.id, supplierId: r.supplierId, invoiceNumber: r.invoiceNumber,
    invoiceDate: r.invoiceDate, periodMonth: r.periodMonth,
    totalMinor: r.totalMinor,
    outstandingMinor: r.totalMinor - Number(r.allocated),
  }));
}

async function loadSupplierIdentities(): Promise<SupplierIdentity[]> {
  const rows = await db
    .select({
      id: suppliers.id, nameAr: suppliers.nameAr, slug: suppliers.slug,
      nameEn: suppliers.nameEn, driveFolderName: suppliers.driveFolderName,
      aliases: sql<string>`coalesce(string_agg(${supplierAliases.value}, '||'), '')`,
    })
    .from(suppliers)
    .leftJoin(supplierAliases, eq(supplierAliases.supplierId, suppliers.id))
    .where(eq(suppliers.isActive, true))
    .groupBy(suppliers.id);

  return rows.map((r) => ({
    supplierId: r.id, nameAr: r.nameAr, slug: r.slug,
    nameEn: r.nameEn, driveFolderName: r.driveFolderName,
    aliases: r.aliases.split("||").filter(Boolean),
  }));
}

/**
 * يُعيد الحساب على الحركات المختارة **مجتمعةً**.
 *
 * ولو حُسبت كلٌّ وحدها لجاز أن تطلب حركتان الفاتورةَ نفسها فتُخصَّص
 * مرّتين — وهو ما يفعله المطابق الجشع بالضبط. والمحسِّن يوزّعها فلا تُحجَز
 * فاتورةٌ لاثنتين.
 */
export async function recomputeMatches(
  rows: readonly BankTxRow[],
  options: { supplierIds?: readonly string[] } = {},
): Promise<Recomputed> {
  const [identities, open, memory, profiles] = await Promise.all([
    loadSupplierIdentities(),
    loadOpenInvoices(options.supplierIds),
    loadMerchantMemory(),
    /*
      ملامح السداد: كيف يُسدَّد كل مورّد عادةً. ترجّح بين متقاربَين ولا
      تُنشئ مطابقةً بلا دليل.
    */
    loadSupplierProfiles(),
  ]);

  const engine = runReconciliation({
    rows: rows.map((tx) => ({
      key: tx.id,
      valueDate: tx.valueDate,
      description: tx.description ?? "",
      beneficiaryRaw: tx.beneficiaryRaw,
      transactionType: tx.transactionType,
      amountMinor: tx.amountMinor,
      direction: tx.direction,
    })),
    invoices: open,
    suppliers: identities,
    memory,
    profiles,
  });

  return { engine, invoiceById: new Map(open.map((i) => [i.id, i])) };
}
