/**
 * تأكيد جهةٍ من حركة — أو من **مجموعة** حركات متشابهة.
 *
 * وهو المسار الذي يجعل النظام يتعلّم. وكان يتعلّم من حركةٍ واحدة
 * ويطبّق على حركةٍ واحدة: يقول صاحب العمل «هذه الفلاح» فتُصنَّف هي،
 * وتبقى أخواتها الأربع عشرة في الكشف نفسه كما كانت — يُسأل عنهنّ
 * واحدةً واحدة. وهذا ليس تعلّماً، هو إدخالُ بيانات بلُغةٍ ألطف.
 *
 * فصار العمل ثلاثاً في طلبٍ واحد:
 *
 *   ١. **يُحفَظ** ما أكّده: أدلّة الجهة من الحركات كلّها مجتمعةً.
 *   ٢. **يُطبَّق** على المجموعة التي أمامه.
 *   ٣. **يعمّ** على ما في القاعدة كلّها ممّا تعرفه الذاكرة الآن.
 *
 * والخادم لا يصدّق المتصفّح في أنّ هذه الحركات مجموعة: يُعيد اشتقاق
 * هويّة كلٍّ منها ويرفض ما لا يجتمع. فمن أرسل معرّفاتٍ لا يجمعها شيء
 * لا يُصنِّف بها سبعين حركة بضغطة.
 */
import { NextResponse } from "next/server";
import { and, eq, inArray, isNull, ne, notInArray, or } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions, counterparties, decisionHistory } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { confirmCounterparty, loadMerchantMemory } from "@/services/counterparty.service";
import { toCanonical, type CanonicalTransaction } from "@/lib/bank/canonical";
import { groupingIdentity, memoryKeyFor, type IdentityKind } from "@/lib/bank/pattern";
import { classify, CLASSIFICATION_VERSION } from "@/lib/bank/classification";
import { toCategory } from "@/lib/bank/apply";
import { deriveLifecycle } from "@/lib/bank/lifecycle";
import { countNoun, TRANSACTION } from "@/lib/arabic";
import type { TxCategory } from "@/lib/bank/rules";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * حدّ المجموعة الواحدة.
 *
 * لا لأنّ الأكثر خطأ — المجموعة كلّها قرارٌ واحد بطبيعتها — بل لأنّ ما
 * يُقرَّر بضغطةٍ يجب أن يبقى قابلاً للمراجعة بعينٍ واحدة.
 */
export const MAX_GROUP = 100;

const KINDS: readonly TxCategory[] = [
  "SUPPLIER", "SALARY", "RENT", "ZAKAT", "UTILITY", "GOVERNMENT",
  "PERSONAL", "INTERNAL", "OTHER", "BANK_FEE",
];

interface Body {
  /** حركةٌ واحدة — الصيغة القديمة، تبقى مقبولة. */
  transactionId?: string;
  /** المجموعة: معرّفات وحدها، ولا شيء غيرها يُؤخَذ من المتصفّح. */
  transactionIds?: string[];
  counterpartyId?: string;
  displayName?: string;
  kind?: TxCategory;
  supplierId?: string | null;
}

type Row = typeof bankTransactions.$inferSelect;

