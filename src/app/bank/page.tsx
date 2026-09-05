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
import { ReconcileQueue, type QueueItem } from "@/components/reconcile-queue";
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
      .limit(60),
  ]);

  /** يترجم ما قرّره المحرّك إلى سببٍ يُقرأ. */
  function reasonOf(t: (typeof pending)[number]): QueueItem["reason"] {
    if (t.matchOutcome === "PARTIAL_PAYMENT") return "PARTIAL_PAYMENT";
    if (t.matchOutcome === "OVERPAYMENT") return "OVERPAYMENT";
    if (t.matchOutcome === "AMOUNT_MISMATCH") return "AMOUNT_MISMATCH";
    if (t.matchDisposition === "SUGGEST") return "SUGGESTED";
    if (t.supplierId === null) return "UNKNOWN_ENTITY";
    return "CLOSE_CANDIDATES";
  }

  const queue: QueueItem[] = pending.map((t) => {
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
      guessName: null,
      guessKind: null,
      why: [ev?.تصنيف, ...(ev?.مستفيد ?? []), ...(ev?.مطابقة ?? [])]
        .filter((x): x is string => Boolean(x))
        .slice(0, 4),
    };
  });

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

      {queue.length > 0 && (
        <Section
          title="حلّ المعلّقات"
          hint="سؤالٌ واحد عن حركةٍ واحدة، ثمّ ننتقل. وما تؤكّده يصير ذاكرةً تعمّ على أمثاله، فيقصر الطابور من نفسه."
        >
          <ReconcileQueue items={queue} suppliers={supplierRows} />
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
