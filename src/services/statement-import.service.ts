/**
 * مزامنةُ كشف البنك ومطابقةُ مدفوعاته بالفواتير — بابُها `/api/bank-import`.
 *
 * نُقل من المسار كما هو (أكتوبر ٢٠٢٦): القراءة ← الحساب ← الهويّات ← فصلُ المعروف
 * عن الجديد ← تسويةُ الجديد وحده ← المعاينة أو الكتابة. والكتابةُ نفسها في
 * `bank-import.service.ts` (معاملةٌ واحدة ودفعات). والرفضُ أخطاءُ عملٍ برموز المسار
 * القديم يترجمها `respondTo`.
 */
import { deriveOpenMonths } from "./expense.service";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankRules, invoices, paymentAllocations, supplierAliases, suppliers } from "@/db/schema";
import { readStatementFile } from "./statement-file.service";
import {
  findDuplicatePayments, suggestAlias,
  type BankTx, type OpenInvoice,
} from "@/lib/bank/match";
import { fileFingerprint } from "@/lib/bank/identity";
import { resolveBankAccount } from "./bank-account.service";
import { planStatementSync, rowKey, writeStatementImport } from "./bank-import.service";
import { CATEGORY_LABEL, suggestCategory, type BankRule, type TxCategory } from "@/lib/bank/rules";
import { TRANSACTION, countNoun } from "@/lib/arabic";
import { applyAdjudication, runReconciliation } from "./reconcile.service";
import { adjudicate } from "./adjudicator.service";
import { selectedAdjudicator } from "@/lib/bank/adjudicator-provider";
import { loadMerchantMemory } from "./counterparty.service";
import { loadSupplierProfiles } from "./supplier-profile.service";
import { analyzeCoverage, describeCoverage } from "@/lib/bank/coverage";
import type { SupplierIdentity } from "@/lib/bank/entities";
import { linkExactHandPayments, reserveForHandPayments } from "./account-review.service";
import { isoDay, isoDayOrNull } from "@/lib/riyadh-time";
import { monthOf } from "@/lib/filing";
import { Refused, Unreadable } from "@/lib/domain-error";

export interface StatementFile {
  name: string;
  type: string;
  buffer: Buffer;
}

