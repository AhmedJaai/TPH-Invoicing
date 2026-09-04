/** استيراد كشف البنك ومطابقة مدفوعاته بالفواتير. */
import { NextResponse } from "next/server";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bankImports, bankRules, bankTransactions, invoices, paymentAllocations,
  supplierAliases, suppliers,
} from "@/db/schema";
import { requireUser, UnauthenticatedError } from "@/lib/session";
import { ForbiddenError } from "@/lib/permissions";
import { parseBankStatement } from "@/lib/bank/parse";
import {
  matchBankTransactions, findDuplicatePayments, suggestAlias,
  type BankTx, type OpenInvoice, type SupplierAliasIndex,
} from "@/lib/bank/match";
import { normalizeName } from "@/lib/suppliers-seed";
import { assignIdentities, fileFingerprint } from "@/lib/bank/identity";
import { allocate, createPayment } from "@/services/payment.service";
import { CATEGORY_LABEL, suggestCategory, type BankRule, type TxCategory } from "@/lib/bank/rules";
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
  const fileSha256 = fileFingerprint(buffer);
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

  const ruleRows = await db
    .select({
      id: bankRules.id, normalized: bankRules.normalized,
      category: bankRules.category, supplierId: bankRules.supplierId,
    })
    .from(bankRules);
  const rules: BankRule[] = ruleRows;

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

  const matches = matchBankTransactions(txs, open, index, rules);
  const duplicates = findDuplicatePayments(txs, rules);
  // المصنَّف بقاعدة ليس مجهولاً ولا سداد مورّد — يخرج من العدّ كالتشغيلي
  const real = matches.filter((m) => m.kind !== "INTERNAL" && m.kind !== "CLASSIFIED");
  const classified = matches.filter((m) => m.kind === "CLASSIFIED");

  const byCategory: Record<string, { count: number; amountMinor: number }> = {};
  for (const m of matches) {
    const c = m.category;
    byCategory[c] = byCategory[c] ?? { count: 0, amountMinor: 0 };
    byCategory[c].count++;
    byCategory[c].amountMinor += m.tx.amountMinor;
  }
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
    classified: classified.length,
    classifiedAmountMinor: classified.reduce((s, m) => s + m.tx.amountMinor, 0),
    byCategory: Object.entries(byCategory)
      .map(([category, v]) => ({
        category,
        label: CATEGORY_LABEL[category as TxCategory] ?? category,
        ...v,
      }))
      .sort((a, b) => b.amountMinor - a.amountMinor),
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
      /*
       * الحركات المجهولة كلّها لا أكبرها فقط.
       * هذه بالضبط ما يحتاج ربطاً يدوياً بمورّد، ومعها اقتراح للاسم البنكي
       * كي يبدأ المستخدم من نصّ يصحّحه لا من حقل فارغ.
       */
      unknown: real
        .filter((m) => m.kind === "NONE")
        .sort((a, b) => b.tx.amountMinor - a.tx.amountMinor)
        .slice(0, 60)
        .map((m) => ({
          id: m.tx.id,
          date: m.tx.valueDate.toISOString().slice(0, 10),
          amountMinor: m.tx.amountMinor,
          description: m.tx.description.slice(0, 140),
          suggestedAlias: suggestAlias(m.tx.description),
          // اقتراح يُعرض لا حكم يُنفَّذ — الكلمة قد تخدع
          suggestedCategory: suggestCategory(`${m.tx.description} ${m.tx.transactionType}`),
        })),
      supplierOnlyList: real
        .filter((m) => m.kind === "SUPPLIER_ONLY")
        .sort((a, b) => b.tx.amountMinor - a.tx.amountMinor)
        .slice(0, 20)
        .map((m) => ({
          date: m.tx.valueDate.toISOString().slice(0, 10),
          amountMinor: m.tx.amountMinor,
          supplierName: m.supplierName ?? "—",
        })),
    });
  }

  /*
   * ── التطبيق ──
   *
   * الاستيراد منيع من التكرار على ثلاث طبقات:
   *   ١. بصمة الملف: الملف نفسه يُعرف قبل قراءة صفوفه.
   *   ٢. هوية كل حركة: بصمة من محتواها وترتيب تكرارها في الملف.
   *   ٣. قيد فريد في القاعدة: الفحص في الكود يفلت من طلبين متزامنين، والقيد لا يفلت.
   *
   * وبدون ذلك استُورد كشف واحد ثلاث مرّات فصارت كل حركة ثلاثاً.
   */
  const identified = assignIdentities(
    matches.map((m) => ({
      valueDate: m.tx.valueDate,
      amountMinor: m.tx.amountMinor,
      direction: m.tx.direction,
      description: m.tx.description,
      match: m,
    })),
    parsed.accountNumber,
  );

  const existingIds = new Set(
    (
      await db
        .select({ externalId: bankTransactions.externalId })
        .from(bankTransactions)
        .where(inArray(bankTransactions.externalId, identified.map((r) => r.externalId)))
    ).map((r) => r.externalId!),
  );

  const [priorImport] = await db
    .select({ id: bankImports.id })
    .from(bankImports)
    .where(eq(bankImports.fileSha256, fileSha256))
    .limit(1);

  const alreadyImported = Boolean(priorImport);
  const fresh = identified.filter((r) => !existingIds.has(r.externalId));
  const newRows = fresh.length;

  let importId = priorImport?.id ?? "";
  let created = 0;

  if (newRows > 0 || !priorImport) {
    const [imp] = await db
      .insert(bankImports)
      .values({
        fileName: file.name,
        fileSha256,
        bank: parsed.bank,
        accountNumber: parsed.accountNumber ?? null,
        rowCount: parsed.rows.length,
        newRowCount: newRows,
        importedById: user.id,
      })
      .onConflictDoNothing()
      .returning({ id: bankImports.id });
    importId = imp?.id ?? priorImport?.id ?? "";
  }

  if (!importId) {
    return NextResponse.json({ error: "تعذّر تسجيل عملية الاستيراد" }, { status: 500 });
  }

  await db.transaction(async (tx) => {
    for (const row of fresh) {
      const m = row.match;
      const [inserted] = await tx
        .insert(bankTransactions)
        .values({
          bankImportId: importId,
          externalId: row.externalId,
          valueDate: m.tx.valueDate,
          description: m.tx.description,
          beneficiaryRaw: m.supplierName ?? null,
          amountMinor: m.tx.amountMinor,
          direction: m.tx.direction,
          category: m.category,
          ruleId: m.ruleId ?? null,
          matchStatus:
            m.invoices.length > 0 ? "MATCHED"
            : m.kind === "INTERNAL" || m.kind === "CLASSIFIED" ? "IGNORED"
            : "UNMATCHED",
        })
        .onConflictDoNothing()
        .returning({ id: bankTransactions.id });

      // القيد الفريد ردّها: حركة سبقتنا إليها كتابة أخرى
      if (!inserted) continue;
      if (m.invoices.length === 0) continue;

      const paymentId = await createPayment(tx, {
        supplierId: m.supplierId ?? null,
        paidAt: m.tx.valueDate,
        amountMinor: m.tx.amountMinor,
        method: "BANK_TRANSFER",
        beneficiaryNameRaw: m.tx.description.slice(0, 200),
        appliesToMonth: m.invoices[0].periodMonth,
      });

      await tx
        .update(bankTransactions)
        .set({ matchedPaymentId: paymentId })
        .where(eq(bankTransactions.id, inserted.id));

      /*
       * التخصيص محدود بقيمة الدفعة: كانت فاتورة بـ١٥٠٠٫٠١ تُخصَّص كاملةً
       * على حوالة بـ١٥٠٠٫٠٠، فيخلق النظام هللةً لم تُدفع.
       */
      await allocate(
        tx,
        paymentId,
        m.tx.amountMinor,
        m.invoices.map((i) => ({ invoiceId: i.invoiceId, amountMinor: i.outstandingMinor })),
      );
      created++;
    }
  });

  await recordAudit({
    actorId: user.id,
    action: "BANK_IMPORTED",
    entityType: "bank_import",
    entityId: importId,
    after: {
      ...summary,
      حركات_جديدة: newRows,
      حركات_موجودة_تُخطّيت: identified.length - newRows,
      مدفوعات_أُنشئت: created,
      الملف_مستورد_مسبقاً: alreadyImported,
    },
  });

  return NextResponse.json({
    ok: true,
    applied: true,
    summary: { ...summary, newRows, skippedRows: identified.length - newRows },
    created,
    alreadyImported,
    importId,
    message:
      newRows === 0
        ? "هذا الكشف مستورد مسبقاً — لم تُضَف حركة واحدة، ولم يتكرّر شيء."
        : `أُضيفت ${newRows} حركة جديدة${
            identified.length - newRows > 0 ? ` وتُخطّيت ${identified.length - newRows} موجودة` : ""
          }.`,
  });
}
