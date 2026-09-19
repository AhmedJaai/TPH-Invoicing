import { eq } from "drizzle-orm";
import { db } from "@/db";
import { alertResolutions, bankTransactions } from "@/db/schema";
import { Money } from "./money";
import { Badge, Card } from "./ui";
import { DoublePaidActions } from "./double-paid-actions";
import { CATEGORY_LABEL } from "@/lib/bank/rules";
import { ITEM, TIME, countNoun } from "@/lib/arabic";
import {
  buildDoublePaidClaim, doublePaidKey, findDoublePaid, partitionDoublePaid,
  type DoublePaidDecision, type DoublePaidGroup, type DoublePaidTx,
} from "@/lib/bank/double-paid";

/**
 * «سُدّد مرّتين» — موضعٌ واحد.
 *
 * كان معروضاً كاملاً في شاشتين: بنداً في «ما يحتاج انتباهك» بمبالغه
 * وأدلّته، وقسماً في «البنك» بالمبالغ نفسها والأزرار نفسها. فإن حسمه
 * صاحب المقهى في إحداهما ظنّ أنّ في الأخرى عملاً باقياً — والبند
 * الواحد الذي يُعرَض مرّتين يُعَدّ عملين.
 *
 * فصار هنا، ويُستدعى من «يحتاج قرارك» وحدها. وصفحةُ البنك تُحيل إليه
 * ولا تنسخه.
 */
export const DOUBLE_PAID_DECISION_LABEL: Record<DoublePaidDecision, string> = {
  CLAIMED: "طولِبَ بها",
  RECOVERED: "استُردَّ المال",
  NOT_DUPLICATE: "ليست ازدواجاً",
};

export async function loadDoublePaid() {
  const rows = await db
    .select({
      id: bankTransactions.id,
      valueDate: bankTransactions.valueDate,
      amountMinor: bankTransactions.amountMinor,
      description: bankTransactions.description,
      beneficiaryRaw: bankTransactions.beneficiaryRaw,
      category: bankTransactions.category,
      operationRef: bankTransactions.operationRef,
    })
    .from(bankTransactions)
    .where(eq(bankTransactions.direction, "DEBIT"));

  const groups = findDoublePaid(
    rows.map((r): DoublePaidTx => ({
      id: r.id,
      valueDate: r.valueDate,
      amountMinor: r.amountMinor,
      direction: "DEBIT",
      description: r.description,
      beneficiaryRaw: r.beneficiaryRaw,
      category: r.category,
      operationRef: r.operationRef,
    })),
  );

  /* جدولٌ صغير، ولا يُقرأ إن لم يكن ثمّة ازدواج. */
  const decisions = new Map(
    groups.length === 0
      ? []
      : (
          await db
            .select({ key: alertResolutions.key, decision: alertResolutions.decision })
            .from(alertResolutions)
        ).map((r) => [r.key, r.decision] as const),
  );

  return { groups, decisions, split: partitionDoublePaid(groups, decisions) };
}

export function DoublePaidCard({
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
          <span className={`nums block text-sm font-bold ${decision ? "text-ink-soft" : "text-danger"}`}>
            <Money minor={g.excessMinor} />
          </span>
        </span>
      </div>
      <ul className="mt-2 space-y-1 border-s-2 border-line ps-2.5">
        {g.transactions.map((t) => (
          <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-2 text-[11px]">
            <span className="min-w-0 text-muted" dir="auto">
              {/* `BANK_REF:` بادئةٌ داخليّة — وأحمد ينسخ الرقم ليطالب الجهة */}
              مرجع البنك: <bdi className="nums font-bold text-ink">{t.operationRef?.replace(/^[A-Z_]+:/, "") ?? "غير مذكور"}</bdi>
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

/** القائمة كاملةً: المفتوح والمطالَب به أوّلاً، وما حُسم مطويّ. */
export async function DoublePaidWorkspace({ canEdit }: { canEdit: boolean }) {
  const { decisions, split } = await loadDoublePaid();
  const openOrClaimed = [...split.open, ...split.claimed];

  return (
    <>
      {openOrClaimed.length === 0 ? (
        <p className="text-xs text-ok">كلّها حُسمت — لا مطالبة مفتوحة.</p>
      ) : (
        <ul className="space-y-2.5">
          {openOrClaimed.map((g) => (
            <li key={doublePaidKey(g)}>
              <DoublePaidCard
                group={g}
                decision={(decisions.get(doublePaidKey(g)) as DoublePaidDecision | undefined) ?? null}
                canEdit={canEdit}
              />
            </li>
          ))}
        </ul>
      )}
      {split.closed.length > 0 && (
        <details className="mt-3">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs text-muted underline decoration-dotted underline-offset-4 sm:min-h-0">
            ما حُسم ({countNoun(split.closed.length, ITEM)})
          </summary>
          <ul className="mt-2 space-y-2.5">
            {split.closed.map(({ group: g, decision }) => (
              <li key={doublePaidKey(g)}>
                <DoublePaidCard group={g} decision={decision} canEdit={canEdit} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
