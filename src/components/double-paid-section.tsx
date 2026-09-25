import { eq } from "drizzle-orm";
import { db } from "@/db";
import { alertResolutions, bankTransactions } from "@/db/schema";
import { Money } from "./money";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { Badge, Monogram } from "./ui";
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
    <div className="px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        <Monogram name={g.payee} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-bold" dir="auto">{g.payee}</span>
            {decision && (
              <Badge tone={decision === "CLAIMED" ? "warn" : "ok"} dot>{DOUBLE_PAID_DECISION_LABEL[decision]}</Badge>
            )}
          </span>
          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
            <bdi className="nums">{g.day}</bdi> · {countNoun(g.transactions.length, TIME)} ·{" "}
            {CATEGORY_LABEL[g.category as keyof typeof CATEGORY_LABEL] ?? g.category}
          </span>
        </span>
        <span className="shrink-0 text-end">
          <span className="block text-[11px] text-muted">الزائد</span>
          <span className={`block text-[15px] font-bold ${decision ? "text-ink-soft" : "text-danger"}`}>
            <Money minor={g.excessMinor} />
          </span>
        </span>
      </div>

      {/* الدليلُ الذي يُطالَب به: مرجعا السداد ومبلغاهما، ثمّ هل يفصل بينهما مرجع */}
      <div className="mt-3 rounded-lg border border-line-soft bg-sunken/60 sm:ms-11">
        <ul className="divide-y divide-line-soft">
          {g.transactions.map((t, n) => (
            <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-[11px]">
              <span className="min-w-0 text-muted" dir="auto">
                {n === 0 ? "الأولى" : n === 1 ? "الثانية" : `رقم ${n + 1}`} · مرجع البنك:{" "}
                {/* `BANK_REF:` بادئةٌ داخليّة — وأحمد ينسخ الرقم ليطالب الجهة */}
                <bdi className="nums font-bold text-ink">{t.operationRef?.replace(/^[A-Z_]+:/, "") ?? "غير مذكور"}</bdi>
              </span>
              <span className="text-xs font-bold"><Money minor={t.amountMinor} /></span>
            </li>
          ))}
        </ul>
        <p className={`flex items-start gap-1.5 border-t border-line-soft px-3 py-2 text-[11px] leading-relaxed ${g.distinctOperations ? "text-ink-soft" : "text-warn"}`}>
          {g.distinctOperations ? (
            <>
              <CircleCheck className="mt-0.5 h-3 w-3 shrink-0 text-ok" strokeWidth={2.25} aria-hidden />
              بمراجعِ سدادٍ مختلفة — عمليّتان لا نسخةُ استيراد.
            </>
          ) : (
            <>
              <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2.25} aria-hidden />
              بلا مرجعٍ يفصلهما — قد تكون نسخةَ استيراد؛ انظر في تطبيق البنك قبل المطالبة.
            </>
          )}
        </p>
      </div>

      <div className="sm:ps-11">
        <DoublePaidActions
          transactionIds={g.transactions.map((t) => t.id)}
          decision={decision}
          claimText={buildDoublePaidClaim(g)}
          canEdit={canEdit}
        />
      </div>
    </div>
  );
}

/** القائمة كاملةً: المفتوح والمطالَب به أوّلاً، وما حُسم مطويّ. */
export async function DoublePaidWorkspace({ canEdit }: { canEdit: boolean }) {
  const { decisions, split } = await loadDoublePaid();
  const openOrClaimed = [...split.open, ...split.claimed];

  return (
    <>
      {openOrClaimed.length === 0 ? (
        <p role="status" className="flex items-center gap-2 rounded-xl border border-ok/25 bg-ok-bg px-4 py-3 text-xs font-bold text-ok">
          <CircleCheck className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          كلّها حُسمت — لا مطالبة مفتوحة.
        </p>
      ) : (
        <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
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
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs font-bold text-muted hover:text-ink sm:min-h-0">
            ما حُسم ({countNoun(split.closed.length, ITEM)}) — يُفتح ثانيةً إن كان القرارُ خطأ
          </summary>
          <ul className="mt-2 divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised/70">
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
