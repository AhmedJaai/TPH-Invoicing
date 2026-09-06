import { redirect } from "next/navigation";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Card, EmptyState, Section, Stat, StatGrid } from "@/components/ui";
import { BankImport } from "@/components/bank-import";
import { MatchExplain, type MatchExplanation } from "@/components/match-explain";
import { ReconcileQueue, type QueueGroup, type QueueItem } from "@/components/reconcile-queue";
import { toCanonical } from "@/lib/bank/canonical";
import { groupByIdentity } from "@/lib/bank/pattern";
import { CATEGORY_LABEL } from "@/lib/bank/rules";
import { countNoun, ITEM } from "@/lib/arabic";

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
export default async function BankPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "bank:view")) {
    return (
      <PageShell user={user} width="wide" title="البنك">
        <EmptyState title="كشف البنك محجوب عن دورك." />
      </PageShell>
    );
  }

  const [counts, supplierRows, recent, pending] = await Promise.all([
    db.execute<Record<string, number>>(sql`
      select
        (select count(*)::int from bank_transactions)                                as tx,
        (select count(*)::int from bank_transactions
          where match_disposition = 'AUTO')                                         as auto,
        (select count(*)::int from bank_transactions
          where match_disposition = 'SUGGEST')                                      as suggest,
        (select count(*)::int from bank_transactions
          where match_disposition = 'REVIEW' or category = 'UNKNOWN')               as review,
        (select coalesce(sum(amount_minor),0)::bigint from bank_transactions
          where direction = 'CREDIT' and category = 'POS_SETTLEMENT')               as settled,
        (select count(*)::int from invoices i
          where i.total_minor > coalesce((select sum(pa.amount_minor)::int
            from payment_allocations pa where pa.invoice_id = i.id), 0) + 1)        as open
    `),

    db.select({ id: suppliers.id, nameAr: suppliers.nameAr })
      .from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.nameAr)),

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
      .where(sql`${bankTransactions.matchedPaymentId} is null
        and ${bankTransactions.matchStatus} <> 'IGNORED'
        and (
          ${bankTransactions.matchDisposition} in ('SUGGEST','REVIEW')
          or (${bankTransactions.category} = 'UNKNOWN'
              and ${bankTransactions.counterpartyId} is null
              and ${bankTransactions.direction} = 'DEBIT')
        )`)
      .orderBy(desc(bankTransactions.amountMinor))
      /*
        الحدّ يُرفَع لأنّ الوحدة صارت المجموعة لا الحركة: ستّون حركة
        قد تكون ثماني مجموعات. والقصّ عند ستّين كان يُخفي أنّ في
        القاعدة أخواتٍ لما يُسأل عنه — فيُجاب عن سبعٍ ويبقى ثمانٍ.
      */
      .limit(400),
  ]);

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

  const toItem = (t: (typeof pending)[number]): QueueItem => {
    const ev = t.matchEvidence as
      { تصنيف?: string; مستفيد?: string[]; مطابقة?: string[] } | null;
    return {
      id: t.id,
      date: t.valueDate.toISOString().slice(0, 10),
      amountMinor: t.amountMinor,
      direction: t.direction as "DEBIT" | "CREDIT",
      description: (t.description ?? "").slice(0, 160),
      beneficiaryRaw: t.beneficiaryRaw,
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
    (t) => toCanonical({
      valueDate: t.valueDate,
      description: t.description,
      beneficiaryRaw: t.beneficiaryRaw,
      transactionType: t.transactionType,
      amountMinor: t.amountMinor,
      direction: t.direction as "DEBIT" | "CREDIT",
    }),
    (t) => t.amountMinor,
  );

  const titleOf = (t: (typeof pending)[number]) =>
    t.beneficiaryRaw?.trim() || (t.description ?? "").trim().slice(0, 70) || "بلا وصف";

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
      <StatGrid>
        <Stat label="حركات مخزّنة" value={String(n("tx"))} sub="بعد إزالة المكرَّر" />
        <Stat
          label="تسويات الشبكة"
          minor={n("settled")}
          tone="ok"
          sub="إيراد البطاقات يصل حسابك"
        />
        <Stat
          label="تحتاج قرارك"
          value={String(n("review"))}
          tone={n("review") > 0 ? "warn" : "ok"}
          sub="مجهولة أو مرشّحان متقاربان"
        />
        <Stat
          label="فواتير مفتوحة"
          value={String(n("open"))}
          href="/payments"
          sub="ما زال عليها رصيد"
        />
      </StatGrid>

      {groups.length > 0 && (
        <Section
          title="حلّ المعلّقات"
          hint="سؤالٌ واحد عن كلّ ما يتشابه، ثمّ ننتقل. وما تؤكّده يصير ذاكرةً تعمّ على أمثاله — في الكشوف السابقة الآن، وفي القادمة بلا سؤال."
        >
          <ReconcileQueue groups={groups} suppliers={supplierRows} />
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
                <li key={t.id}>
                  <Card>
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold">
                          {t.beneficiaryRaw ?? t.description?.slice(0, 60) ?? "حركة"}
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
                    <MatchExplain match={explanation} />
                  </Card>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Section title="استيراد كشف" hint="الملف الذي استُورد من قبل لا يتكرّر — تُقيَّد الحركات الجديدة وحدها.">
        <BankImport openInvoiceCount={n("open")} suppliers={supplierRows} />
      </Section>
    </PageShell>
  );
}