/** يقرأ الكشف ويعاين ما فيه، أو يكتبه إن `apply`. */
export async function runStatementImport(userId: string, file: StatementFile, apply: boolean) {
  const { buffer } = file;
  const fileSha256 = fileFingerprint(buffer);
  const parsed = await readStatementFile(buffer, file.name, file.type);

  /*
    الملفّ المصوَّر يُعلَن ولا يُخمَّن: إرجاع «صفر حركة» هنا يقول إنّ
    الكشف فارغ، وهو ليس كذلك.
  */
  if (parsed.blocked) {
    throw new Unreadable(parsed.blocked, { source: parsed.source });
  }

  if (parsed.rows.length === 0) {
    throw new Refused(parsed.warnings[0]?.reason ?? "لم تُقرأ أي حركة من الملف");
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
    id: rowKey(r, i),
    valueDate: r.valueDate, description: r.description,
    transactionType: r.transactionType, amountMinor: r.amountMinor, direction: r.direction,
    beneficiaryRaw: r.beneficiaryRaw,
  }));

  /*
    ══ المزامنة قبل التسوية ══

    السؤال الأوّل ليس «ماذا تعني هذه الحركة؟» بل **«أهي عندنا؟»**.
    وكان المسار يعكسهما: يحسب لثلاثمئة حركة مرشّحيها ودرجاتها ويستدعي
    الحَكَم، ثمّ يكتشف أنّ مئتين وتسعين منها مقيَّدة. عملٌ ضائع، وذاكرةٌ
    تُستدعى بلا سبب، وحسابٌ يُعاد على ما فُرغ منه.

    فصار الترتيب: اقرأ ← عرّف الحساب ← اعرف الهويّات ← افصل المعروف عن
    الجديد ← **سوِّ الجديد وحده**.
  */
  const bankAccountId = await resolveBankAccount({
    accountNumber: parsed.accountNumber,
    bankName: parsed.bank,
  });

  const syncPlan = await planStatementSync(db, parsed.rows, bankAccountId, { start: parsed.periodStart, end: parsed.periodEnd });
  const canonicalRows = syncPlan.rows;
  const { sync, missingFromFile, closedMonths, inClosedMonth } = syncPlan;
  const freshRows = syncPlan.fresh;

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
          start: isoDay(parsed.periodStart),
          end: isoDay(parsed.periodEnd),
          label: "هذا الملف",
        }]
      : [];

  const coverage = analyzeCoverage([...priorPeriods, ...thisPeriod]);

  let engine = runReconciliation({
    /* الجديد وحده — ولا يُعاد حسابُ ما قُيّد وفُرغ منه */
    rows: freshRows.map((f) => ({
      key: f.row.key,
      valueDate: f.row.raw.valueDate,
      description: f.row.raw.description,
      beneficiaryRaw: f.row.raw.beneficiaryRaw,
      transactionType: f.row.raw.transactionType,
      amountMinor: f.row.raw.amountMinor,
      direction: f.row.raw.direction,
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
    const canonicalByKey = new Map(canonicalRows.map((c) => [c.key, c.tx]));

    const invoiceLabels = new Map(
      open.map((o) => [
        o.invoiceId,
        {
          number: o.invoiceNumber,
          date: isoDay(o.invoiceDate),
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
    parsed.rows.map((r, i) => [rowKey(r, i), r.amountMinor]),
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
    periodStart: isoDayOrNull(parsed.periodStart) ?? undefined,
    periodEnd: isoDayOrNull(parsed.periodEnd) ?? undefined,
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
    return {
      ok: true, applied: false, summary,
      /*
        المعاينة تقول أوّلاً: ما الجديد؟ قبل أن تقول ما معناه. فمن رفع
        كشفاً كلّه مقيَّد لا يُعرَض عليه ثلاثمئة سطرٍ ليراجعها.
      */
      sync: {
        inFile: canonicalRows.length,
        alreadyKnown: sync.known.length,
        added: freshRows.length,
      closedMonthRows: inClosedMonth.length,
      closedMonths,
        ambiguous: sync.ambiguous.length,
        /*
          التضارب يُعدّ ويُعرَض وحده — لا يُجمَع مع الالتباس.
          الالتباس نقصُ دليل، والتضارب دليلٌ يكذّب دليلاً؛ وعلاجهما
          مختلف: الأوّل يُحسَم بنظرة، والثاني يُفحَص فيه الملفّ.
        */
        conflict: sync.conflict.length,
        /* عندنا وليست في الكشف — تُحفظ بعد التطبيق ليقرّر فيها إنسان */
        missingFromFile: missingFromFile.length,
        missingFromFileRows: missingFromFile.slice(0, 10).map((m) => ({
          date: isoDay(m.valueDate),
          amountMinor: m.amountMinor,
          direction: m.direction,
          description: (m.description ?? "").slice(0, 90),
        })),
        byReference: sync.known.filter((k) => k.verdict.basis === "REFERENCE").length,
        ambiguousRows: sync.ambiguous.slice(0, 10).map((a) => ({
          date: isoDay(a.row.raw.valueDate),
          amountMinor: a.row.raw.amountMinor,
          description: (a.row.raw.description ?? "").slice(0, 90),
          reason: a.verdict.reason,
        })),
        conflictRows: sync.conflict.slice(0, 10).map((c) => ({
          date: isoDay(c.row.raw.valueDate),
          amountMinor: c.row.raw.amountMinor,
          description: (c.row.raw.description ?? "").slice(0, 90),
          reason: c.verdict.reason,
        })),
      },
      /*
        المعاينة تعرض ما سيُكتَب فعلاً — لا ما وجده محرّك آخر. فما تراه
        قبل الموافقة هو ما يقع بعدها.
      */
      preview: engine.planned.slice(0, 40).map((p) => {
        const r = engineByKey.get(p.transactionKey)!;
        return {
          date: isoDay(p.paidAt),
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
          date: isoDay(tx.valueDate),
          amountMinor: tx.amountMinor,
          description: tx.description.slice(0, 140),
          suggestedAlias: suggestAlias(tx.beneficiaryRaw ?? tx.description),
          /* اسمُ المستفيد كما كتبه البنك — منه يُقترح اسمُ المورّد الجديد، لا من النصّ الموحَّد للمطابقة */
          beneficiary: tx.beneficiaryRaw?.trim() || null,
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
          date: isoDay(tx.valueDate),
          amountMinor: tx.amountMinor,
          supplierName:
            supplierIdentities.find((s) => s.supplierId === r.supplierId)?.nameAr ?? "—",
        })),
    };
  }

  /*
    خطّة الكتابة من المحرّك وحده: `planned` من `runReconciliation`. كان المُطابِق
    القديم يُنشئ الدفعات والمحرّكُ يكتب «أدلّةً» فوقها — فتُحفَظ حركةٌ بدرجة ٩١
    وحالتُها `UNMATCHED`. مصدرُ قرارٍ واحد.
  */
  const plannedByKey = new Map(engine.planned.map((p) => [p.transactionKey, p]));

  /*
    السدادُ المقيَّدُ بيدٍ يسبق المطابق: حوالةٌ بمبلغه لمورّده في نافذة الربط لا
    تُكتب دفعةً جديدة ولو وجد المطابقُ لها فاتورةً مفتوحة بالمبلغ نفسه — تُترك
    لـ`linkExactHandPayments` بعد الإدراج فتُربط بالسداد لا تُضاعفه.
  */
  const reservedForHand = await reserveForHandPayments(freshRows.flatMap((f) => {
    const decided = engineByKey.get(f.row.key);
    return plannedByKey.has(f.row.key) ? [{
      key: f.row.key,
      supplierId: decided?.supplierId ?? null,
      day: isoDay(f.row.raw.valueDate),
      amountMinor: f.row.raw.amountMinor,
      direction: f.row.raw.direction,
    }] : [];
  }));
  for (const key of reservedForHand.keys()) plannedByKey.delete(key);

  /*
    ── التطبيق: معاملةٌ واحدة ودفعات (`bank-import.service.ts`) ──

    كان نصفُ الكتابة خارج المعاملة وكلُّ حركةٍ إدراجاً وحدها؛ فسقوطٌ في المنتصف
    يترك استيراداً بلا حركاته. والآن كلُّه أو لا شيء.
  */
  /*
    وما يرفضه الكاتب (صفُّ الاستيراد لم يُكتب ٥٠٠، الشهرُ المقفل، قيودُ القاعدة) يُقال
    بجملته عند الباب (`respondTo`) — ولم يُكتب شيء.
  */
  const written = await db.transaction((t) => writeStatementImport(t, {
    userId,
    fileName: file.name,
    fileSha256,
    bank: parsed.bank,
    accountNumber: parsed.accountNumber ?? null,
    bankAccountId,
    rows: parsed.rows,
    plan: syncPlan,
    decisions: engineByKey,
    planned: plannedByKey,
    reservedForHand: new Set(reservedForHand.keys()),
    adjudications: adjudicationOutcomes,
    auditSummary: summary,
  }));
  const { importId, alreadyImported, newRows, created, rejectedByConstraint, held } = written;

  /*
    ── وما بعد الكتابة: يقرأ ما أُودع، ويتعثّر وحده ──

    الحوالةُ وسدادُها المقيَّد بيد: فاتورةٌ رُفعت وقيل «سُدّدت» فقُيِّدت دفعةٌ بلا
    حركة — فبعد الكتابة تُربط كلُّ حوالةٍ بدفعتها إن طابق المبلغُ والمورّدُ في
    نافذة أيّام (كلُّ ربطٍ في معاملته). ومصروفُ ما صُنّف من الجديد يُقيَّد وحده
    في أشهره المفتوحة. وتعثّرُ أحدهما يُقال في الملاحظات ولا يُلغي الاستيراد.
  */
  const linkNotes: string[] = [];
  const handLinked = newRows > 0 ? await linkExactHandPayments(userId, linkNotes) : 0;
  const derived = newRows > 0
    ? await deriveOpenMonths(freshRows.map((f) => monthOf(f.row.raw.valueDate)), userId)
    : { created: 0, notes: [] };
  linkNotes.push(...derived.notes);
  return {
    ok: true,
    applied: true,
    /*
      «مزامنة» لا «استيراد».

      صاحب العمل لا يريد أن يُدخِل ملفّاً؛ يريد أن يعرف ما الجديد فيه.
      فتُقال له الأعداد الأربعة: ما في الملفّ، وما هو عنده، وما دخل،
      وما التبس. وكان يُقال «أُضيفت ٣٢٧ حركة» عن ملفٍّ لم يُضِف واحدة.
    */
    summary: { ...summary, newRows, skippedRows: sync.known.length },
    sync: {
      inFile: canonicalRows.length,
      alreadyKnown: sync.known.length,
      added: newRows,
      ambiguous: sync.ambiguous.length,
      conflict: sync.conflict.length,
      missingFromFile: missingFromFile.length,
      conflictRows: sync.conflict.slice(0, 10).map((c) => ({
        date: isoDay(c.row.raw.valueDate),
        amountMinor: c.row.raw.amountMinor,
        description: (c.row.raw.description ?? "").slice(0, 90),
        reason: c.verdict.reason,
      })),
      enriched: sync.enrich.length,
      byReference: sync.known.filter((k) => k.verdict.basis === "REFERENCE").length,
    },
    created,
    alreadyImported,
    importId,
    rejectedByConstraint,
    message:
      newRows === 0
        ? `هذا الكشف مسجّل عندك من قبل: ${countNoun(canonicalRows.length, TRANSACTION)} كلها مسجّلة، فلم تُضَف حركة جديدة${missingFromFile.length > 0 ? `. وعندك ${countNoun(missingFromFile.length, TRANSACTION)} في فترته ليست فيه، تنتظر قرارك في صفحة البنك` : ""}.`
        : `تمت المزامنة: ${countNoun(canonicalRows.length, TRANSACTION)} في الملف · ${sync.known.length} موجودة · ${newRows} جديدة${
            sync.ambiguous.length > 0 ? ` · ${sync.ambiguous.length} للمراجعة` : ""
          }${
            sync.conflict.length > 0 ? ` · ${sync.conflict.length} تعارضت هويتها فلم تُسجَّل` : ""
          }${rejectedByConstraint > 0 ? ` · ${rejectedByConstraint} رفضتها قاعدة البيانات` : ""}${
            handLinked > 0 ? ` · ${handLinked} رُبطت بسداد سجّلته يدوياً` : ""
          }${derived.created > 0 ? ` · ${derived.created} سُجّلت مصروفاً` : ""}${
            held > 0 ? ` · ${held} محفوظة لتقرر فيها من صفحة البنك` : ""
          }.`,
    handLinked,
    linkNotes,
  };
}
