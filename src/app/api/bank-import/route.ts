/** استيراد كشف البنك ومطابقة مدفوعاته بالفواتير. */
import { NextResponse } from "next/server";
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  adjudications, bankImports, bankRules, bankTransactions, decisionHistory, invoices, paymentAllocations,
  supplierAliases, suppliers,
} from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { readStatementFile } from "@/services/statement-file.service";
import {
  findDuplicatePayments, suggestAlias,
  type BankTx, type OpenInvoice,
} from "@/lib/bank/match";
import {
  assignIdentities, countByNaturalKey, fileFingerprint, unseenRows,
} from "@/lib/bank/identity";
import { resolveBankAccount } from "@/services/bank-account.service";
import { allocate, createPayment } from "@/services/payment.service";
import { CATEGORY_LABEL, suggestCategory, type BankRule, type TxCategory } from "@/lib/bank/rules";
import { recordAudit } from "@/lib/audit";
import { applyAdjudication, runReconciliation } from "@/services/reconcile.service";
import { adjudicate } from "@/services/adjudicator.service";
import { selectedAdjudicator } from "@/lib/bank/adjudicator-provider";
import { toCanonical } from "@/lib/bank/canonical";
import { deriveLifecycle } from "@/lib/bank/lifecycle";
import { loadMerchantMemory } from "@/services/counterparty.service";
import { loadSupplierProfiles } from "@/services/supplier-profile.service";
import { analyzeCoverage, describeCoverage } from "@/lib/bank/coverage";
import type { SupplierIdentity } from "@/lib/bank/entities";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(request: Request) {  let user;
  try {
    user = await guard("bank-import", "bank:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const apply = form?.get("apply") === "true";

  if (!(file instanceof File)) return NextResponse.json({ error: "لم يصل ملف" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "الملف أكبر من ١٥ ميجابايت" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileSha256 = fileFingerprint(buffer);
  const parsed = await readStatementFile(buffer, file.name, file.type);

  /*
    الملفّ المصوَّر يُعلَن ولا يُخمَّن: إرجاع «صفر حركة» هنا يقول إنّ
    الكشف فارغ، وهو ليس كذلك.
  */
  if (parsed.blocked) {
    return NextResponse.json({ error: parsed.blocked, source: parsed.source }, { status: 422 });
  }

  if (parsed.rows.length === 0) {
    return NextResponse.json(
      { error: parsed.warnings[0]?.reason ?? "لم تُقرأ أي حركة من الملف" },
      { status: 400 },
    );
  }

  const identityRows = await db
    .select({
      id: suppliers.id, nameAr: suppliers.nameAr, slug: suppliers.slug,
      nameEn: suppliers.nameEn, driveFolderName: suppliers.driveFolderName,
      aliases: sql<string>`coalesce(string_agg(${supplierAliases.value}, '||'), '')`,
    })
    .from(suppliers)
    .leftJoin(supplierAliases, eq(supplierAliases.supplierId, suppliers.id))
    .where(eq(suppliers.isActive, true))
    .groupBy(suppliers.id);

  const supplierIdentities: SupplierIdentity[] = identityRows.map((r) => ({
    supplierId: r.id, nameAr: r.nameAr, slug: r.slug,
    nameEn: r.nameEn, driveFolderName: r.driveFolderName,
    aliases: r.aliases.split("||").filter(Boolean),
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
    beneficiaryRaw: r.beneficiaryRaw,
  }));

  /*
    محرّك التسوية الجديد.

    كان `matchBankTransactions` هو الحاكم: جشعٌ يحجز الفاتورة لأوّل
    حركة تطلبها، ومجموعاتٌ حتى ثلاث فواتير من بركةٍ من أربع عشرة،
    وتصنيفٌ بالكلمات المفتاحية.

    والجديد يقرأ بنية الوصف أوّلاً، ويعرّف المستفيد بأدلّة مصنَّفة،
    ويولّد المرشّحين كلّهم، ثمّ يوزّعها على الفترة كلّها لا حركةً حركة،
    ولا يحسم تلقائياً إلّا بشرطَي الدرجة والفارق.
  */
  /*
    ذاكرة المستفيدين تُقرأ قبل التصنيف.

    فمن أكّد مرّةً أنّ صاحب الهوية ٢١٤٩٨٣٠١١٥ هو نفسه، صُنّفت تحويلاته
    كلّها بعدها بلا سؤال — وهي في كشفه أكثر من ثلاثين حركة.
  */
  const memory = await loadMerchantMemory();
  /*
    ملامح السداد: كيف يُسدَّد كل مورّد عادةً. ترجّح بين متقاربَين ولا
    تُنشئ مطابقةً بلا دليل.
  */
  const profiles = await loadSupplierProfiles();

  /*
    تغطية الفترات.

    كان النظام يعرف أنّ الحركة مكرّرة، ولا يعرف أنّ بين آخر كشفٍ وهذا
    فجوةَ أسبوع لم تُستورَد — فتغيب حركاتها ولا يشكو أحد، لأنّ الغائب
    لا يُرى.
  */
  const priorPeriods = (
    await db.execute<{ start: string | null; end: string | null }>(sql`
      select to_char(min(value_date), 'YYYY-MM-DD') as start,
             to_char(max(value_date), 'YYYY-MM-DD') as end
      from bank_transactions
      group by bank_import_id
    `)
  ).rows
    .filter((r): r is { start: string; end: string } => r.start !== null && r.end !== null)
    .map((r) => ({ start: r.start, end: r.end }));

  const thisPeriod =
    parsed.periodStart && parsed.periodEnd
      ? [{
          start: parsed.periodStart.toISOString().slice(0, 10),
          end: parsed.periodEnd.toISOString().slice(0, 10),
          label: "هذا الملفّ",
        }]
      : [];

  const coverage = analyzeCoverage([...priorPeriods, ...thisPeriod]);

  let engine = runReconciliation({
    rows: parsed.rows.map((r, i) => ({
      key: `row-${r.rowNumber}-${i}`,
      valueDate: r.valueDate,
      description: r.description,
      beneficiaryRaw: r.beneficiaryRaw,
      transactionType: r.transactionType,
      amountMinor: r.amountMinor,
      direction: r.direction,
    })),
    invoices: open.map((o) => ({
      id: o.invoiceId,
      supplierId: o.supplierId,
      invoiceNumber: o.invoiceNumber,
      invoiceDate: o.invoiceDate,
      periodMonth: o.periodMonth,
      totalMinor: o.outstandingMinor,
      outstandingMinor: o.outstandingMinor,
    })),
    suppliers: supplierIdentities,
    memory,
    profiles,
    /* ما قُرئ بصرياً لا يُحسَم تلقائياً — الشرط في المحرّك لا هنا */
    readSource: parsed.source === "PDF_VISION" ? "VISION" : "PARSED",
  });
  /*
    الحَكَم — إن كان مهيَّأً.

    لا يُستدعى إلّا لما قرّر المخطِّط أنّه ملتبس، ولا يُطابِق حكمُه
    تلقائياً: يرفع الحالة إلى «اقتراح» ينتظر إقرارك.

    وإن لم يكن مهيَّأً مضى المسار حسابياً بحتاً — وهذا هو الأصل، لا
    حالةُ عطل.
  */
  const judge = selectedAdjudicator();
  const engineByKeyDraft = new Map(engine.results.map((r) => [r.key, r]));
  let adjudicationOutcomes: Awaited<ReturnType<typeof adjudicate>> = [];
  if (judge.isConfigured() && engine.adjudicationCases.length > 0) {
    const canonicalByKey = new Map(
      parsed.rows.map((r, i) => [
        `row-${r.rowNumber}-${i}`,
        toCanonical({
          valueDate: r.valueDate,
          description: r.description,
          beneficiaryRaw: r.beneficiaryRaw,
          transactionType: r.transactionType,
          amountMinor: r.amountMinor,
          direction: r.direction,
        }),
      ]),
    );

    const invoiceLabels = new Map(
      open.map((o) => [
        o.invoiceId,
        {
          number: o.invoiceNumber,
          date: o.invoiceDate.toISOString().slice(0, 10),
          outstandingMinor: o.outstandingMinor,
        },
      ]),
    );

    /*
      الوسيط يُحسب من الدفعة نفسها: «الكبير» نسبيّ لا ثابت — ألف ريال
      في مقهىً صغير كبيرة، وفي آخر عاديّة.
    */
    const amounts = parsed.rows.map((r) => r.amountMinor).sort((a, b) => a - b);
    const median = amounts.length > 0 ? amounts[Math.floor(amounts.length / 2)] : null;

    const outcomes = await adjudicate({
      cases: engine.adjudicationCases,
      transactions: canonicalByKey,
      invoiceLabels,
      kindOf: (id) => engineByKeyDraft.get(id)?.kind ?? "UNKNOWN",
      medianAmountMinor: median,
      provider: judge,
    });

    adjudicationOutcomes = outcomes;

    engine = applyAdjudication(
      engine,
      outcomes.map((o) => ({
        transactionId: o.transactionId,
        candidate: o.candidate,
        disposition: o.decision.disposition,
        reasons: o.decision.reasons,
      })),
    );
  }

  const engineByKey = new Map(engine.results.map((r) => [r.key, r]));
  const txByKey = new Map<string, (typeof txs)[number]>(txs.map((t) => [t.id, t]));
  const rowAmount = new Map<string, number>(
    parsed.rows.map((r, i) => [`row-${r.rowNumber}-${i}`, r.amountMinor]),
  );

  /*
    `matchBankTransactions` خرج من المسار.

    كان يعمل بجانب المحرّك الجديد: هذا يكتب المال وذاك يكتب «أدلّةً»
    فوقه — فتُحفَظ حركةٌ بدرجة ٩١ ونتيجةِ «فاتورة بعينها» وحالتُها
    `UNMATCHED`، لأنّ المحرّكين اختلفا. مصدرُ قرارٍ واحد أو لا شيء.

    وبقي `findDuplicatePayments` وحده: هو كشفٌ لا مطابقة.
  */
  const duplicates = findDuplicatePayments(txs, rules);

  const byCategory: Record<string, { count: number; amountMinor: number }> = {};
  for (const r of engine.results) {
    const c = r.category;
    byCategory[c] = byCategory[c] ?? { count: 0, amountMinor: 0 };
    byCategory[c].count++;
    byCategory[c].amountMinor += rowAmount.get(r.key) ?? 0;
  }

  const summary = {
    /*
      هل بلغ المحسِّن الحلّ الأمثل يقيناً؟

      كان يُحسَب ولا يُعرَض. وحين تنفد ميزانيّة العقد يرجع المحسِّن إلى
      الجشع فيُنتج توزيعاً **جيّداً لا أفضل**، وقد يكون فيه توزيعٌ أنسب
      لم يُبلَغ. وإخفاء ذلك يجعل الشاشة تقول عن حلٍّ تقريبيّ ما تقوله عن
      حلٍّ مثبت — وهو ادّعاء.

      والقرار نفسه يحتاط: التلقائيّ يصير اقتراحاً عند التقريب. لكنّ
      المستخدم يستحقّ أن يعرف **لماذا** كثُرت الاقتراحات فجأةً.
    */
    exact: engine.summary.exact,
    bank: parsed.bank,
    accountNumber: parsed.accountNumber,
    periodStart: parsed.periodStart?.toISOString().slice(0, 10),
    periodEnd: parsed.periodEnd?.toISOString().slice(0, 10),
    totalRows: parsed.rows.length,
    /*
      الأعداد من المحرّك — لا من المُطابِق القديم. كانت الشاشة تعرض
      عدداً والخادم يكتب غيره.
    */
    operational: engine.summary.notPayment,
    payments: engine.summary.total - engine.summary.notPayment,
    matchedTransactions: engine.summary.auto,
    matchedInvoices: new Set(engine.planned.flatMap((p) => p.allocations.map((a) => a.invoiceId))).size,
    suggested: engine.summary.suggest,
    needsReview: engine.summary.review,
    supplierOnly: engine.results.filter((r) => r.outcome === "KNOWN_SUPPLIER_NO_INVOICE").length,
    unknown: engine.results.filter((r) => r.outcome === "UNKNOWN_ENTITY").length,
    duplicateGroups: duplicates.length,
    openInvoicesBefore: open.length,
    warnings: parsed.warnings.length,
    source: parsed.source,
    /*
      حدود القراءة تُعرَض دائماً: محوِّلُ بنكٍ لم يُجرَّب، أو كشفٌ قُرئ
      بصرياً. وهذه ليست أخطاءً وقعت بل حدودٌ يجب أن تُعرَف قبل الوثوق.
    */
    notices: parsed.notices ?? [],
    coverage: {
      from: coverage.from,
      to: coverage.to,
      gaps: coverage.gaps,
      overlaps: coverage.overlaps.length,
      summary: describeCoverage(coverage),
    },
    classified: engine.results.filter(
      (r) => r.outcome === "NOT_A_PAYMENT" && r.kind !== "UNKNOWN",
    ).length,
    classifiedAmountMinor: engine.results
      .filter((r) => r.outcome === "NOT_A_PAYMENT" && r.kind !== "UNKNOWN")
      .reduce((sum, r) => sum + (rowAmount.get(r.key) ?? 0), 0),
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
      /*
        المعاينة تعرض ما سيُكتَب فعلاً — لا ما وجده محرّك آخر. فما تراه
        قبل الموافقة هو ما يقع بعدها.
      */
      preview: engine.planned.slice(0, 40).map((p) => {
        const r = engineByKey.get(p.transactionKey)!;
        return {
          date: p.paidAt.toISOString().slice(0, 10),
          amountMinor: p.amountMinor,
          supplierName: supplierIdentities.find((s) => s.supplierId === p.supplierId)?.nameAr ?? "—",
          invoiceNumbers: p.allocations.map((a) =>
            open.find((o) => o.invoiceId === a.invoiceId)?.invoiceNumber ?? null,
          ),
          kind: r.outcome,
          months: p.months,
          why: r.decision?.reasons ?? [],
        };
      }),
      /*
       * الحركات المجهولة كلّها لا أكبرها فقط.
       * هذه بالضبط ما يحتاج ربطاً يدوياً بمورّد، ومعها اقتراح للاسم البنكي
       * كي يبدأ المستخدم من نصّ يصحّحه لا من حقل فارغ.
       */
      unknown: engine.results
        .filter((r) => r.outcome === "UNKNOWN_ENTITY")
        .map((r) => ({ r, tx: txByKey.get(r.key)! }))
        .filter((x) => x.tx !== undefined)
        .sort((a, b) => b.tx.amountMinor - a.tx.amountMinor)
        .slice(0, 60)
        .map(({ r, tx }) => ({
          id: r.key,
          date: tx.valueDate.toISOString().slice(0, 10),
          amountMinor: tx.amountMinor,
          description: tx.description.slice(0, 140),
          suggestedAlias: suggestAlias(tx.beneficiaryRaw ?? tx.description),
          // اقتراح يُعرض لا حكم يُنفَّذ — الكلمة قد تخدع
          suggestedCategory: suggestCategory(`${tx.description} ${tx.transactionType}`),
          why: r.classificationReason,
        })),
      supplierOnlyList: engine.results
        .filter((r) => r.outcome === "KNOWN_SUPPLIER_NO_INVOICE")
        .map((r) => ({ r, tx: txByKey.get(r.key)! }))
        .filter((x) => x.tx !== undefined)
        .sort((a, b) => b.tx.amountMinor - a.tx.amountMinor)
        .slice(0, 20)
        .map(({ r, tx }) => ({
          date: tx.valueDate.toISOString().slice(0, 10),
          amountMinor: tx.amountMinor,
          supplierName:
            supplierIdentities.find((s) => s.supplierId === r.supplierId)?.nameAr ?? "—",
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
    txs.map((t) => ({
      valueDate: t.valueDate,
      amountMinor: t.amountMinor,
      direction: t.direction,
      description: t.description,
      tx: t,
    })),
  );

  /*
    الحساب يُعرَّف قبل الكتابة.

    كان رقم الحساب نصّاً في عمود، فلا تُنسَب الحركة إلى كيان. ومن غير
    ذلك لا يُقيَّد منعُ التكرار بحسابه: حوالتان متطابقتان من حسابين —
    وهذا يقع — تبتلع أولاهما الأخرى.
  */
  const bankAccountId = await resolveBankAccount({
    accountNumber: parsed.accountNumber,
    bankName: parsed.bank,
  });

  /*
    البحث عن السابق مقيَّد بالحساب نفسه. والمجهول نطاقٌ واحد: حركاته
    تُقارَن بحركات المجهول لا بحركات حسابٍ معروف.
  */
  /*
    كم من كلّ حركةٍ عند القاعدة الآن؟

    والسؤال بهذه الصيغة مقصود. الكشف يذكر الحركة بعدد ما وقعت — مرّةً
    أو مرّتين — فإن كان عندنا منها مثلُ ما يقول الكشف فلا جديد، وإن
    كان أقلّ دخل الفرق وحده. وبهذا يُرفَع الملف عشرين مرّة فلا تزيد
    حركةٌ واحدة، وتبقى الحركتان المتطابقتان الحقيقيّتان اثنتين.
  */
  const times = identified.map((r) => r.valueDate.getTime());
  const accountScope = bankAccountId === null
    ? isNull(bankTransactions.bankAccountId)
    : eq(bankTransactions.bankAccountId, bankAccountId);

  const priorRows = times.length === 0 ? [] : await db
    .select({
      valueDate: bankTransactions.valueDate,
      amountMinor: bankTransactions.amountMinor,
      direction: bankTransactions.direction,
      description: bankTransactions.description,
    })
    .from(bankTransactions)
    .where(and(
      gte(bankTransactions.valueDate, new Date(Math.min(...times))),
      lte(bankTransactions.valueDate, new Date(Math.max(...times))),
      accountScope,
    ));

  const priorCount = countByNaturalKey(
    priorRows.map((prior) => ({
      valueDate: prior.valueDate,
      amountMinor: prior.amountMinor,
      direction: prior.direction as "DEBIT" | "CREDIT",
      description: prior.description,
    })),
  );

  const [priorImport] = await db
    .select({ id: bankImports.id })
    .from(bankImports)
    .where(eq(bankImports.fileSha256, fileSha256))
    .limit(1);

  const alreadyImported = Boolean(priorImport);
  const fresh = unseenRows(identified, priorCount);
  const newRows = fresh.length;

  let importId = priorImport?.id ?? "";
  let created = 0;
  /** ما ردّه القيد بعد أن أجازه الفحص — يُعدّ ولا يُبتلَع. */
  let rejectedByConstraint = 0;

  if (newRows > 0 || !priorImport) {
    const [imp] = await db
      .insert(bankImports)
      .values({
        fileName: file.name,
        fileSha256,
        bank: parsed.bank,
        accountNumber: parsed.accountNumber ?? null,
        bankAccountId,
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

  /*
    خطّة الكتابة من المحرّك وحده.

    كان المُطابِق القديم هو من ينشئ الدفعات والتخصيصات، والمحرّك الجديد
    يكتب «أدلّةً» فوقها. فيمكن أن تُحفَظ حركةٌ بدرجة ٩١ ونتيجةِ «فاتورة
    بعينها»، وحالتُها `UNMATCHED` — لأنّ المحرّكين اختلفا. ومن يصدّق
    المستخدم حينئذ؟

    فصار مصدر القرار واحداً: `planned` من `runReconciliation`.
  */
  const plannedByKey = new Map(engine.planned.map((p) => [p.transactionKey, p]));

  await db.transaction(async (tx) => {
    for (const row of fresh) {
      const t = row.tx;
      const decided = engineByKey.get(t.id);
      const plan = plannedByKey.get(t.id);
      const [inserted] = await tx
        .insert(bankTransactions)
        .values({
          bankImportId: importId,
          bankAccountId,
          externalId: row.externalId,
          /* جزءٌ من المفتاح الطبيعيّ — لا حقلٌ وصفيّ */
          occurrence: row.occurrence,
          valueDate: t.valueDate,
          description: t.description,
          transactionType: t.transactionType || null,
          /*
            ما كتبه البنك في عمود المستفيد — لا اسم المورّد الذي
            رجّحناه. كان يُكتب هنا اسمُ المطابقة، فإن لم تُطابَق الحركة
            بقي العمود فارغاً؛ ودائرة مغلقة على نفسها: لا يُعرف المستفيد
            لأنّ العمود فارغ، والعمود فارغ لأنّه لم يُعرف.
          */
          beneficiaryRaw: t.beneficiaryRaw ?? null,
          amountMinor: t.amountMinor,
          direction: t.direction,
          /*
            كل هذه من المحرّك — بلا احتياطٍ إلى القديم. الاحتياط هنا
            يعني مصدرَي حقيقة، وهو ما يُنتج التناقض لا يُصلحه.
          */
          category: decided?.category ?? "UNKNOWN",
          /*
            سبب التصنيف يُحفَظ، لا يُحسَب ثمّ يُرمى. كان يُكتب
            `ruleId: null` صراحةً ولو صنّفت قاعدةٌ الحركة — فيضيع من
            صنّف ولماذا، ولا يُقاس بعدها أيّ القواعد أدقّ.
          */
          ruleId: decided?.classificationRuleId ?? null,
          classificationSource: decided?.classificationSource ?? "UNKNOWN",
          classificationReason: decided?.classificationReason ?? null,
          classificationVersion: decided?.classificationVersion ?? null,
          supplierId: decided?.supplierId ?? null,
          matchDisposition: decided?.decision?.disposition ?? null,
          matchScore: decided?.candidate ? Math.round(decided.candidate.score * 100) : null,
          matchOutcome: decided?.outcome ?? null,
          /*
            الأدلّة تُحفَظ بنصّها كي يُعرَض «لماذا؟» بعد شهر — لا رقمُ
            ثقةٍ ثابت لا يقول شيئاً.
          */
          matchEvidence: decided
            ? {
                تصنيف: decided.classificationReason,
                مستفيد: decided.supplierEvidence,
                مطابقة: decided.decision?.reasons ?? [],
                درجةالمستفيد: Math.round(decided.supplierScore * 100),
              }
            : null,
          /*
            الحالة تتبع القرار نفسه: ما يُكتَب له سدادٌ «مطابَقة»، وما
            ليس سداد مورّد «متجاهَلة»، وما عداهما ينتظر.
          */
          matchStatus:
            plan !== undefined ? "MATCHED"
            : decided && decided.outcome === "NOT_A_PAYMENT" ? "IGNORED"
            : "UNMATCHED",
          /*
            الطبقة تُشتقّ من الحقائق نفسها التي تُكتَب بجانبها — لا
            تُخمَّن ولا تُترَك `RAW` للكلّ. وهي تجيب سؤالاً لم يكن
            يُجاب: أين تقف هذه الحركة الآن؟
          */
          lifecycle: deriveLifecycle({
            classified: (decided?.category ?? "UNKNOWN") !== "UNKNOWN",
            hasCandidate: decided?.candidate != null,
            decided: decided?.decision?.disposition === "AUTO",
            posted: plan !== undefined,
            ignored: decided?.outcome === "NOT_A_PAYMENT",
          }),
        })
        .onConflictDoNothing()
        .returning({ id: bankTransactions.id });

      /*
        القيد الفريد ردّها: إمّا حركةٌ سبقتنا إليها كتابةٌ أخرى، وإمّا
        حركةٌ مقيَّدة من قبل فاتها الفحصُ أعلاه. والقيد آخر الحرّاس ولا
        يفلت منه شيء.
      */
      if (!inserted) { rejectedByConstraint++; continue; }

      await tx.insert(decisionHistory).values({
        bankTransactionId: inserted.id,
        event: "CLASSIFIED",
        actor: decided?.classificationSource === "MEMORY" ? "MEMORY" : "SYSTEM",
        actorId: user.id,
        detail: decided?.classificationReason ?? "بلا سبب مسجَّل",
        payload: {
          الباب: decided?.category,
          المصدر: decided?.classificationSource,
          النسخة: decided?.classificationVersion,
        },
      });

      /* أثرُ التحكيم، إن حُكِّمت */
      const verdict = adjudicationOutcomes.find((o) => o.transactionId === t.id);
      if (verdict) {
        await tx.insert(adjudications).values({
          bankTransactionId: inserted.id,
          kind: verdict.kind,
          provider: verdict.provenance.provider,
          model: verdict.provenance.model,
          promptVersion: verdict.provenance.promptVersion,
          schemaVersion: verdict.provenance.schemaVersion,
          durationMs: verdict.provenance.durationMs,
          modelConfidence: String(verdict.provenance.modelConfidence),
          modelReason: verdict.provenance.modelReason,
          claimedCodes: verdict.provenance.claimedCodes,
          upheldCodes: verdict.provenance.upheldCodes,
          refutedCodes: verdict.provenance.refutedCodes,
          chosenInvoiceIds: verdict.candidate?.invoiceIds ?? [],
          chosenCounterparty: verdict.entityChoice?.name ?? null,
          disposition: verdict.decision.disposition,
          signals: verdict.decision.signals,
          refused: verdict.refused,
        });

        await tx.insert(decisionHistory).values({
          bankTransactionId: inserted.id,
          event: "MATCH_SUGGESTED",
          actor: `AI:${verdict.provenance.provider}`,
          actorId: user.id,
          detail: verdict.provenance.modelReason || "بلا سبب",
          payload: {
            الثقة: verdict.provenance.modelConfidence,
            "أدلّة صحّت": verdict.provenance.upheldCodes,
            "أدلّة رُدّت": verdict.provenance.refutedCodes,
          },
        });
      }
      if (!plan) continue;

      const paymentId = await createPayment(tx, {
        supplierId: plan.supplierId,
        paidAt: plan.paidAt,
        amountMinor: plan.amountMinor,
        method: "BANK_TRANSFER",
        beneficiaryNameRaw: (t.beneficiaryRaw ?? t.description).slice(0, 200),
        /*
          الرسم يُحفَظ في حقله فيخرج من القسمة — ولا يُنسَب إلى المورّد
          مالٌ ذهب إلى البنك.
        */
        feeMinor: plan.feeMinor,
        /*
          الشهر الحاكم هو الأحدث بين شهور الفواتير لا شهر أوّلها: دفعةٌ
          تسدّد أغسطس وسبتمبر وأكتوبر كانت تُنسب إلى أغسطس كلّها.
        */
        appliesToMonth: plan.primaryMonth,
      });

      await tx
        .update(bankTransactions)
        .set({ matchedPaymentId: paymentId })
        .where(eq(bankTransactions.id, inserted.id));

      /*
       * التخصيص محدود بقيمة الدفعة: كانت فاتورة بـ١٥٠٠٫٠١ تُخصَّص كاملةً
       * على حوالة بـ١٥٠٠٫٠٠، فيخلق النظام هللةً لم تُدفع.
       */
      await allocate(tx, paymentId, plan.amountMinor, plan.allocations);
      created++;

      await tx.insert(decisionHistory).values({
        bankTransactionId: inserted.id,
        event: "POSTED",
        actor: "SYSTEM",
        actorId: user.id,
        detail: `طُوبقت مع ${plan.allocations.length} فاتورة`,
        payload: { الدفعة: paymentId, الشهور: plan.months },
      });
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
    rejectedByConstraint,
    message:
      newRows === 0
        ? `هذا الكشف مقيَّد عندك من قبل — قُرئت ${identified.length} حركة، وكلّها مسجَّلة، فلم تُضَف واحدة.`
        : `أُضيفت ${newRows} حركة جديدة${
            identified.length - newRows > 0
              ? ` · ${identified.length - newRows} كانت مسجَّلة من قبل فلم تتكرّر`
              : ""
          }${rejectedByConstraint > 0 ? ` · ${rejectedByConstraint} ردّها قيد القاعدة` : ""}.`,
  });
}
