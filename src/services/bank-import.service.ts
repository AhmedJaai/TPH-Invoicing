/**
 * كتابةُ كشف البنك — المزامنةُ ثمّ الكتابةُ في معاملةٍ واحدة، دفعاتٍ لا صفّاً صفّاً.
 *
 * كان المسار يكتب كلَّ حركةٍ بإدراجٍ وحدها، ويُثري مرجعَ كلّ معروفةٍ بتحديثٍ وحده،
 * ونصفُ الكتابة خارج المعاملة (التبنّي والإثراء وصفُّ الاستيراد والأرصدة
 * والتدقيق والمحفوظ). فكشفٌ بخمسمئة حركة ألفُ رحلةٍ إلى القاعدة تحت مهلة
 * المسار، وسقوطُه في المنتصف يترك استيراداً بلا حركاته أو حركاتٍ بلا أثرها.
 *
 * والآن: الهويّةُ من `src/lib/bank/sync.ts` وحده — لا خوارزميّة ثانية — والصفوفُ
 * المكتوبة هي هي (المصدر · السبب · النسخة · الطبقة · `decision_history`)، كلُّها
 * بمقبض المعاملة `t`، والإدراجُ دفعات. وما بقي صفّاً صفّاً هو السدادُ وحده:
 * `recordBankPayment` يسأل عن توأم الدفعة، والتوأمُ يُعرف بحركةٍ رُبطت قبله.
 */
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  adjudications, bankImports, bankTransactions, decisionHistory, reconciliationPeriods,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { INVOICE, countNoun } from "@/lib/arabic";
import { toCanonical, STATED_VALUE_DATE_LIMIT_DAYS, type CanonicalTransaction } from "@/lib/bank/canonical";
import { operationRef, operationRefs } from "@/lib/bank/identity";
import { deriveLifecycle } from "@/lib/bank/lifecycle";
import type { BankRow } from "@/lib/bank/parse";
import { monthBalancesFromStatement } from "@/lib/bank/statement-balances";
import {
  beneficiaryKey, factKey, looseKey, storedMissingFromFile, syncRows, type KnownRow, type SyncResult,
} from "@/lib/bank/sync";
import { createId } from "@/lib/id";
import { MS_PER_DAY, currentMonthRiyadh } from "@/lib/riyadh-time";
import type { AdjudicationOutcome } from "./adjudicator.service";
import { holdRows, type HeldRowInput } from "./bank-held.service";
import { closedMonthsAmong } from "./month-guard";
import { allocate, recordBankPayment } from "./payment.service";
import type { PlannedPayment, TransactionResult } from "./reconcile.service";
import type { Conn, Tx } from "./types";

/** صفُّ الملفّ بمفتاحه داخل الملفّ وصورتِه الموحَّدة. */
export interface StatementRow {
  key: string;
  raw: BankRow;
  tx: CanonicalTransaction;
}

/** ما بيننا وبين الملفّ قبل أن يُكتب شيء. */
export interface StatementSync {
  rows: StatementRow[];
  priorRows: PriorRow[];
  sync: SyncResult<StatementRow>;
  /** عندنا في مدّة الكشف وليس فيه. */
  missingFromFile: PriorRow[];
  /** الجديدُ في شهرٍ مقفل — لا يُقيَّد، ويُعدّ ويُقال. */
  closedMonths: string[];
  inClosedMonth: SyncResult<StatementRow>["fresh"];
  /** الجديدُ الذي يُكتب. */
  fresh: SyncResult<StatementRow>["fresh"];
}

interface PriorRow {
  id: string;
  valueDate: Date;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  description: string | null;
  transactionType: string | null;
  beneficiaryRaw: string | null;
  bankAccountId: string | null;
  operationRef: string | null;
}

/** مفتاحُ الصفّ داخل الملفّ — به يلتقي الصفُّ بقرار المحرّك. */
export const rowKey = (r: BankRow, i: number) => `row-${r.rowNumber}-${i}`;

