import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions, suppliers } from "@/db/schema";
import { ReviewWorkspace } from "./review-workspace";
import type { ReviewItem } from "@/lib/bank/review-queue";
import { pendingDecision } from "@/lib/bank/pending";
import { toCanonical } from "@/lib/bank/canonical";

/**
 * ورشةُ قرار حركات البنك — كانت صفحةً كاملة تُسمّى «طابور المراجعة».
 *
 * وكانت مساحةً في التنقّل، اسمُها يَعِد بأنّها مكان العمل الباقي —
 * وتُفتَح على بيانات أحمد فتقول **«لا شيء ينتظرك»** بينما تسعةُ بنودٍ
 * تنتظره في شاشةٍ أخرى، وخمسةَ عشرَ مستنداً في ثالثة. فالمكانُ المخصَّص
 * للعمل هو المكان الوحيد الفارغ منه.
 *
 * والسبب أنّها كانت تعرض بابًا واحداً من سبعةَ عشر: حركاتُ البنك التي
 * لم يُعرَف بابُها. فصارت ما هي: **لوحُ فعلٍ لبندٍ واحد** داخل «يحتاج
 * قرارك»، يظهر حين يكون ثمّة ما يُصنَّف ويغيب حين لا يكون.
 */
const LIMIT = 400;

export async function ReviewSection({
  canApprove,
  canEdit,
}: {
  canApprove: boolean;
  canEdit: boolean;
}) {
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
    /* التعريف في `pending.ts` يُستدعى ولا يُنسَخ. */
    .where(pendingDecision())
    .orderBy(desc(bankTransactions.amountMinor))
    .limit(LIMIT + 1);

  if (rows.length === 0) {
    return (
      <p className="text-xs text-ok">
        كلّ حركةٍ في الكشف لها قرارٌ مسجَّل — إمّا مطابَقة وإمّا معلَنٌ أنّها ليست سداداً.
      </p>
    );
  }

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
    <>
      {truncated && (
        <p className="mb-3 rounded-lg border border-warn/40 bg-warn-bg px-3 py-2 text-xs text-warn">
          يُعرض أكبر {LIMIT} بنداً بالمبلغ — وفي الطابور أكثر. احسم ما هنا ثمّ حدّث الصفحة.
        </p>
      )}
      <ReviewWorkspace
        suppliers={supplierOptions}
        items={items}
        canApprove={canApprove}
        canEdit={canEdit}
      />
    </>
  );
}
