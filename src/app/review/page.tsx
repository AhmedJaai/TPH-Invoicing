import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { NoAccess } from "@/components/ui";
import { ReviewWorkspace } from "@/components/review-workspace";
import { bankTransactions, suppliers } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { ReviewItem } from "@/lib/bank/review-queue";
import { pendingDecision } from "@/lib/bank/pending";
import { toCanonical } from "@/lib/bank/canonical";
import { asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

const LIMIT = 400;

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
  if (!user) redirect("/login?from=/review");
  if (!can(user.role, "bank:view")) {
    return (
      <PageShell user={user} width="wide" title="طابور المراجعة">
        <NoAccess what="طابور المراجعة" />
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
      transactionType: bankTransactions.transactionType,
      supplierId: bankTransactions.supplierId,
      supplierName: suppliers.nameAr,
    })
    .from(bankTransactions)
    .leftJoin(suppliers, eq(suppliers.id, bankTransactions.supplierId))
    /*
      ما ينتظر قراراً وحده — والتعريف في `pending.ts` يُستدعى ولا يُنسَخ.
      وكان هنا `lifecycle` وحدها، فبقيت في الطابور خمسُ حركاتٍ مدفوعةٍ
      بالفعل واثنتان وثلاثون أُعلن أنّها ليست سداداً: أسئلةٌ مُجابة
      تُعرَض معلَّقة، وزرُّ التأكيد عليها يردّه الخادمُ بحقّ.
    */
    .where(pendingDecision())
    .orderBy(desc(bankTransactions.amountMinor))
    .limit(LIMIT + 1);

  const supplierOptions = await db
    .select({ id: suppliers.id, nameAr: suppliers.nameAr })
    .from(suppliers)
    .where(eq(suppliers.isActive, true))
    .orderBy(asc(suppliers.nameAr));

  /* القصّ يُعلَن ولا يقع صامتاً — والشارة تعدّ الكلّ */
  const truncated = rows.length > LIMIT;
  if (truncated) rows.length = LIMIT;

  const items: ReviewItem[] = rows.map((r) => {
    const ev = (r.evidence ?? {}) as Record<string, unknown>;
    const reasons = Array.isArray(ev["مطابقة"]) ? (ev["مطابقة"] as string[]) : [];
    const why = typeof ev["تصنيف"] === "string" ? [ev["تصنيف"] as string] : [];

    const canonical = toCanonical({
      valueDate: r.valueDate,
      description: r.description,
      beneficiaryRaw: r.beneficiaryRaw,
      transactionType: r.transactionType,
      amountMinor: r.amountMinor,
      direction: r.direction as "DEBIT" | "CREDIT",
    });

    return {
      transactionId: r.id,
      valueDate: r.valueDate.toISOString().slice(0, 10),
      amountMinor: r.amountMinor,
      direction: r.direction,
      /*
        الوصف من البنك، والاسم من نصّه — وكان يُعرَض `beneficiary_raw`
        خاماً ويُحفَظ منه اسمُ الجهة، وهو ملوَّث في الصفوف القديمة.
      */
      description: r.description ?? "",
      beneficiary: canonical.beneficiary ?? null,
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      disposition: r.disposition,
      category: r.category,
      score: r.score,
      reasons: reasons.length > 0 ? reasons : why,
    };
  });

  return (
    <PageShell
      user={user}
      width="wide"
      title="طابور المراجعة"
      intro="ما ينتظر قرارك، مقسوماً على ثلاثة: ما تؤكّده دفعةً واحدة، وما يحتاج نظرةً منك، وجهاتٌ لم يعرفها النظام بعد."
    >
      {truncated && (
        <p className="mb-4 rounded-lg border border-warn/40 bg-warn-bg px-3 py-2 text-xs text-warn">
          يُعرض أكبر {LIMIT} بنداً بالمبلغ — وفي الطابور أكثر. احسم ما هنا ثمّ حدّث الصفحة.
        </p>
      )}
      <ReviewWorkspace
        suppliers={supplierOptions}
        items={items}
        canApprove={can(user.role, "payment:approve")}
        canEdit={can(user.role, "bank:edit")}
      />
    </PageShell>
  );
}
