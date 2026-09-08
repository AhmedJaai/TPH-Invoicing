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
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions, counterparties, decisionHistory } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { confirmCounterparty } from "@/services/counterparty.service";
import { toCanonical, type CanonicalTransaction } from "@/lib/bank/canonical";
import { groupingIdentity, memoryKeyFor, type IdentityKind } from "@/lib/bank/pattern";
import { CLASSIFICATION_VERSION } from "@/lib/bank/classification";
import { deriveLifecycle } from "@/lib/bank/lifecycle";
import { TRANSACTION, countNoun } from "@/lib/arabic";
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
    return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة، فإن تكرّر فأبلِغ مالك الحساب." }, { status: 400 });
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
      { error: `${countNoun(MAX_GROUP, TRANSACTION)} في المرّة الواحدة على الأكثر` },
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

  /* الباب بعد التحقّق — يُثبَّت لأنّ التضييق لا يعبر إلى داخل المعاملة */
  const kind = body.kind;

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

  /*
    ══ قرارٌ واحد، معاملةٌ واحدة ══

    تأكيدُ الجهة قرارٌ واحد يُطبَّق على ثلاث وثلاثين حركة: تُحفَظ الجهة،
    ثمّ أدلّتها، ثمّ تُصنَّف حركاتُ المجموعة، ثمّ يعمّ التصنيف على
    أمثالها في الكشوف السابقة. وكان كلُّ سطرٍ من ذلك يُكتَب وحده بلا
    معاملة — فلو سقط الاتّصال عند الحركة العاشرة بقيت جهةٌ محفوظة
    وتسعُ حركاتٍ مصنَّفة وأربعٌ وعشرون لا؛ ولا شيء في الشاشة يقول ذلك.

    فإمّا أن يقع القرار كلُّه أو لا يقع منه شيء.
  */
  /*
    الخطأ يُعاد نصّاً، لا ٥٠٠ صامتاً.

    لم يكن حول هذا المسار `try` أصلاً، فأيّ رمية تخرج ٥٠٠ بلا جسم —
    فتعرض الشاشة رسالتها العامّة «أبلِغ مالك الحساب» وهو المالك نفسه،
    ولا يبقى في يده شيء. والعطبُ الذي لا يُسمّى لا يُصلَح.
  */
  let result: Awaited<ReturnType<typeof confirmCounterparty>>;
  try {
    result = await db.transaction(async (t) => {
    const result = await confirmCounterparty({
      writer: t,
      userId: user.id,
      counterpartyId: body.counterpartyId,
      displayName: body.displayName,
      kind,
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
    const notAPayment = kind !== "SUPPLIER";

    for (const r of rows) {
      await db
        .update(bankTransactions)
        .set({
          counterpartyId: result.counterpartyId,
          category: kind,
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
          الباب: kind,
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
      return result;
    });
  } catch (e) {
    const err = e as Error & { cause?: { message?: string } };
    console.error("counterparty:", err.cause ?? err);
    return NextResponse.json(
      { error: `تعذّر الحفظ: ${(err.cause?.message ?? err.message).slice(0, 200)}` },
      { status: 500 },
    );
  }

  /*
    ── النشر لا يقع في الطلب ──

    كان يُقرأ كلّ ما لم يُطابَق — وهي مئات الحركات — ويُصنَّف ويُكتب،
    قبل أن يُردّ على المستخدم. فتنفد مهلة الاتصال بالقاعدة ويسقط الطلب
    كلُّه: **فلا يُحفظ حتى التأكيد**، ولا يرى صاحب العمل إلّا خطأً.

    وإخراجُه من المعاملة لم يكفِ، لأنّ الزمن نفسه هو المشكلة لا موضعُ
    المعاملة. فخرج من الطلب كلّه.

    والتأكيد يُحفظ ويُردّ فوراً — وهو ما يطلبه المستخدم. والنشرُ على
    الأمثال يقع في موضعين قائمين: الاستيراد القادم يمرّ بالمصنِّف نفسه
    فيقرأ الذاكرة الجديدة، و`npm run db:reclassify` ينشره على ما مضى.

    **وحفظٌ يقع خيرٌ من نشرٍ يُسقط الحفظ معه.**
  */
  const swept = 0;

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