/** شهرُ الحركة كما يسأل عنه مؤثِّرُ القاعدة: بتوقيت الرياض. */
const monthOfRow = (f: { row: StatementRow }) => currentMonthRiyadh(f.row.raw.valueDate);

/**
 * السؤالُ الأوّل «أهي عندنا؟» — قراءةٌ لا كتابة.
 *
 * ما يُقابَل: حركاتُ الفترة نفسها بالفهرس — بلا قيدِ حساب («المجهول» ليس حساباً
 * آخر) — موسَّعةً أسبوعاً من كلّ طرف، حدَّ `statedValueDate` نفسه: حركةٌ خُزّنت
 * بتاريخ عمودها ويقول نصُّها غيره كانت تقع خارجها فتُدرَج ثانية.
 */
export async function planStatementSync(
  conn: Conn,
  rows: readonly BankRow[],
  bankAccountId: string | null,
  period: { start?: Date | null; end?: Date | null },
): Promise<StatementSync> {
  const keyed: StatementRow[] = rows.map((r, i) => ({
    key: rowKey(r, i),
    raw: r,
    tx: toCanonical({
      valueDate: r.valueDate, description: r.description, beneficiaryRaw: r.beneficiaryRaw,
      transactionType: r.transactionType, amountMinor: r.amountMinor, direction: r.direction,
    }),
  }));

  const times = rows.map((r) => r.valueDate.getTime());
  const priorRows: PriorRow[] = times.length === 0 ? [] : (await conn
    .select({
      id: bankTransactions.id,
      valueDate: bankTransactions.valueDate,
      amountMinor: bankTransactions.amountMinor,
      direction: bankTransactions.direction,
      description: bankTransactions.description,
      transactionType: bankTransactions.transactionType,
      beneficiaryRaw: bankTransactions.beneficiaryRaw,
      bankAccountId: bankTransactions.bankAccountId,
      operationRef: bankTransactions.operationRef,
    })
    .from(bankTransactions)
    .where(and(
      gte(bankTransactions.valueDate, new Date(Math.min(...times) - STATED_VALUE_DATE_LIMIT_DAYS * MS_PER_DAY)),
      lte(bankTransactions.valueDate, new Date(Math.max(...times) + STATED_VALUE_DATE_LIMIT_DAYS * MS_PER_DAY)),
)));

  const knownRows: KnownRow[] = priorRows.map((r) => {
    const tx = toCanonical({
      valueDate: r.valueDate, description: r.description,
      beneficiaryRaw: r.beneficiaryRaw, transactionType: r.transactionType,
      amountMinor: r.amountMinor, direction: r.direction,
    });
    return {
      id: r.id,
      accountId: r.bankAccountId,
      refs: operationRefs(tx),
      operationRef: r.operationRef ?? operationRef(tx),
      factKey: factKey(tx),
      looseKey: looseKey(tx),
      amountMinor: r.amountMinor,
      direction: r.direction,
      beneficiary: beneficiaryKey(tx),
    };
  });

  const sync = syncRows(keyed.map((c) => ({ row: c, tx: c.tx })), knownRows, bankAccountId);
  const missingFromFile = storedMissingFromFile(priorRows, sync, { start: period.start, end: period.end }, bankAccountId);

  /*
    ── الشهر المقفل لا يُكتب فيه من أيّ باب ──

    أُقفل أغسطس ثمّ دخلت حركتان بتاريخه، فانكسرت معادلة الشهر المقفل بصمت.
    فالجديدُ في شهرٍ مقفل لا يُقيَّد ويُعدّ ويُقال، والمعروفُ من قبل لا يمسّه
    هذا. وخلفه مؤثِّرُ `bank_transactions_month_lock` في القاعدة.
  */
  const closed = await closedMonthsAmong(conn, sync.fresh.map(monthOfRow));
  return {
    rows: keyed,
    priorRows,
    sync,
    missingFromFile,
    closedMonths: [...closed].sort(),
    inClosedMonth: sync.fresh.filter((f) => closed.has(monthOfRow(f))),
    fresh: sync.fresh.filter((f) => !closed.has(monthOfRow(f))),
  };
}

