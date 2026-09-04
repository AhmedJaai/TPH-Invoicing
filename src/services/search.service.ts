/**
 * البحث عبر الكيانات.
 *
 * كل استعلام يقتصر على ما تقول الخطّة إنّه محتمل، ويحدّ نتائجه — فالبحث
 * الذي يجلب كل شيء يكلّف كثيراً ولا يُقرأ.
 *
 * وكل نتيجة تحمل **وجهة تفتح السجلّ نفسه** لا صفحةً عامّة يبحث فيها
 * المستخدم من جديد.
 */
import { and, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bankTransactions, documents, invoices, products, supplierProducts, suppliers,
} from "@/db/schema";
import {
  amountRange, parseSearch, rankHits,
  type SearchHit, type SearchIntent,
} from "@/lib/search";

/** أقصى ما يُرجَع من كل نوع — الشاشة لا تسع أكثر، والقاعدة لا تُتعب. */
export const PER_KIND = 6;

export interface SearchResult {
  intent: SearchIntent | null;
  hits: SearchHit[];
}

export async function search(raw: string): Promise<SearchResult> {
  const intent = parseSearch(raw);
  if (!intent) return { intent: null, hits: [] };

  const like = `%${intent.term}%`;
  const jobs: Promise<SearchHit[]>[] = [];

  if (intent.targets.includes("invoices")) jobs.push(findInvoices(intent, like));
  if (intent.targets.includes("suppliers")) jobs.push(findSuppliers(intent, like));
  if (intent.targets.includes("products")) jobs.push(findProducts(like));
  if (intent.targets.includes("bankTransactions")) jobs.push(findBankTx(intent, like));
  if (intent.targets.includes("documents")) jobs.push(findDocuments(intent, like));

  const hits = (await Promise.all(jobs)).flat();
  return { intent, hits: rankHits(hits, intent.kind) };
}

async function findInvoices(intent: SearchIntent, like: string): Promise<SearchHit[]> {
  const clauses = [];

  if (intent.kind === "NUMBER") clauses.push(ilike(invoices.invoiceNumber, like));
  if (intent.kind === "TEXT") clauses.push(ilike(suppliers.nameAr, like));
  if (intent.kind === "MONTH") clauses.push(eq(invoices.periodMonth, intent.term));
  if (intent.kind === "DATE") {
    clauses.push(sql`to_char(${invoices.invoiceDate}, 'YYYY-MM-DD') = ${intent.term}`);
  }
  if (intent.amountMinor !== undefined) {
    const { min, max } = amountRange(intent.amountMinor);
    clauses.push(and(gte(invoices.totalMinor, min), lte(invoices.totalMinor, max)));
  }
  if (clauses.length === 0) return [];

  const rows = await db
    .select({
      id: invoices.id,
      number: invoices.invoiceNumber,
      date: invoices.invoiceDate,
      month: invoices.periodMonth,
      total: invoices.totalMinor,
      taxStatus: invoices.taxStatus,
      supplier: suppliers.nameAr,
      supplierSlug: suppliers.slug,
    })
    .from(invoices)
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .where(or(...clauses))
    .limit(PER_KIND);

  return rows.map((r) => ({
    kind: "invoice" as const,
    id: r.id,
    title: `فاتورة ${r.number ?? "بلا رقم"}`,
    subtitle: `${r.supplier ?? "بلا مورّد"} · ${r.date.toISOString().slice(0, 10)}${
      r.taxStatus === "INVALID" ? " · ضريبتها ناقصة" : ""
    }`,
    amountMinor: r.total,
    href: r.supplierSlug ? `/suppliers/${r.supplierSlug}` : `/purchases?month=${r.month}`,
  }));
}

