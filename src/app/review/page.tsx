import { redirect } from "next/navigation";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/ui";
import { ReviewWorkspace } from "@/components/review-workspace";
import { bankTransactions, suppliers } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { ReviewItem } from "@/lib/bank/review-queue";

export const dynamic = "force-dynamic";

/**
 * طابور المراجعة — مكانٌ واحد لكلّ ما ينتظر قراراً.
 *
 * وكان مبعثراً على شاشات: في «البنك»، وفي «ما يحتاج انتباهك»، وفي
 * نتيجة استيرادٍ تضيع بإغلاقها. فلا يعرف صاحب العمل كم بقي عليه.
 *
 * والمعروض هنا **ما لم يُحسَم**: الحركة التي طُوبقت لها قرارٌ مسجَّل،
 * والتي أُعلنت «ليست سداداً» لها قرارٌ تامّ. وكلتاهما خارج الطابور —
 * وكان إبقاؤهما فيه يُنفّخه بما فُرغ منه.
 */
export default async function ReviewPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "bank:view")) {
    return (
      <PageShell user={user} width="wide" title="طابور المراجعة">
        <EmptyState title="طابور المراجعة محجوب عن دورك." />
      </PageShell>
    );
  }

  const rows = await db
    .select({
      id: bankTransactions.id,
      valueDate: bankTransactions.valueDate,
      description: bankTransactions.description,
      beneficiaryRaw: bankTransactions.beneficiaryRaw,
      amountMinor: bankTransactions.amountMinor,
      direction: bankTransactions.direction,
      category: bankTransactions.category,
      disposition: bankTransactions.matchDisposition,
      score: bankTransactions.matchScore,
      evidence: bankTransactions.matchEvidence,
      supplierName: suppliers.nameAr,
    })
    .from(bankTransactions)
    .leftJoin(suppliers, eq(suppliers.id, bankTransactions.supplierId))
    /*
      ما ينتظر قراراً وحده: لا مُقيَّدة ولا مُقَرَّة.
      و`lifecycle` هي المصدر — لا `match_status` و`match_disposition`
      معاً، فهما يصفان من جهتين لا تُقرآن معاً.
    */
    .where(sql`${bankTransactions.lifecycle} in ('RAW', 'INFERRED', 'SUGGESTED')`)
    .orderBy(desc(bankTransactions.amountMinor))
    .limit(400);

  const items: ReviewItem[] = rows.map((r) => {
    const ev = (r.evidence ?? {}) as Record<string, unknown>;
    const reasons = Array.isArray(ev["مطابقة"]) ? (ev["مطابقة"] as string[]) : [];
    const why = typeof ev["تصنيف"] === "string" ? [ev["تصنيف"] as string] : [];

    return {
      transactionId: r.id,
      valueDate: r.valueDate.toISOString().slice(0, 10),
      amountMinor: r.amountMinor,
      direction: r.direction,
      description: r.beneficiaryRaw ?? r.description ?? "",
      supplierName: r.supplierName,
      disposition: r.disposition,
      category: r.category,
      score: r.score,
      reasons: reasons.length > 0 ? reasons : why,
      candidateCount: reasons.length > 0 ? 1 : 0,
    };
  });

  return (
    <PageShell
      user={user}
      width="wide"
      title="طابور المراجعة"
      intro="ثلاثة أعمالٍ لا عملٌ واحد: ما يُختَم في ثوانٍ، وما يحتاج عينك، وما يحتاج تعريفاً. وخلطُها في عددٍ واحد يُرهب ولا يُرشد."
    >
      <ReviewWorkspace items={items} canApprove={can(user.role, "payment:approve")} />
    </PageShell>
  );
}
