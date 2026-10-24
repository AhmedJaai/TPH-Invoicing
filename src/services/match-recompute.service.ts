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
import { candidateKey, runReconciliation, type ReconcileResult } from "@/services/reconcile.service";
import { Conflict, NotFound } from "@/lib/domain-error";
import type { Conn } from "./types";

export { pickCandidate } from "@/services/reconcile.service";
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
const MAX_SHOWN_CANDIDATES = 3;

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

/**
 * مرشّحو حركةٍ واحدة — ليُختار بينهم (`/api/match-candidates`).
 *
 * «مرشّحان متقاربان» كانت تُعرَض بسببها وحده: لا الفاتورتان جنباً إلى جنب
 * ولا وسيلةَ لاختيار إحداهما. والمرشّحون لا يُحفَظون مع الحركة عمداً —
 * ما حُسب لحظةَ الاستيراد قد سُدّدت فاتورتُه بعده — فيُحسَبون هنا **الآن**
 * على الفواتير كما هي، وهي القائمةُ نفسها التي يتحقّق منها الإقرار.
 *
 * قراءةٌ لا تكتب شيئاً.
 */
export async function matchCandidates(transactionId: string, conn: Conn = db) {
  const [tx] = await conn
    .select()
    .from(bankTransactions)
    .where(eq(bankTransactions.id, transactionId));
  if (!tx) throw new NotFound("هذه الحركة غير موجودة");
  if (tx.matchedPaymentId) throw new Conflict("سُجّل لهذه الحركة سداد من قبل");

  const { engine, invoiceById } = await recomputeMatches([tx]);
  const result = engine.results.find((r) => r.key === tx.id);
  const settled = result?.candidate ? candidateKey(result.candidate.invoiceIds) : null;
  const top = (engine.candidatesByKey.get(tx.id) ?? []).slice(0, MAX_SHOWN_CANDIDATES);

  return {
    ok: true as const,
    transactionId: tx.id,
    amountMinor: tx.amountMinor,
    supplierId: result?.supplierId ?? null,
    candidates: top.map((c) => ({
      key: candidateKey(c.invoiceIds),
      invoiceIds: c.invoiceIds,
      /* ما رسا عليه المحرّك — يُعلَّم ولا يُفرَض */
      recommended: candidateKey(c.invoiceIds) === settled,
      outcome: c.outcome,
      score: Math.round(c.score * 100),
      /* الأبعادُ الأربعة من مئة — المرجعُ `null` حين لا يُقاس، لا صفراً */
      parts: {
        supplier: Math.round(c.parts.supplier * 100),
        amount: Math.round(c.parts.amount * 100),
        date: Math.round(c.parts.date * 100),
        reference: c.parts.reference > 0 ? Math.round(c.parts.reference * 100) : null,
      },
      allocatedMinor: c.allocatedMinor,
      evidence: c.evidence,
      invoices: c.invoiceIds.map((id) => {
        const inv = invoiceById.get(id);
        return {
          id,
          number: inv?.invoiceNumber ?? null,
          date: inv ? inv.invoiceDate.toISOString() : null,
          totalMinor: inv?.totalMinor ?? null,
          outstandingMinor: inv?.outstandingMinor ?? null,
        };
      }),
    })),
  };
}