async function findSuppliers(intent: SearchIntent, like: string): Promise<SearchHit[]> {
  const clauses = [];
  if (intent.kind === "VAT") clauses.push(eq(suppliers.vatNumber, intent.term));
  if (intent.kind === "TEXT") {
    clauses.push(ilike(suppliers.nameAr, like));
    clauses.push(ilike(suppliers.slug, like));
    clauses.push(ilike(suppliers.driveFolderName, like));
  }
  if (clauses.length === 0) return [];

  const rows = await db
    .select({
      id: suppliers.id,
      nameAr: suppliers.nameAr,
      slug: suppliers.slug,
      vatNumber: suppliers.vatNumber,
      isActive: suppliers.isActive,
    })
    .from(suppliers)
    .where(or(...clauses))
    .limit(PER_KIND);

  return rows.map((r) => ({
    kind: "supplier" as const,
    id: r.id,
    title: r.nameAr,
    subtitle: `${r.slug}${r.vatNumber ? "" : " · بلا رقم ضريبي"}${r.isActive ? "" : " · معطَّل"}`,
    href: `/suppliers/${r.slug}`,
  }));
}

async function findProducts(like: string): Promise<SearchHit[]> {
  const rows = await db
    .select({
      id: supplierProducts.id,
      name: supplierProducts.displayName,
      supplier: suppliers.nameAr,
      canonical: products.nameAr,
    })
    .from(supplierProducts)
    .leftJoin(suppliers, eq(supplierProducts.supplierId, suppliers.id))
    .leftJoin(products, eq(supplierProducts.productId, products.id))
    .where(or(
      ilike(supplierProducts.displayName, like),
      ilike(supplierProducts.normalizedDescription, like),
    ))
    .limit(PER_KIND);

  return rows.map((r) => ({
    kind: "product" as const,
    id: r.id,
    title: r.name,
    subtitle: `${r.supplier ?? "بلا مورّد"}${r.canonical ? ` · ${r.canonical}` : " · غير مربوط"}`,
    href: "/purchases/products",
  }));
}

async function findBankTx(intent: SearchIntent, like: string): Promise<SearchHit[]> {
  const clauses = [];
  if (intent.kind === "TEXT" || intent.kind === "NUMBER") {
    clauses.push(ilike(bankTransactions.description, like));
    clauses.push(ilike(bankTransactions.beneficiaryRaw, like));
    clauses.push(ilike(bankTransactions.ref, like));
  }
  if (intent.kind === "DATE") {
    clauses.push(sql`to_char(${bankTransactions.valueDate}, 'YYYY-MM-DD') = ${intent.term}`);
  }
  if (intent.kind === "MONTH") {
    clauses.push(sql`to_char(${bankTransactions.valueDate}, 'YYYY-MM') = ${intent.term}`);
  }
  if (intent.amountMinor !== undefined) {
    const { min, max } = amountRange(intent.amountMinor);
    clauses.push(and(gte(bankTransactions.amountMinor, min), lte(bankTransactions.amountMinor, max)));
  }
  if (clauses.length === 0) return [];

  const rows = await db
    .select({
      id: bankTransactions.id,
      description: bankTransactions.description,
      beneficiary: bankTransactions.beneficiaryRaw,
      amount: bankTransactions.amountMinor,
      date: bankTransactions.valueDate,
      category: bankTransactions.category,
      direction: bankTransactions.direction,
    })
    .from(bankTransactions)
    .where(or(...clauses))
    .limit(PER_KIND);

  return rows.map((r) => ({
    kind: "bankTransaction" as const,
    id: r.id,
    title: (r.beneficiary ?? r.description ?? "حركة بنكية").slice(0, 60),
    subtitle: `${r.date.toISOString().slice(0, 10)} · ${
      r.direction === "DEBIT" ? "صادر" : "وارد"
    }${r.category === "UNKNOWN" ? " · غير مصنَّفة" : ""}`,
    amountMinor: r.amount,
    href: "/bank",
  }));
}

async function findDocuments(intent: SearchIntent, like: string): Promise<SearchHit[]> {
  const clauses = [];
  if (intent.kind === "TEXT" || intent.kind === "NUMBER") {
    clauses.push(ilike(documents.fileName, like));
  }
  if (intent.kind === "MONTH") clauses.push(eq(documents.periodMonth, intent.term));
  if (clauses.length === 0) return [];

  const rows = await db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      status: documents.status,
      month: documents.periodMonth,
    })
    .from(documents)
    .where(or(...clauses))
    .limit(PER_KIND);

  return rows.map((r) => ({
    kind: "document" as const,
    id: r.id,
    title: r.fileName,
    subtitle: `${r.month ?? "بلا شهر"} · ${r.status}`,
    href: `/documents?q=${encodeURIComponent(r.fileName)}`,
  }));
}