export interface StatementWriteInput {
  userId: string;
  fileName: string;
  fileSha256: string;
  bank: string;
  accountNumber: string | null;
  bankAccountId: string | null;
  /** صفوفُ الملفّ كلُّها — لعددها ولأرصدة أشهرها. */
  rows: readonly BankRow[];
  plan: StatementSync;
  /** قرارُ المحرّك لكلّ صفّ، بمفتاحه. */
  decisions: ReadonlyMap<string, TransactionResult>;
  /** ما يُكتب له سدادٌ — بعد إخراج المحجوز لسدادٍ قيّده صاحبُه بيد. */
  planned: ReadonlyMap<string, PlannedPayment>;
  reservedForHand: ReadonlySet<string>;
  adjudications: readonly AdjudicationOutcome[];
  /** ملخّصُ المعاينة نفسه — يُحفظ في التدقيق. */
  auditSummary: Record<string, unknown>;
}

export interface StatementWriteResult {
  importId: string;
  alreadyImported: boolean;
  /** ما أجازه الفحص — قبل أن يردّ القيدُ شيئاً. */
  newRows: number;
  /** ما ردّه القيد بعد أن أجازه الفحص — يُعدّ ولا يُبتلَع. */
  rejectedByConstraint: number;
  /** الدفعاتُ التي كُتبت. */
  created: number;
  /** صفوفٌ حُفظت لقرار إنسان. */
  held: number;
}

/** صفُّ الاستيراد لم يُكتب — طلبٌ آخر بالملفّ نفسه سبق. */
export class ImportNotRecordedError extends Error {
  constructor() {
    super("تعذّر تسجيل الاستيراد. حاول مرة أخرى.");
    this.name = "ImportNotRecordedError";
  }
}

/* الإدراجُ دفعات: نحو ثلاثين عموداً للحركة، والحدُّ ٦٥٬٥٣٥ معاملاً في بروتوكول pg */
const CHUNK = 400;

