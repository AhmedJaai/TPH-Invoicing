import { redirect } from "next/navigation";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { alertResolutions, bankTransactions, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Card, DataTable, LinkButton, Section, Stat, StatGrid, NoAccess } from "@/components/ui";
import { BankImport } from "@/components/bank-import";
import { MatchExplain, type MatchExplanation } from "@/components/match-explain";
import { ReconcileQueue, type QueueGroup, type QueueItem } from "@/components/reconcile-queue";
import { pendingDecision } from "@/lib/bank/pending";
import { toCanonical } from "@/lib/bank/canonical";
import { groupByIdentity } from "@/lib/bank/pattern";
import { CATEGORY_LABEL } from "@/lib/bank/rules";
import { countNoun, DAY, ITEM, TRANSACTION } from "@/lib/arabic";
import {
  findDoublePaid, partitionDoublePaid,
  type DoublePaidTx,
} from "@/lib/bank/double-paid";
import { SETTLED_TOLERANCE_MINOR } from "@/lib/supplier-balances";
import { loadSupplierBalances } from "@/services/supplier-balance.service";
import { daysSinceRiyadh, formatDay } from "@/lib/riyadh-time";
import { BANK_STALE_DAYS } from "@/lib/attention";

export const dynamic = "force-dynamic";

/**
 * البنك: أين تحرّكت الأموال.
 *
 * كانت الصفحة تُسمّى «السداد»، وهو خلطٌ بين شيئين: البنك يقول أين ذهب
 * المال، والمستحقّات تقول ماذا عليك. وهما متداخلان لا واحد.
 *
 * وكل مطابقة هنا تحمل «لماذا؟» — الأدلّة بنصّها — وزرَّ تراجع. فمن
 * وافق على مطابقة خاطئة لا يبقى أسيرها.
 */