function canonicalOf(t: Row): CanonicalTransaction {
  return toCanonical({
    valueDate: t.valueDate,
    description: t.description,
    beneficiaryRaw: t.beneficiaryRaw,
    transactionType: t.transactionType,
    amountMinor: t.amountMinor,
    direction: t.direction as "DEBIT" | "CREDIT",
  });
}

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("counterparty", "bank:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const ids = [...new Set([
    ...(Array.isArray(body.transactionIds) ? body.transactionIds : []),
    ...(body.transactionId ? [body.transactionId] : []),
  ])].filter((x): x is string => typeof x === "string" && x.length > 0);

  if (ids.length === 0) {
    return NextResponse.json({ error: "حدّد الحركة" }, { status: 400 });
  }
  if (ids.length > MAX_GROUP) {
    return NextResponse.json(
      { error: `${MAX_GROUP} حركة في المرّة الواحدة على الأكثر` },
      { status: 400 },
    );
  }
  if (!body.kind || !KINDS.includes(body.kind)) {
    return NextResponse.json({ error: "اختر باباً صالحاً" }, { status: 400 });
  }
  if (body.kind === "SUPPLIER" && !body.supplierId) {
    return NextResponse.json(
      { error: "سداد المورّد يحتاج تحديد المورّد" },
      { status: 400 },
    );
  }

  const rows = await db
    .select()
    .from(bankTransactions)
    .where(inArray(bankTransactions.id, ids));

  if (rows.length === 0) {
    return NextResponse.json({ error: "لا توجد هذه الحركات" }, { status: 404 });
  }

  /*
    المجموعة تُعاد اشتقاقاً هنا.

    المتصفّح يقول «هذه سبع متشابهة»؛ والخادم يسأل: أتجتمع على هويّةٍ
    واحدة فعلاً؟ فإن لم تجتمع رُدَّت — لأنّ قراراً واحداً على حركاتٍ لا
    يجمعها شيء ليس تعميماً بل تخمينٌ بالجملة.
  */
  const canonical = new Map<string, CanonicalTransaction>();
  for (const r of rows) canonical.set(r.id, canonicalOf(r));

  const identities = rows.map((r) => groupingIdentity(canonical.get(r.id)!));
  const groupKey = identities[0]?.key ?? null;

  if (rows.length > 1) {
    if (!groupKey || identities.some((i) => i?.key !== groupKey)) {
      return NextResponse.json({
        error: "هذه الحركات لا يجمعها مستفيدٌ ولا نمطٌ واحد — تُؤكَّد كلٌّ على حدة",
      }, { status: 409 });
    }
  }

  const result = await confirmCounterparty({
    userId: user.id,
    counterpartyId: body.counterpartyId,
    displayName: body.displayName,
    kind: body.kind,
    supplierId: body.supplierId,
    transactions: rows.map((r) => canonical.get(r.id)!),
  });

  /* ── ٢. تُنسَب المجموعة إلى جهتها، وبأثرٍ مسجَّل ── */
  const reason = `أكّدتَها بنفسك${identities[0] ? ` — ${identities[0].label}` : ""}`;

  /*
    والقرارُ القديم يُطوى مع الجواب.

    من قال «هذه رسمٌ بنكيّ» فقد قال ضمناً إنّها ليست سداد فاتورة —
    فبقاءُ `match_disposition` على «تنتظر مراجعتك» يجعلها تعود إلى
    الطابور بعد كلّ تحديث، ويقرأ صاحبُ العمل أنّ عمله لم يُحفَظ. وقد
    حُفظ، والعمود الآخر هو الذي كذب.

    أمّا سدادُ المورّد فيبقى قراره: عُرف صاحبه ولم تُوجد فاتورته بعد،
    وذاك عملٌ آخر لا يُلغى بمعرفة الجهة.
  */
  const notAPayment = body.kind !== "SUPPLIER";

  for (const r of rows) {
    await db
      .update(bankTransactions)
      .set({
        counterpartyId: result.counterpartyId,
        category: body.kind,
        supplierId: body.supplierId ?? null,
        classificationSource: "HUMAN",
        classificationReason: reason,
        classificationVersion: CLASSIFICATION_VERSION,
        ...(notAPayment && r.matchedPaymentId === null
          ? {
              matchStatus: "IGNORED" as const,
              matchDisposition: null,
              matchOutcome: null,
              matchScore: null,
            }
          : {}),
        lifecycle: deriveLifecycle({
          classified: true,
          hasCandidate: Boolean(body.supplierId),
          decided: true,
          posted: r.matchedPaymentId !== null,
          ignored: notAPayment || r.matchStatus === "IGNORED",
        }),
      })
      .where(eq(bankTransactions.id, r.id));

    await db.insert(decisionHistory).values({
      bankTransactionId: r.id,
      event: "ENTITY_LEARNED",
      actor: "HUMAN",
      actorId: user.id,
      detail: reason,
      payload: {
        الجهة: body.displayName ?? null,
        الباب: body.kind,
        "حجم المجموعة": rows.length,
        الهويّة: groupKey,
      },
    });
  }

  /*
    ── ٣. ويعمّ ──

    الذاكرة تُقرأ من جديد بعد الكتابة، ثمّ يمرّ **المصنِّف نفسه** الذي
    يمرّ عليه الاستيراد على ما بقي في القاعدة. لا استعلامٌ بنصٍّ يشبه
    نصّاً: نفس الدالّة، فنفس النتيجة — وإلّا افترق ما يراه صاحب العمل
    اليوم عمّا سيراه في الكشف القادم.

    وما مسّه إنسان لا يُمَسّ: تصنيفه أوثق من استنتاج الآلة.
  */
  const learnedKeys = new Set(
    result.added.map((e) => memoryKeyFor(e.kind as IdentityKind, e.normalized)),
  );
  const memory = await loadMerchantMemory();

  const others = await db
    .select()
    .from(bankTransactions)
    .where(and(
      isNull(bankTransactions.matchedPaymentId),
      ne(bankTransactions.matchStatus, "IGNORED"),
      or(
        isNull(bankTransactions.classificationSource),
        ne(bankTransactions.classificationSource, "HUMAN"),
      ),
      notInArray(bankTransactions.id, rows.map((r) => r.id)),
    ));

  let swept = 0;
  for (const o of others) {
    const c = classify(canonicalOf(o), memory);
    if (c.source !== "MEMORY" || !c.merchantKey) continue;
    if (!learnedKeys.has(c.merchantKey)) continue;

    const known = memory.get(c.merchantKey);
    const category = toCategory(c.kind);
    if (o.category === category && o.counterpartyId === (known?.counterpartyId ?? null)) continue;

    await db
      .update(bankTransactions)
      .set({
        category,
        counterpartyId: known?.counterpartyId ?? null,
        supplierId: known?.supplierId ?? o.supplierId,
        classificationSource: "MEMORY",
        classificationReason: c.reason,
        classificationVersion: CLASSIFICATION_VERSION,
        lifecycle: deriveLifecycle({
          classified: category !== "UNKNOWN",
          hasCandidate: Boolean(known?.supplierId ?? o.supplierId),
          decided: false,
          posted: false,
          ignored: false,
        }),
      })
      .where(eq(bankTransactions.id, o.id));

    await db.insert(decisionHistory).values({
      bankTransactionId: o.id,
      event: "CLASSIFIED",
      actor: "MEMORY",
      actorId: user.id,
      detail: c.reason,
      payload: { الباب: category, المصدر: "MEMORY", النسخة: CLASSIFICATION_VERSION },
    });
    swept++;
  }

  const [party] = await db
    .select({ name: counterparties.displayName })
    .from(counterparties)
    .where(eq(counterparties.id, result.counterpartyId));

  const parts = [`حُفظت «${party?.name}»`];
  parts.push(`وطُبّقت على ${countNoun(rows.length, TRANSACTION)}`);
  if (swept > 0) parts.push(`وعُرفت بها ${countNoun(swept, TRANSACTION)} في كشوفٍ سابقة`);
  if (result.conflicts.length > 0) {
    parts.push(`ودليلٌ أو أكثر (${result.conflicts.length}) يدلّ على جهةٍ أخرى — راجعها`);
  }

  return NextResponse.json({
    ok: true,
    ...result,
    confirmed: rows.length,
    swept,
    message: parts.join("، "),
  });
}