function chunks<T>(list: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * يكتب الكشف — كلَّه أو لا شيء منه، بالمقبض `t`.
 *
 * الاستيراد منيع من التكرار على ثلاث طبقات:
 *   ١. بصمة الملف: الملف نفسه يُعرف قبل قراءة صفوفه — اختصارٌ سريع لا هويّة.
 *   ٢. هويّة كل حركة (`sync.ts`): مرجعُ العمليّة أوّلاً، فالوقائع.
 *   ٣. قيدٌ فريد في القاعدة على الهويّة المخزَّنة: الفحص في الشيفرة يفلت من
 *      طلبين متزامنين، والقيد لا يفلت (`onConflictDoNothing` فيُعدّ ما ردّه).
 */
export async function writeStatementImport(t: Tx, w: StatementWriteInput): Promise<StatementWriteResult> {
  const { plan, decisions, planned, reservedForHand } = w;
  const { sync, fresh } = plan;

  const [priorImport] = await t
    .select({ id: bankImports.id })
    .from(bankImports)
    .where(eq(bankImports.fileSha256, w.fileSha256))
    .limit(1);

  /*
    ── التبنّي ──

    ما عُرف الآن أنّه من هذا الحساب يُكتَب له الحساب، فينتقل من نطاق «المجهول»
    إلى نطاقه ويحرسه القيدُ في القاعدة بعد اليوم. ولا يُتبنّى إلّا ما طابق
    مفتاحاً في هذا الكشف — والباقي يبقى مجهولاً لأنّه لم يُثبَت.
  */
  if (w.bankAccountId !== null) {
    const unscoped = new Set(plan.priorRows.filter((p) => p.bankAccountId === null).map((p) => p.id));
    const adopt = sync.known.map((k) => k.verdict.matchedId).filter((id) => unscoped.has(id));
    for (const part of chunks(adopt)) {
      await t.update(bankTransactions).set({ bankAccountId: w.bankAccountId }).where(inArray(bankTransactions.id, part));
    }
  }

  /*
    ── ما تعلّمناه عن القديم يُكتَب عليه ──

    كشفٌ أحدث قد يحمل مرجعَ عمليّةٍ لم يكن في الأوّل — خبرٌ عن الحركة نفسها لا
    حركةٌ ثانية. كان تحديثاً لكلّ حركة؛ صار تحديثاً واحداً لكلّ دفعة (`VALUES`).
    والمعرّفُ المكرَّر يأخذ آخرَ مرجع، كما كان آخرُ تحديثٍ يغلب.
  */
  const enrich = [...new Map(sync.enrich.map((e) => [e.id, e.operationRef])).entries()];
  for (const part of chunks(enrich)) {
    await t.execute(sql`
      update ${bankTransactions} set operation_ref = v.ref
        from (values ${sql.join(part.map(([id, ref]) => sql`(${id}::text, ${ref}::text)`), sql`, `)}) as v(id, ref)
       where ${bankTransactions}.id = v.id
    `);
  }

  const newRows = fresh.length;
  let importId = priorImport?.id ?? "";
  if (newRows > 0 || !priorImport) {
    const [imp] = await t
      .insert(bankImports)
      .values({
        fileName: w.fileName,
        fileSha256: w.fileSha256,
        bank: w.bank,
        accountNumber: w.accountNumber,
        bankAccountId: w.bankAccountId,
        rowCount: w.rows.length,
        newRowCount: newRows,
        importedById: w.userId,
      })
      .onConflictDoNothing()
      .returning({ id: bankImports.id });
    importId = imp?.id ?? priorImport?.id ?? "";
  }
  if (!importId) throw new ImportNotRecordedError();

  /* ── الحركات: دفعاتٌ بمعرّفاتٍ تُولَّد هنا، فيُعرف أيُّها كتبه القيد ── */
  const rowsToInsert = fresh.map((row) => {
    const tx = row.row.tx;
    const key = row.row.key;
    const decided = decisions.get(key);
    const plannedHere = planned.get(key);
    const reserved = reservedForHand.has(key);
    return {
      key,
      row,
      values: {
        id: createId(),
        bankImportId: importId,
        bankAccountId: w.bankAccountId,
        /*
          العمودان يحملان الهويّة نفسها — لا خوارزميّتين. كان `external_id` يحمل
          مفتاح الصفّ داخل الملفّ («row-5-4») فتُرَدّ صفوفُ ملفٍّ ثانٍ صامتةً.
        */
        externalId: row.verdict.identityKey,
        identityKey: row.verdict.identityKey,
        operationRef: row.verdict.operationRef,
        occurrence: row.verdict.occurrence,
        valueDate: tx.valueDate,
        description: tx.description,
        transactionType: tx.transactionType || null,
        /* ما كتبه البنك في عمود المستفيد — لا اسم المورّد الذي رجّحناه */
        beneficiaryRaw: tx.beneficiaryRaw ?? null,
        amountMinor: tx.amountMinor,
        direction: tx.direction,
        /* كلّ هذه من المحرّك — بلا احتياطٍ إلى القديم: مصدرُ حقيقةٍ واحد */
        category: decided?.category ?? "UNKNOWN",
        /* سببُ التصنيف يُحفَظ ومن صنّف — كي يُقاس أيّ القواعد أدقّ */
        ruleId: decided?.classificationRuleId ?? null,
        classificationSource: decided?.classificationSource ?? "UNKNOWN",
        classificationReason: decided?.classificationReason ?? null,
        classificationVersion: decided?.classificationVersion ?? null,
        supplierId: decided?.supplierId ?? null,
        /*
          المحجوزُ لسدادٍ قيّده صاحبُه بيد ليس «محسوماً» قبل أن يُربط: إن لم يُربط
          بقي في الطابور للمراجعة — لا «قُرِّر ولم يُقيَّد».
        */
        matchDisposition: reserved ? "REVIEW" as const : decided?.decision?.disposition ?? null,
        matchScore: decided?.candidate ? Math.round(decided.candidate.score * 100) : null,
        matchOutcome: decided?.outcome ?? null,
        /* الأدلّة بنصّها كي يُعرَض «لماذا؟» بعد شهر */
        matchEvidence: decided
          ? {
              تصنيف: decided.classificationReason,
              مستفيد: decided.supplierEvidence,
              مطابقة: decided.decision?.reasons ?? [],
              درجةالمستفيد: Math.round(decided.supplierScore * 100),
              ...(reserved
                ? { سدادمقيّدبيد: "بالمبلغ نفسه للمورّد نفسه، فتُربط به ولا تُسجَّل دفعة ثانية" }
                : {}),
            }
          : null,
        /* ما يُكتَب له سدادٌ «مطابَقة»، وما ليس سداد مورّد «متجاهَلة»، وما عداهما ينتظر */
        matchStatus:
          plannedHere !== undefined ? "MATCHED" as const
          : decided && decided.outcome === "NOT_A_PAYMENT" ? "IGNORED" as const
          : "UNMATCHED" as const,
        /* الطبقةُ من الحقائق نفسها التي تُكتب بجانبها */
        lifecycle: deriveLifecycle({
          classified: (decided?.category ?? "UNKNOWN") !== "UNKNOWN",
          hasCandidate: decided?.candidate != null,
          decided: decided?.decision?.disposition === "AUTO" && !reserved,
          posted: plannedHere !== undefined,
          ignored: decided?.outcome === "NOT_A_PAYMENT",
        }),
      },
    };
  });

  const written = new Set<string>();
  for (const part of chunks(rowsToInsert)) {
    const ids = await t.insert(bankTransactions).values(part.map((p) => p.values))
      .onConflictDoNothing()
      .returning({ id: bankTransactions.id });
    for (const r of ids) written.add(r.id);
  }
  /* القيدُ الفريد ردّها: حركةٌ سبقتنا إليها كتابةٌ أخرى، أو مقيَّدةٌ فاتها الفحص */
  const inserted = rowsToInsert.filter((p) => written.has(p.values.id));
  const rejectedByConstraint = rowsToInsert.length - inserted.length;

  /* ── أثرُ التصنيف ثمّ التحكيم — دفعاتٌ بالصفوف نفسها ── */
  for (const part of chunks(inserted)) {
    await t.insert(decisionHistory).values(part.map((p) => {
      const decided = decisions.get(p.key);
      return {
        bankTransactionId: p.values.id,
        event: "CLASSIFIED" as const,
        actor: decided?.classificationSource === "MEMORY" ? "MEMORY" : "SYSTEM",
        actorId: w.userId,
        detail: decided?.classificationReason ?? "لا يوجد سبب مسجّل",
        payload: {
          الباب: decided?.category,
          المصدر: decided?.classificationSource,
          النسخة: decided?.classificationVersion,
        },
      };
    }));
  }

  const verdicts = new Map(w.adjudications.map((o) => [o.transactionId, o]));
  const judged = inserted.flatMap((p) => {
    const v = verdicts.get(p.key);
    return v ? [{ id: p.values.id, verdict: v }] : [];
  });
  for (const part of chunks(judged)) {
    await t.insert(adjudications).values(part.map(({ id, verdict }) => ({
      bankTransactionId: id,
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
    })));
    await t.insert(decisionHistory).values(part.map(({ id, verdict }) => ({
      bankTransactionId: id,
      event: "MATCH_SUGGESTED" as const,
      actor: `AI:${verdict.provenance.provider}`,
      actorId: w.userId,
      detail: verdict.provenance.modelReason || "بلا سبب",
      payload: {
        الثقة: verdict.provenance.modelConfidence,
        "أدلّة صحّت": verdict.provenance.upheldCodes,
        "أدلّة ردّت": verdict.provenance.refutedCodes,
      },
    })));
  }

  /*
    ── السداد: صفّاً صفّاً، بترتيب الملفّ ──

    `recordBankPayment` يتبنّى الإيصالَ أو القيدَ اليدويّ الذي سبق الكشف، ويعرف
    التوأمَ بحركةٍ رُبطت به — فتُربط الحركة قبل أن يُسأل عن التالية، وإلّا تبنّت
    حوالتان دفعةً واحدة.
  */
  let created = 0;
  const posted: (typeof decisionHistory.$inferInsert)[] = [];
  for (const p of inserted) {
    const plannedHere = planned.get(p.key);
    if (!plannedHere) continue;
    const decided = decisions.get(p.key);
    const tx = p.row.row.tx;

    const { id: paymentId } = await recordBankPayment(t, {
      supplierId: plannedHere.supplierId,
      paidAt: plannedHere.paidAt,
      amountMinor: plannedHere.amountMinor,
      method: "BANK_TRANSFER",
      beneficiaryNameRaw: (tx.beneficiaryRaw ?? tx.description ?? "").slice(0, 200),
      /* الرسم يُحفَظ في حقله فيخرج من القسمة — ولا يُنسَب إلى المورّد مالٌ ذهب إلى البنك */
      feeMinor: plannedHere.feeMinor,
      /* الشهر الحاكم هو الأحدث بين شهور الفواتير لا شهر أوّلها */
      appliesToMonth: plannedHere.primaryMonth,
    });

    /*
      الطبقة والبابُ يتقدّمان مع المال: القيدُ الآليّ يكتب `POSTED`، والبابُ
      `SUPPLIER` بمصدر `STRUCTURE` إن لم يعرفه المصنِّف — كما يكتب التأكيدُ اليدويّ.
    */
    const classifiedElsewhere = (decided?.category ?? "UNKNOWN") !== "UNKNOWN";
    await t
      .update(bankTransactions)
      .set({
        matchedPaymentId: paymentId,
        matchStatus: "MATCHED",
        lifecycle: "POSTED",
        ...(classifiedElsewhere
          ? {}
          : {
              category: "SUPPLIER" as const,
              supplierId: plannedHere.supplierId,
              classificationSource: "STRUCTURE" as const,
              classificationReason: `طُوبقت مع ${countNoun(plannedHere.allocations.length, INVOICE)} للمورّد`,
            }),
      })
      .where(eq(bankTransactions.id, p.values.id));

    /* التخصيص محدود بقيمة الدفعة — والمبلغ من القاعدة لا من هنا */
    await allocate(t, paymentId, plannedHere.allocations);
    created++;

    posted.push({
      bankTransactionId: p.values.id,
      event: "POSTED",
      actor: "SYSTEM",
      actorId: w.userId,
      detail: `طُوبقت مع ${countNoun(plannedHere.allocations.length, INVOICE)}`,
      payload: { الدفعة: paymentId, الشهور: plannedHere.months },
    });
  }
  for (const part of chunks(posted)) await t.insert(decisionHistory).values(part);

  /*
    ── رصيدا كلّ شهرٍ من عمود الرصيد ──

    لا يغلب ما أدخله إنسان، ولا يستبدل ما قُرئ من كشفٍ أوسع بكشفٍ أضيق — ولا
    يُعاد كتابةُ ما لم يتغيّر: الكشفُ نفسه مرّةً ثانية لا يكتب شيئاً.
  */
  if (w.bankAccountId) {
    for (const mb of monthBalancesFromStatement(w.rows)) {
      await t.insert(reconciliationPeriods).values({
        bankAccountId: w.bankAccountId,
        periodStart: mb.periodStart,
        periodEnd: mb.periodEnd,
        openingBalanceMinor: mb.openingMinor,
        closingBalanceMinor: mb.closingMinor,
        importedCount: mb.rows,
      }).onConflictDoUpdate({
        target: [reconciliationPeriods.bankAccountId, reconciliationPeriods.periodStart, reconciliationPeriods.periodEnd],
        set: { openingBalanceMinor: mb.openingMinor, closingBalanceMinor: mb.closingMinor, importedCount: mb.rows },
        setWhere: sql`reconciliation_periods.reviewed_by_id is null and reconciliation_periods.imported_count <= ${mb.rows}
          and (reconciliation_periods.opening_balance_minor is distinct from ${mb.openingMinor}
            or reconciliation_periods.closing_balance_minor is distinct from ${mb.closingMinor}
            or reconciliation_periods.imported_count is distinct from ${mb.rows})`,
      });
    }
  }

  await recordAudit({
    actorId: w.userId,
    action: "BANK_IMPORTED",
    entityType: "bank_import",
    entityId: importId,
    after: {
      ...w.auditSummary,
      حركات_جديدة: newRows,
      حركات_موجودة_تُخطّيت: sync.known.length,
      حركات_ملتبسة: sync.ambiguous.length,
      تضارب_هويّة: sync.conflict.length,
      مدفوعات_أُنشئت: created,
      الملف_مستورد_مسبقاً: Boolean(priorImport),
    },
  }, t);

  /*
    الملتبسُ والمتضاربُ وما عندنا وليس في الكشف يُحفظون لقرار إنسان — في
    المعاملة نفسها، فلا يُحفظ محفوظٌ لاستيرادٍ لم يقع.
  */
  const held = await holdRows([
    ...sync.ambiguous.map((a) => ({ kind: "AMBIGUOUS" as const, row: a.row, verdict: a.verdict })),
    ...sync.conflict.map((c) => ({ kind: "CONFLICT" as const, row: c.row, verdict: c.verdict })),
  ].map((h): HeldRowInput => ({
    kind: h.kind,
    bankImportId: importId,
    bankAccountId: w.bankAccountId,
    againstTransactionId: h.verdict.againstId,
    reason: h.verdict.reason,
    valueDate: h.row.raw.valueDate,
    description: h.row.raw.description ?? null,
    beneficiaryRaw: h.row.raw.beneficiaryRaw ?? null,
    transactionType: h.row.raw.transactionType || null,
    amountMinor: h.row.raw.amountMinor,
    direction: h.row.raw.direction,
    operationRef: operationRef(h.row.tx),
  })).concat(plan.missingFromFile.map((m) => ({
    kind: "MISSING_FROM_FILE" as const,
    bankImportId: importId,
    bankAccountId: w.bankAccountId,
    againstTransactionId: m.id,
    reason: "موجودة عندنا وليست في كشف البنك الذي يغطي يومها. ربما سُجّلت مرتين، أو لم تحدث أصلاً.",
    valueDate: m.valueDate,
    description: m.description,
    beneficiaryRaw: m.beneficiaryRaw,
    transactionType: m.transactionType,
    amountMinor: m.amountMinor,
    direction: m.direction,
    operationRef: m.operationRef,
  }))), t);

  /* الصفّ المحفوظ يقول ما دخل فعلاً — لا ما أجازه الفحص ثمّ ردّه القيد */
  if (rejectedByConstraint > 0) {
    await t.update(bankImports).set({ newRowCount: newRows - rejectedByConstraint }).where(eq(bankImports.id, importId));
  }

  return { importId, alreadyImported: Boolean(priorImport), newRows, rejectedByConstraint, created, held };
}