export default async function BankPage({
  searchParams,
}: {
  searchParams: Promise<{ tx?: string; doublePaid?: string }>;
}) {
  const params = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/login?from=/bank");
  if (!can(user.role, "bank:view")) {
    return (
      <PageShell user={user} width="wide" title="حركة البنك">
        <NoAccess what="كشف البنك" />
      </PageShell>
    );
  }

  const [counts, supplierRows, balances, recent, pending, outgoing, focus] = await Promise.all([
    db.execute<Record<string, number>>(sql`
      select
        (select count(*)::int from bank_transactions)                                as tx,
        (select to_char(min(value_date), 'YYYY-MM-DD') from bank_transactions)       as first_day,
        (select to_char(max(value_date), 'YYYY-MM-DD') from bank_transactions)       as last_day,
        (select count(*)::int from bank_transactions
          where match_disposition = 'AUTO')                                         as auto,
        (select count(*)::int from bank_transactions
          where match_disposition = 'SUGGEST')                                      as suggest,
        /*
          العدد الواحد للعمل الباقي — الشرطُ نفسه الذي يقرؤه الطابور والشارة.
          وكانت البطاقة تعدّ match_disposition = REVIEW فتقول «٢٢» وتفتح
          طابوراً فارغاً: التقاطع بين العدّين كان صفراً.
        */
        (select count(*)::int from ${bankTransactions} where ${pendingDecision()})  as pending,
        (select coalesce(sum(amount_minor),0)::bigint from bank_transactions
          where direction = 'CREDIT' and category = 'POS_SETTLEMENT')               as settled,
        (select count(*)::int from invoices i
          where i.total_minor > coalesce((select sum(pa.amount_minor)::int
            from payment_allocations pa where pa.invoice_id = i.id), 0) + ${SETTLED_TOLERANCE_MINOR}) as open,
        /*
          «سداد بلا فاتورة» من **الدفعات** لا من الحركات — المصدر نفسه الذي
          يقرأ منه بند «يحتاج انتباهك». وكانت البطاقة تعدّ حركاتٍ بلا دفعة
          فتقول «٠٫٠٠» بالأخضر، والرئيسة تقول «١٤ دفعة بـ٣٨٬٦٠٥».
        */
        (select count(*)::int from payments p
          where p.status not in ('REVERSED','VOID','ADVANCE')
            and p.amount_minor - p.fee_minor - coalesce((select sum(a.amount_minor)::int
              from payment_allocations a where a.payment_id = p.id), 0) > 100)       as unapplied,
        (select coalesce(sum(p.amount_minor - p.fee_minor - coalesce((select sum(a.amount_minor)::int
              from payment_allocations a where a.payment_id = p.id), 0)), 0)::bigint
           from payments p
          where p.status not in ('REVERSED','VOID','ADVANCE')
            and p.amount_minor - p.fee_minor - coalesce((select sum(a.amount_minor)::int
              from payment_allocations a where a.payment_id = p.id), 0) > 100)       as unapplied_sum,
        (select count(*)::int from payments where status = 'ADVANCE')              as advance,
        (select coalesce(sum(amount_minor),0)::bigint from payments
          where status = 'ADVANCE')                                                 as advance_sum
    `),

    db.select({ id: suppliers.id, nameAr: suppliers.nameAr })
      .from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.nameAr)),

    /*
      ما على كلّ مورّد الآن — ليُعرَض قبل السداد على حسابه لا بعده.
      من المصدر الواحد لـ«عليك»: كان يجمع ما بقي على الفواتير بلا عتبة
      الهللة ولا رصيدنا عنده، فقالت المعاينة «سيُخصَّص ٠٫٠٢» لسرد كو وهو
      لا يُدان بشيء.
    */
    loadSupplierBalances(db),

    db.select({
      id: bankTransactions.id,
      valueDate: bankTransactions.valueDate,
      description: bankTransactions.description,
      beneficiaryRaw: bankTransactions.beneficiaryRaw,
      amountMinor: bankTransactions.amountMinor,
      direction: bankTransactions.direction,
      category: bankTransactions.category,
      matchedPaymentId: bankTransactions.matchedPaymentId,
      matchDisposition: bankTransactions.matchDisposition,
      matchScore: bankTransactions.matchScore,
      matchOutcome: bankTransactions.matchOutcome,
      matchEvidence: bankTransactions.matchEvidence,
      matchStatus: bankTransactions.matchStatus,
      lifecycle: bankTransactions.lifecycle,
      transactionType: bankTransactions.transactionType,
    })
      .from(bankTransactions)
      .where(sql`${bankTransactions.matchDisposition} is not null`)
      .orderBy(desc(bankTransactions.valueDate))
      .limit(25),

    /*
      المعلّقات: **كلّ** ما يحتاج قراراً لا المجهول وحده.

      كان الطابور «الحركات المجهولة». والواقع أنّ ما يحتاج قراراً أوسع:
      اقتراحٌ ينتظر إقراراً، ومبلغٌ لا يوافق، وسدادٌ جزئيّ، وزيادة —
      وكلّها كانت تُعرَض أو لا تُعرَض بلا زرّ يُتَّخذ به قرار، فيقف
      صاحب العمل أمام حركةٍ يعرف أنّها تحتاجه ولا يملك فعلاً.
    */
    db.select({
      id: bankTransactions.id,
      valueDate: bankTransactions.valueDate,
      amountMinor: bankTransactions.amountMinor,
      direction: bankTransactions.direction,
      description: bankTransactions.description,
      beneficiaryRaw: bankTransactions.beneficiaryRaw,
      matchEvidence: bankTransactions.matchEvidence,
      matchOutcome: bankTransactions.matchOutcome,
      matchDisposition: bankTransactions.matchDisposition,
      supplierId: bankTransactions.supplierId,
      transactionType: bankTransactions.transactionType,
    })
      .from(bankTransactions)
      /*
        ما يحتاج **تعريفاً**، لا ما يحمل قراراً قديماً.

        كان الشرط `match_disposition in ('SUGGEST','REVIEW')` — وهو
        عمودٌ عن المطابقة بفاتورة، لا عن معرفة الجهة. فمن عرّف حركةً
        وحدّث الصفحة وجدها تُسأل عنه ثانيةً كأنّه لم يفعل شيئاً: التعريف
        كُتب فعلاً، والقرار القديم بقي كما هو، والطابور يقرأ القرار.
        وستّ وأربعون حركة أكّدها أحمد بيده كانت تعود إليه كلّ مرّة.

        فصار الطابور يقرأ الطبقة والمصدر: ما قرّره إنسان لا يُسأل عنه،
        وما عُرف بابُه وليس سداد مورّد لا قرار فيه أصلاً — والرسمُ
        البنكيّ لا يُسأل عنه وقد صُنّف تلقائياً.
      */
      /*
        الأساس مشترك مع طابور المراجعة — `pendingDecision()` — وما بعده
        خاصٌّ بهذه الشاشة: تسأل عن الجهة المجهولة وعن سداد المورّد الذي
        لم يُعرَف مورّده. والأساسُ يُستدعى ولا يُنسَخ، وإلّا افترق
        العدّان من حيث لا يُقصَد.
      */
      .where(sql`${pendingDecision()}
        and (
          ${bankTransactions.category} = 'UNKNOWN'
          or (${bankTransactions.category} = 'SUPPLIER' and (
                /* عُرف أنّه سدادُ مورّد ولم يُعرَف أيّ مورّد */
                ${bankTransactions.supplierId} is null
                or ${bankTransactions.matchDisposition} in ('SUGGEST','REVIEW')
             ))
        )`)
      .orderBy(desc(bankTransactions.amountMinor))
      /*
        الحدّ يُرفَع لأنّ الوحدة صارت المجموعة لا الحركة: ستّون حركة
        قد تكون ثماني مجموعات. والقصّ عند ستّين كان يُخفي أنّ في
        القاعدة أخواتٍ لما يُسأل عنه — فيُجاب عن سبعٍ ويبقى ثمانٍ.
      */
      .limit(400),

    /* الصادر كلّه — لكشف ما خرج مرّتين في يومٍ واحد */
    db.select({
      id: bankTransactions.id,
      valueDate: bankTransactions.valueDate,
      amountMinor: bankTransactions.amountMinor,
      description: bankTransactions.description,
      beneficiaryRaw: bankTransactions.beneficiaryRaw,
      category: bankTransactions.category,
      operationRef: bankTransactions.operationRef,
    })
      .from(bankTransactions)
      .where(eq(bankTransactions.direction, "DEBIT")),

    /* الحركة التي فُتحت الصفحة عليها — من الطابور أو من بحث */
    params.tx
      ? db.select({
          id: bankTransactions.id,
          valueDate: bankTransactions.valueDate,
          description: bankTransactions.description,
          beneficiaryRaw: bankTransactions.beneficiaryRaw,
          transactionType: bankTransactions.transactionType,
          amountMinor: bankTransactions.amountMinor,
          direction: bankTransactions.direction,
          category: bankTransactions.category,
          matchedPaymentId: bankTransactions.matchedPaymentId,
          matchDisposition: bankTransactions.matchDisposition,
          matchScore: bankTransactions.matchScore,
          matchOutcome: bankTransactions.matchOutcome,
          matchEvidence: bankTransactions.matchEvidence,
          matchStatus: bankTransactions.matchStatus,
          lifecycle: bankTransactions.lifecycle,
        })
          .from(bankTransactions)
          .where(eq(bankTransactions.id, params.tx))
          .limit(1)
      : Promise.resolve([]),
  ]);

  const doublePaid = findDoublePaid(outgoing.map((r): DoublePaidTx => ({
    id: r.id,
    valueDate: r.valueDate,
    amountMinor: r.amountMinor,
    direction: "DEBIT",
    description: r.description,
    beneficiaryRaw: r.beneficiaryRaw,
    category: r.category,
    operationRef: r.operationRef,
  })));
  /*
    قرارُ الإنسان في «سُدّد مرّتين» (SCN-104) — يُقرأ هنا بمعزلٍ عن
    الاستعلامات أعلاه: جدولٌ صغير، ولا يُقرأ إن لم يكن ثمّة ازدواج.
  */
  const doublePaidDecisions = new Map(
    doublePaid.length === 0
      ? []
      : (await db.select({ key: alertResolutions.key, decision: alertResolutions.decision }).from(alertResolutions))
          .map((r) => [r.key, r.decision] as const),
  );
  const doublePaidSplit = partitionDoublePaid(doublePaid, doublePaidDecisions);
  /* ما لم يُحسَم بعد — وهو ما يستحقّ الإحالة. وما حُسم لا يُذكَر. */
  const doublePaidCount = doublePaidSplit.open.length + doublePaidSplit.claimed.length;

  /*
    ولا يُستعلَم هنا عن «دفعات لم تُنسب»: خرجت بطاقتُها إلى موضعها
    الواحد في «يحتاج قرارك» — فلا استعلامَ لرقمٍ لا يُعرَض.
  */
  const focused = focus[0] ?? null;
  const canApprove = can(user.role, "payment:approve");
  const canEdit = can(user.role, "bank:edit");

  /** يترجم ما قرّره المحرّك إلى سببٍ يُقرأ. */
  function reasonOf(t: (typeof pending)[number]): QueueItem["reason"] {
    if (t.matchOutcome === "PARTIAL_PAYMENT") return "PARTIAL_PAYMENT";
    if (t.matchOutcome === "OVERPAYMENT") return "OVERPAYMENT";
    if (t.matchOutcome === "AMOUNT_MISMATCH") return "AMOUNT_MISMATCH";
    /*
      «المورّد معروف ولا فاتورة» سببٌ قائم بذاته لا «مرشّحان
      متقاربان». وهو في كشف أحمد أكثر المعلّقات: ثمانون حركة بمئتين
      وأربعة وأربعين ألف ريال — كانت تُعرَض بسببٍ ليس سببها، فيُبحَث
      عن مرشّحين لا وجود لهم.
    */
    if (t.matchOutcome === "KNOWN_SUPPLIER_NO_INVOICE") return "KNOWN_SUPPLIER_NO_INVOICE";
    if (t.matchDisposition === "SUGGEST") return "SUGGESTED";
    if (t.supplierId === null) return "UNKNOWN_ENTITY";
    return "CLOSE_CANDIDATES";
  }

  const supplierName = new Map(supplierRows.map((s) => [s.id, s.nameAr]));
  const outstanding = new Map(
    balances.filter((b) => b.owedMinor > 0).map((b) => [b.supplierId, b.owedMinor]),
  );

  /*
    الحركة تُحوَّل مرّةً واحدة، ويُقرأ منها العرضُ والتجميع معاً.

    وكان العرض يأخذ `beneficiary_raw` خاماً — وهو ملوَّث في الصفوف
    القديمة باسم المورّد الذي طابقه نظامُنا. فيُعرَض على صاحب العمل اسمُ
    جهةٍ لم يذكرها البنك قطّ.
  */
  const canonical = new Map(pending.map((t) => [t.id, toCanonical({
    valueDate: t.valueDate,
    description: t.description,
    beneficiaryRaw: t.beneficiaryRaw,
    transactionType: t.transactionType,
    amountMinor: t.amountMinor,
    direction: t.direction as "DEBIT" | "CREDIT",
  })]));

  const toItem = (t: (typeof pending)[number]): QueueItem => {
    const ev = t.matchEvidence as
      { تصنيف?: string; مستفيد?: string[]; مطابقة?: string[] } | null;
    return {
      id: t.id,
      date: t.valueDate.toISOString().slice(0, 10),
      amountMinor: t.amountMinor,
      direction: t.direction as "DEBIT" | "CREDIT",
      description: (t.description ?? "").slice(0, 160),
      beneficiaryRaw: canonical.get(t.id)?.beneficiary ?? null,
      reason: reasonOf(t),
      guessName: t.supplierId ? supplierName.get(t.supplierId) ?? null : null,
      guessKind: null,
      why: [ev?.تصنيف, ...(ev?.مستفيد ?? []), ...(ev?.مطابقة ?? [])]
        .filter((x): x is string => Boolean(x))
        .slice(0, 4),
    };
  };

  /*
    التجميع في الخادم.

    لأنّ الهويّة تُشتقّ بالدالّة نفسها التي يكتب بها الاستيراد ويتحقّق
    بها مسار التأكيد — فما تراه الشاشة مجموعةً هو ما سيراه الخادم
    مجموعةً. ولو جُمع في المتصفّح لصار تجميعان: واحدٌ يُعرَض وآخر
    يُكتَب، ولا يلتقيان إلّا بالمصادفة.
  */
  const { groups: rawGroups, ungrouped } = groupByIdentity(
    pending,
    (t) => canonical.get(t.id)!,
    (t) => t.amountMinor,
  );

  const titleOf = (t: (typeof pending)[number]) =>
    canonical.get(t.id)?.beneficiary?.trim()
    || (t.description ?? "").trim().slice(0, 70)
    || "بلا وصف";

  const groups: QueueGroup[] = [
    ...rawGroups.map((g) => {
      const items = g.items.map(toItem);
      const supplierIds = new Set(g.items.map((t) => t.supplierId));
      const only = supplierIds.size === 1 ? [...supplierIds][0] : null;
      return {
        key: g.key,
        identityLabel: g.identity.label,
        title: titleOf(g.items[0]),
        totalMinor: g.totalMinor,
        items,
        guessName: only ? supplierName.get(only) ?? null : null,
        why: items[0]?.why ?? [],
        supplierId: only,
        supplierName: only ? supplierName.get(only) ?? null : null,
        outstandingMinor: only ? outstanding.get(only) ?? 0 : undefined,
      };
    }),
    /*
      ما لا هويّة له يُعرَض على حدة ولا يُدسّ في مجموعة.

      حركةٌ بلا اسمٍ ولا وصفٍ ولا رقم لا يُتعلَّم منها شيء — تُصنَّف هي
      وحدها. وقولُ ذلك أصدق من جمعها مع غيرها بحجّة أنّنا لم نعرف
      أيّهما.
    */
    ...ungrouped.map((t) => ({
      key: `bare:${t.id}`,
      identityLabel: "لا هويّة لها — تُحسم وحدها",
      title: titleOf(t),
      totalMinor: t.amountMinor,
      items: [toItem(t)],
      guessName: t.supplierId ? supplierName.get(t.supplierId) ?? null : null,
      why: [],
    })),
  ];

  const f = counts.rows[0] ?? {};
  const n = (k: string) => Number(f[k] ?? 0);
  const firstDay = f.first_day ? String(f.first_day) : null;
  const lastDay = f.last_day ? String(f.last_day) : null;
  const staleDays = lastDay ? daysSinceRiyadh(lastDay) : null;
  const stale = staleDays !== null && staleDays > BANK_STALE_DAYS;

  return (
    <PageShell
      user={user}
      width="wide"
      /* اسمُ الصفحة هو اسمُ لسانها حرفاً بحرف — «فعلٌ واحد باسمٍ واحد» */
      title="حركة البنك"
      intro="أين تحرّكت الأموال. وكلّ مطابقةٍ هنا تقول لماذا طُوبقت، ويمكن التراجع عنها."
      /* الاستيرادُ أوّلُ أفعال الصفحة وكان في آخرها، تحت ألف حركة */
      actions={canEdit ? <LinkButton href="#import" variant={stale ? "primary" : "secondary"}>استورد كشفاً</LinkButton> : undefined}
    >
      {/* ── الحركة التي فُتحت عليها الصفحة ── */}
      {focused && (
        <Section title="الحركة المطلوبة" hint="فُتحت من الطابور أو البحث — ولماذا طُوبقت، وبابُ التراجع عنها.">
          <Card>
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-sm font-bold" dir="auto">
                  {toCanonical({
                    valueDate: focused.valueDate,
                    description: focused.description,
                    beneficiaryRaw: focused.beneficiaryRaw,
                    transactionType: focused.transactionType,
                    amountMinor: focused.amountMinor,
                    direction: focused.direction as "DEBIT" | "CREDIT",
                  }).beneficiary ?? focused.description?.slice(0, 60) ?? "حركة"}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted" dir="auto">
                  <bdi>{formatDay(focused.valueDate)}</bdi> ·{" "}
                  {focused.direction === "DEBIT" ? "صادر" : "وارد"} ·{" "}
                  {CATEGORY_LABEL[focused.category] ?? focused.category}
                </span>
                <span className="mt-1 block text-[11px] text-ink-soft" dir="auto">{focused.description}</span>
              </span>
              <span className="nums shrink-0 text-sm font-bold"><Money minor={focused.amountMinor} /></span>
            </div>
            <MatchExplain
              match={{
                transactionId: focused.id,
                disposition: focused.matchDisposition,
                score: focused.matchScore,
                outcome: focused.matchOutcome,
                amountMinor: focused.amountMinor,
                matched: focused.matchedPaymentId !== null,
                status: focused.matchStatus,
                lifecycle: focused.lifecycle,
                evidence: focused.matchEvidence as MatchExplanation["evidence"],
              }}
              canUndo={canApprove}
            />
          </Card>
        </Section>
      )}
      {params.tx && !focused && (
        <p className="mb-4 rounded-lg border border-warn/40 bg-warn-bg px-3 py-2 text-xs text-warn">
          لا توجد الحركة المطلوبة — ربما دُمجت بنسختها. هذه الصفحة كاملةً.
        </p>
      )}

      {/*
        بلا كشفٍ مستورَد لا يُعرض «إيداعات مدى ٠٫٠٠» بالأخضر — صفرٌ عن غير
        علم. ويبقى قسمُ الاستيراد أدناه، وهو الفعلُ الوحيد هنا.
      */}
      {n("tx") > 0 && (<>
      <StatGrid>
        {/*
          ── بطاقتان خرجتا من هنا ──

          «دفعات لم تُنسب إلى فاتورة» كانت بطاقةً في **أربع** شاشات:
          الرئيسية، و«يحتاج قرارك»، و«المورّدون»، وهذه. والعملُ الواحد
          معروضاً أربع مرّاتٍ يُقرأ أربعةَ أعمال. وهو **عملٌ باقٍ** لا
          حالُ بنك، فموضعُه الطابور حيث له فعلُه.

          و«فواتير مفتوحة ٢١» حالُ فواتير لا حالُ حساب — موضعُها صفحة
          الفواتير، وهي تعرضها مع ما بقي عليها.

          وبقيت «إيداعات مدى» لأنّها وحدها خبرٌ عن هذا الحساب: من أين
          يدخل المال.
        */}
        {/*
          ما يغطّيه الكشفُ أوّلُ ما يُقرأ: كلُّ رقمٍ في الصفحة على ما قبل
          آخر يومٍ فيه. وكان يُقال «١٤٤٠ حركة مخزّنة بعد إزالة المكرَّر»
          ولا يُقال إنّ آخرها قبل ثلاثة أسابيع.
        */}
        <Stat
          label="الكشف المستورَد"
          value={lastDay ? `حتى ${formatDay(lastDay)}` : "غير معروف"}
          tone={stale ? "warn" : undefined}
          sub={
            stale
              ? `وقف منذ ${countNoun(staleDays, DAY)} — ما بعده لا يعرفه النظام.`
              : `من ${formatDay(firstDay)} · ${countNoun(n("tx"), TRANSACTION)}`
          }
        />
        <Stat
          label="إيداعات مدى (نقاط البيع)"
          minor={n("settled")}
          tone="ok"
          sub={firstDay && lastDay ? `إيراد البطاقات من ${formatDay(firstDay)} إلى ${formatDay(lastDay)}` : "إيراد البطاقات يصل حسابك"}
        />
      </StatGrid>
      </>)}

      {/*
        «سُدّد مرّتين» كان معروضاً هنا كاملاً — البند نفسه والمبالغ نفسها
        والأزرار نفسها الموجودة في «يحتاج قرارك». فبقي في موضعٍ واحد،
        وهذه إحالةٌ إليه لا نسخةٌ منه.
      */}
      {groups.length > 0 && (
        <Section
          title="حلّ المعلّقات"
          hint="سؤالٌ واحد عن كلّ ما يتشابه، ثمّ ننتقل. وما تؤكّده يصير ذاكرة: يُطبَّق الآن على ما اخترتَه، ويُعرَف به ما يشبهه في الكشوف القادمة بلا سؤال."
        >
          <ReconcileQueue groups={groups} suppliers={supplierRows} canApprove={canApprove} canEdit={canEdit} />
        </Section>
      )}

      {/*
          ── تلميحٌ كان ينفي صفوفَه ──

          كان يقول «... ولا بنودَ تنتظر تأكيدك» لأنّه يعدّ `SUGGEST`
          وحدها، وفي القائمة تحته صفٌّ بشارة «تنتظر مراجعتك» (`REVIEW`).
          فالقسمُ ينفي في عنوانه ما يعرضه في متنه.

          والعددُ الواحد للعمل الباقي هو `pending` — الشرطُ نفسه الذي
          يقرؤه «يحتاج قرارك». فإن كان فيه شيء قيل وفُتح موضعُه، وإلّا
          فهذا سجلُّ ما وقع لا طابورُ ما ينتظر.
      */}
      {/*
        ── شاشةُ تشغيل لا دفترَ حركات ──

        كان هذا خمسةً وعشرين بطاقةً، في كلٍّ منها نصُّ البنك الخام سطراً
        أوّل، والمبلغُ في طرف، والحالُ تحتهما. فالعينُ تقرأ البطاقةَ
        بطاقةً ولا تمسح عموداً: لا يُعرَف في لمحةٍ لمن خرج المال، ولا
        أيُّ حركةٍ حالُها غير حال أختها.

        فصار جدولاً بأعمدةٍ تُمسَح: **الجهة** ثمّ التاريخ ثمّ البابُ ثمّ
        **المبلغ** مصفوفاً على خاناته، ثمّ **الحالُ وفعلُه** في عمودٍ
        واحد — الشارةُ تقول أين وقفت، و«لماذا؟» تفتح الأدلّة في موضعها،
        والتراجعُ بجانبها. ونصُّ البنك باقٍ تحت اسم الجهة: دليلٌ يُقابَل
        بالكشف، لا عنوانٌ يُقرأ.
      */}
      {doublePaidCount > 0 && (
        <div id="double-paid" className="mt-8 scroll-mt-28">
          <Card tone="danger">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 text-xs leading-relaxed">
                <span className="font-bold text-danger">
                  مالٌ خرج مرّتين في يومٍ واحد — {countNoun(doublePaidCount, ITEM)}
                </span>
                <span className="block text-muted">
                  يُطالَب به الجهةُ ويُسترَدّ، ولا يُصلَح في قيدنا. ومكانُ حسمه واحد.
                </span>
              </p>
              <LinkButton href="/attention?item=duplicate-payments" variant="primary" size="sm">
                افتحه في «يحتاج قرارك»
              </LinkButton>
            </div>
          </Card>
        </div>
      )}

      {recent.length > 0 && (
        <Section
          title="آخر الحركات وحالها"
          hint="لمن خرج المال، وأين وقفت كلُّ حركة. والحالُ يُشتقّ من الحركة نفسها لا من ترجيحٍ قديم."
        >
          <DataTable
            rows={recent}
            keyOf={(t) => t.id}
            columns={[
              {
                key: "who", header: "الجهة", primary: true,
                cell: (t) => (
                  <span className="block min-w-0">
                    <span className="block truncate font-bold" dir="auto">
                      {toCanonical({
                        valueDate: t.valueDate,
                        description: t.description,
                        beneficiaryRaw: t.beneficiaryRaw,
                        transactionType: t.transactionType,
                        amountMinor: t.amountMinor,
                        direction: t.direction as "DEBIT" | "CREDIT",
                      }).beneficiary ?? t.description?.slice(0, 60) ?? "حركة"}
                    </span>
                    <span
                      className="mt-0.5 block max-w-[28rem] truncate text-[11px] text-muted"
                      dir="auto"
                      title={t.description ?? undefined}
                    >
                      {t.description}
                    </span>
                  </span>
                ),
              },
              {
                key: "date", header: "التاريخ", secondary: true,
                cell: (t) => <bdi className="nums">{formatDay(t.valueDate)}</bdi>,
              },
              {
                key: "kind", header: "الباب", secondary: true,
                cell: (t) => (
                  <span className="whitespace-nowrap text-muted">
                    {t.direction === "DEBIT" ? "صادر" : "وارد"} · {CATEGORY_LABEL[t.category] ?? t.category}
                  </span>
                ),
              },
              {
                key: "amount", header: "المبلغ", numeric: true,
                cell: (t) => <span className="font-bold"><Money minor={t.amountMinor} /></span>,
              },
              {
                key: "state", header: "الحال",
                cell: (t) => (
                  <span id={`tx-${t.id}`} className="block scroll-mt-28">
                    <MatchExplain
                      match={{
                        transactionId: t.id,
                        disposition: t.matchDisposition,
                        score: t.matchScore,
                        outcome: t.matchOutcome,
                        amountMinor: t.amountMinor,
                        matched: t.matchedPaymentId !== null,
                        status: t.matchStatus,
                        lifecycle: t.lifecycle,
                        evidence: t.matchEvidence as MatchExplanation["evidence"],
                      }}
                      canUndo={canApprove}
                    />
                  </span>
                ),
              },
            ]}
          />
        </Section>
      )}

      <Section id="import" className="scroll-mt-24" title="استيراد كشف" hint="الملف الذي استُورد من قبل لا يتكرّر — تُقيَّد الحركات الجديدة وحدها.">
        {canEdit
          ? <BankImport openInvoiceCount={n("open")} suppliers={supplierRows} />
          : <p className="text-xs text-muted">استيراد الكشف خارج صلاحيتك.</p>}
      </Section>
    </PageShell>
  );
}
