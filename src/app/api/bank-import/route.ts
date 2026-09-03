/** استيراد كشف البنك ومطابقة مدفوعاته بالفواتير. */
import { NextResponse } from "next/server";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bankImports, bankTransactions, invoices, paymentAllocations, payments,
  supplierAliases, suppliers,
} from "@/db/schema";
import { requireUser, UnauthenticatedError } from "@/lib/session";
import { ForbiddenError } from "@/lib/permissions";
import { parseBankStatement } from "@/lib/bank/parse";
import {
  matchBankTransactions, findDuplicatePayments,
  type BankTx, type OpenInvoice, type SupplierAliasIndex,
} from "@/lib/bank/match";
import { normalizeName } from "@/lib/suppliers-seed";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser("bank:view");
  } catch (e) {
    if (e instanceof UnauthenticatedError) return NextResponse.json({ error: e.message }, { status: 401 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const apply = form?.get("apply") === "true";

  if (!(file instanceof File)) return NextResponse.json({ error: "لم يصل ملف" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "الملف أكبر من ١٥ ميجابايت" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = parseBankStatement(buffer);

  if (parsed.rows.length === 0) {
    return NextResponse.json(
      { error: parsed.warnings[0]?.reason ?? "لم تُقرأ أي حركة من الملف" },
      { status: 400 },
    );
  }

  // فهرس أسماء المورّدين وأسمائهم البنكية
  const sup = await db
    .select({
      id: suppliers.id, nameAr: suppliers.nameAr, nameEn: suppliers.nameEn,
      folder: suppliers.driveFolderName,
    })
    .from(suppliers)
    .where(eq(suppliers.isActive, true));

  const aliasRows = sup.length
    ? await db
        .select({ supplierId: supplierAliases.supplierId, value: supplierAliases.value })
        .from(supplierAliases)
        .where(inArray(supplierAliases.supplierId, sup.map((s) => s.id)))
    : [];

  const index: SupplierAliasIndex[] = sup.map((s) => ({
    supplierId: s.id,
    supplierName: s.nameAr,
    normalizedNames: [
      ...new Set(
        [s.nameAr, s.nameEn ?? "", s.folder, ...aliasRows.filter((a) => a.supplierId === s.id).map((a) => a.value)]
          .filter(Boolean)
          .map(normalizeName),
      ),
    ],
  }));

  const invRows = await db
    .select({
      invoiceId: invoices.id, supplierId: invoices.supplierId, supplierName: suppliers.nameAr,
      invoiceNumber: invoices.invoiceNumber, invoiceDate: invoices.invoiceDate,
      periodMonth: invoices.periodMonth, totalMinor: invoices.totalMinor,
      allocated: sql<number>`coalesce(sum(${paymentAllocations.amountMinor}),0)::int`,
    })
    .from(invoices)
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .leftJoin(paymentAllocations, eq(paymentAllocations.invoiceId, invoices.id))
    .groupBy(invoices.id, suppliers.nameAr);

  const open: OpenInvoice[] = invRows
    .map((r) => ({
      invoiceId: r.invoiceId, supplierId: r.supplierId, supplierName: r.supplierName ?? "—",
      invoiceNumber: r.invoiceNumber, invoiceDate: r.invoiceDate, periodMonth: r.periodMonth,
      outstandingMinor: r.totalMinor - Number(r.allocated),
    }))
    .filter((i) => i.outstandingMinor > 0);

  const txs: BankTx[] = parsed.rows.map((r, i) => ({
    id: `row-${r.rowNumber}-${i}`,
    valueDate: r.valueDate, description: r.description,
    transactionType: r.transactionType, amountMinor: r.amountMinor, direction: r.direction,
  }));

  const matches = matchBankTransactions(txs, open, index);
  const duplicates = findDuplicatePayments(txs);
  const real = matches.filter((m) => m.kind !== "INTERNAL");
  const matched = real.filter((m) => m.invoices.length > 0);

  const summary = {
    bank: parsed.bank,
    accountNumber: parsed.accountNumber,
    periodStart: parsed.periodStart?.toISOString().slice(0, 10),
    periodEnd: parsed.periodEnd?.toISOString().slice(0, 10),
    totalRows: parsed.rows.length,
    operational: matches.length - real.length,
    payments: real.length,
    matchedTransactions: matched.length,
    matchedInvoices: new Set(matched.flatMap((m) => m.invoices.map((i) => i.invoiceId))).size,
    supplierOnly: real.filter((m) => m.kind === "SUPPLIER_ONLY").length,
    unknown: real.filter((m) => m.kind === "NONE").length,
    duplicateGroups: duplicates.length,
    openInvoicesBefore: open.length,
    warnings: parsed.warnings.length,
  };

  if (!apply) {
    return NextResponse.json({
      ok: true, applied: false, summary,
      preview: matched.slice(0, 40).map((m) => ({
        date: m.tx.valueDate.toISOString().slice(0, 10),
        amountMinor: m.tx.amountMinor,
        supplierName: m.supplierName,
        invoiceNumbers: m.invoices.map((i) => i.invoiceNumber),
        kind: m.kind,
      })),
      unknownTop: real
        .filter((m) => m.kind === "NONE")
        .sort((a, b) => b.tx.amountMinor - a.tx.amountMinor)
        .slice(0, 15)
        .map((m) => ({
          date: m.tx.valueDate.toISOString().slice(0, 10),
          amountMinor: m.tx.amountMinor,
          description: m.tx.description.slice(0, 90),
        })),
    });
  }

  // ── التطبيق ──
  const [imp] = await db
    .insert(bankImports)
    .values({
      fileName: file.name, bank: parsed.bank,
      rowCount: parsed.rows.length, importedById: user.id,
    })
    .returning({ id: bankImports.id });

  let created = 0;

  await db.transaction(async (tx) => {
    for (const m of matches) {
      const [row] = await tx
        .insert(bankTransactions)
        .values({
          bankImportId: imp.id,
          valueDate: m.tx.valueDate,
          description: m.tx.description,
          beneficiaryRaw: m.supplierName ?? null,
          amountMinor: m.tx.amountMinor,
          direction: m.tx.direction,
          matchStatus: m.invoices.length > 0 ? "MATCHED" : m.kind === "INTERNAL" ? "IGNORED" : "UNMATCHED",
        })
        .returning({ id: bankTransactions.id });

      if (m.invoices.length === 0) continue;

      const [pay] = await tx
        .insert(payments)
        .values({
          supplierId: m.supplierId ?? null,
          paidAt: m.tx.valueDate,
          amountMinor: m.tx.amountMinor,
          method: "BANK_TRANSFER",
          beneficiaryNameRaw: m.tx.description.slice(0, 200),
          appliesToMonth: m.invoices[0].periodMonth,
        })
        .returning({ id: payments.id });

      await tx.update(bankTransactions).set({ matchedPaymentId: pay.id }).where(eq(bankTransactions.id, row.id));

      for (const inv of m.invoices) {
        await tx
          .insert(paymentAllocations)
          .values({ paymentId: pay.id, invoiceId: inv.invoiceId, amountMinor: inv.outstandingMinor })
          .onConflictDoNothing();
      }
      created++;
    }
  });

  await recordAudit({
    actorId: user.id,
    action: "DOCUMENT_ARCHIVED",
    entityType: "bank_import",
    entityId: imp.id,
    after: { ...summary, مدفوعات_أُنشئت: created },
  });

  return NextResponse.json({ ok: true, applied: true, summary, created, importId: imp.id });
}
