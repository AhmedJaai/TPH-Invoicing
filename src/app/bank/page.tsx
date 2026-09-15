import { redirect } from "next/navigation";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { alertResolutions, bankTransactions, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Badge, Card, Section, Stat, StatGrid, NoAccess } from "@/components/ui";
import { BankImport } from "@/components/bank-import";
import { MatchExplain, type MatchExplanation } from "@/components/match-explain";
import { ReconcileQueue, type QueueGroup, type QueueItem } from "@/components/reconcile-queue";
import { pendingDecision } from "@/lib/bank/pending";
import { toCanonical } from "@/lib/bank/canonical";
import { groupByIdentity } from "@/lib/bank/pattern";
import { CATEGORY_LABEL } from "@/lib/bank/rules";
import { countNoun, ITEM, PAYMENT_RECORD, TIME, TRANSACTION } from "@/lib/arabic";
import {
  buildDoublePaidClaim, doublePaidKey, findDoublePaid, partitionDoublePaid, recoverableMinor,
  DOUBLE_PAID_DECISION_LABEL, type DoublePaidDecision, type DoublePaidGroup, type DoublePaidTx,
} from "@/lib/bank/double-paid";
import { DoublePaidActions } from "@/components/double-paid-actions";
import { SETTLED_TOLERANCE_MINOR } from "@/lib/supplier-balances";

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
      <PageShell user={user} width="wide" title="البنك">
        <NoAccess what="كشف البنك" />
      </PageShell>
    );
  }

  const [counts, supplierRows, balances, recent, pending, outgoing, focus] = await Promise.all([
    db.execute<Record<string, number>>(sql`
      select
        (select count(*)::int from bank_transactions)                                as tx,
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

    /* ما على كلّ مورّد الآن — ليُعرَض قبل السداد على حسابه لا بعده */
    db.execute<{ supplier_id: string; outstanding: string }>(sql`
      select i.supplier_id,
             sum(i.total_minor - coalesce((select sum(pa.amount_minor)::int
               from payment_allocations pa where pa.invoice_id = i.id), 0))::bigint as outstanding
      from invoices i
      group by i.supplier_id
      having sum(i.total_minor - coalesce((select sum(pa.amount_minor)::int
        from payment_allocations pa where pa.invoice_id = i.id), 0)) > 0
    `),

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
    balances.rows.map((b) => [b.supplier_id, Number(b.outstanding)]),
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

  return (
    <PageShell
      user={user}
      width="wide"
      title="البنك"
      intro="أين تحرّكت الأموال. وكل مطابقة هنا تقول لماذا طُوبقت، ويمكن التراجع عنها."
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
                  <bdi className="nums">{focused.valueDate.toISOString().slice(0, 10)}</bdi> ·{" "}
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

      <StatGrid>
        <Stat
          label="طابور المراجعة"
          value={String(n("pending"))}
          tone={n("pending") > 0 ? "warn" : "ok"}
          sub={n("pending") > 0 ? "حركاتٌ تنتظر قراراً" : "لا حركة تنتظر قراراً"}
          href="/review"
        />
        <Stat
          label="سداد بلا فاتورة"
          minor={n("unapplied_sum")}
          tone={n("unapplied") > 0 ? "warn" : "ok"}
          sub={`${countNoun(n("unapplied"), PAYMENT_RECORD)} لم تُخصَّص على فاتورة`
            + (n("advance") > 0 ? ` · ومقدَّمة معلَنة ${(n("advance_sum") / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "")}
          href="/attention"
        />
        <Stat
          label="فواتير مفتوحة"
          value={String(n("open"))}
          href="/purchases/invoices?paid=OPEN"
          sub="ما زال عليها رصيد"
        />
        <Stat
          label="تسويات الشبكة"
          minor={n("settled")}
          tone="ok"
          sub="إيراد البطاقات يصل حسابك"
        />
      </StatGrid>
      <p className="mt-2 text-[11px] text-muted">
        {countNoun(n("tx"), TRANSACTION)} مخزّنة بعد إزالة المكرَّر.
      </p>

      {/* ── ما خرج مرّتين ── */}
      {doublePaid.length > 0 && (
        <div id="double-paid" className="scroll-mt-28">
          <Section
            title="سُدّد مرّتين في يومٍ واحد"
            hint={`${recoverableMinor(doublePaidSplit.open) + recoverableMinor(doublePaidSplit.claimed) > 0 ? "مالٌ يُطالَب به الجهةُ ويُسترَدّ — لا يُصلَح في قيدنا، فالمال خرج فعلاً. " : ""}أرسل رسالة المطالبة، ثمّ قل ما جرى: «طالبتُ» يُبقي التنبيه أهدأ، و«استُردّ» و«ليس ازدواجاً» يُغلقانه. ومرجعان مختلفان يعنيان عمليّتين قطعاً.`}
          >
            {doublePaidSplit.open.length + doublePaidSplit.claimed.length === 0 ? (
              <p className="text-xs text-ok">كلّها حُسمت — لا مطالبة مفتوحة.</p>
            ) : (
              <ul className="space-y-2.5">
                {[...doublePaidSplit.open, ...doublePaidSplit.claimed].map((g) => (
                  <li key={doublePaidKey(g)}>
                    <DoublePaidCard group={g} decision={(doublePaidDecisions.get(doublePaidKey(g)) as DoublePaidDecision | undefined) ?? null} canEdit={canEdit} />
                  </li>
                ))}
              </ul>
            )}
            {doublePaidSplit.closed.length > 0 && (
              <details className="mt-3">
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs text-muted underline decoration-dotted underline-offset-4 sm:min-h-0">
                  ما حُسم ({countNoun(doublePaidSplit.closed.length, ITEM)})
                </summary>
                <ul className="mt-2 space-y-2.5">
                  {doublePaidSplit.closed.map(({ group: g, decision }) => (
                    <li key={doublePaidKey(g)}>
                      <DoublePaidCard group={g} decision={decision} canEdit={canEdit} />
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Section>
        </div>
      )}

      {groups.length > 0 && (
        <Section
          title="حلّ المعلّقات"
          hint="سؤالٌ واحد عن كلّ ما يتشابه، ثمّ ننتقل. وما تؤكّده يصير ذاكرة: يُطبَّق الآن على ما اخترتَه، ويُعرَف به ما يشبهه في الكشوف القادمة بلا سؤال."
        >
          <ReconcileQueue groups={groups} suppliers={supplierRows} canApprove={canApprove} canEdit={canEdit} />
        </Section>
      )}

      {recent.length > 0 && (
        <Section
          title="آخر ما قرّره المحرّك"
          hint={`${countNoun(n("auto"), ITEM)} طُوبقت تلقائياً · ${countNoun(n("suggest"), ITEM)} تنتظر تأكيدك. والدرجة ترجيحٌ لا يقين، فتُعرَض وصفاً لا نسبة.`}
        >
          <ul className="space-y-2.5">
            {recent.map((t) => {
              const explanation: MatchExplanation = {
                transactionId: t.id,
                disposition: t.matchDisposition,
                score: t.matchScore,
                outcome: t.matchOutcome,
                amountMinor: t.amountMinor,
                matched: t.matchedPaymentId !== null,
                evidence: t.matchEvidence as MatchExplanation["evidence"],
              };
              return (
                <li key={t.id} id={`tx-${t.id}`} className="scroll-mt-28">
                  <Card>
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold" dir="auto">
                          {t.description?.slice(0, 60) ?? "حركة"}
                        </span>
                        <span className="nums block truncate text-[11px] text-muted">
                          {t.valueDate.toISOString().slice(0, 10)} ·{" "}
                          {t.direction === "DEBIT" ? "صادر" : "وارد"} ·{" "}
                          {CATEGORY_LABEL[t.category] ?? t.category}
                        </span>
                      </span>
                      <span className="nums shrink-0 text-sm font-bold">
                        <Money minor={t.amountMinor} />
                      </span>
                    </div>
                    <MatchExplain match={explanation} canUndo={canApprove} />
                  </Card>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Section title="استيراد كشف" hint="الملف الذي استُورد من قبل لا يتكرّر — تُقيَّد الحركات الجديدة وحدها.">
        {canEdit
          ? <BankImport openInvoiceCount={n("open")} suppliers={supplierRows} />
          : <p className="text-xs text-muted">استيراد الكشف خارج صلاحيتك.</p>}
      </Section>
    </PageShell>
  );
}

/** بطاقةُ مالٍ خرج مرّتين — مراجعُه، والزائد، وقرارُ صاحب العمل فيه. */
function DoublePaidCard({
  group: g,
  decision,
  canEdit,
}: {
  group: DoublePaidGroup;
  decision: DoublePaidDecision | null;
  canEdit: boolean;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm font-bold" dir="auto">{g.payee}</span>
          <span className="block text-[11px] text-muted">
            <bdi className="nums">{g.day}</bdi> · {countNoun(g.transactions.length, TIME)} ·{" "}
            {CATEGORY_LABEL[g.category as keyof typeof CATEGORY_LABEL] ?? g.category}
            {g.distinctOperations ? " · بمراجعِ سدادٍ مختلفة" : " · بلا مرجعٍ يفصلهما — قد تكون نسخة استيراد"}
          </span>
          {decision && (
            <span className="mt-1 inline-block">
              <Badge tone={decision === "CLAIMED" ? "warn" : "ok"}>{DOUBLE_PAID_DECISION_LABEL[decision]}</Badge>
            </span>
          )}
        </span>
        <span className="shrink-0 text-end">
          <span className="block text-[11px] text-muted">الزائد</span>
          <span className={`nums block text-sm font-bold ${decision ? "text-ink-soft" : "text-danger"}`}><Money minor={g.excessMinor} /></span>
        </span>
      </div>
      <ul className="mt-2 space-y-1 border-s-2 border-line ps-2.5">
        {g.transactions.map((t) => (
          <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-2 text-[11px]">
            <span className="min-w-0 text-muted" dir="auto">
              المرجع: <bdi className="nums font-bold text-ink">{t.operationRef ?? "غير مذكور"}</bdi>
            </span>
            <span className="nums font-bold"><Money minor={t.amountMinor} /></span>
          </li>
        ))}
      </ul>
      <DoublePaidActions
        transactionIds={g.transactions.map((t) => t.id)}
        decision={decision}
        claimText={buildDoublePaidClaim(g)}
        canEdit={canEdit}
      />
    </Card>
  );
}
