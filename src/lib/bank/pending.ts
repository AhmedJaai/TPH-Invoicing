import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions } from "@/db/schema";

/**
 * ما ينتظر قرار الإنسان — **تعريفٌ واحد**.
 *
 * كان لسؤالٍ واحد ثلاثةُ أجوبة، ولكلٍّ منها شاشة. ثمّ وُضع
 * `countPendingWork()` ليوحّدها — ونُسخ فيه **الشرط الخاطئ**:
 * ‏`lifecycle in ('RAW','INFERRED','SUGGESTED')` وحده. و`lifecycle`
 * طبقةٌ تصف رحلة الحركة، لا حالَ القرار فيها؛ فبقيت في الطابور:
 *
 *   • **خمسُ حركاتٍ مطابَقةٌ ومدفوعة** — لها دفعة وتخصيصاتها مكتوبة،
 *     ولم تتقدّم `lifecycle` من `RAW`. فتُعرَض «تنتظر تأكيدك» وهي
 *     مقضيّة، وزرُّ التأكيد يردّها الخادمُ بحقّ: «مطابَقة أصلاً».
 *   • **اثنتان وثلاثون حركة `IGNORED`** — رسومُ شبكة وضرائبُها ورواتب،
 *     أُعلن أنّها ليست سداداً. وهي **قرارٌ تامّ** لا سؤالٌ معلَّق.
 *
 * فالشرط الصحيح يجمع أربعة: لا دفعةَ لها، ولا أُعلنت ليست سداداً، ولا
 * بلغت طبقةً نهائية، ولا حَكَم فيها إنسان. وهو نفسه شرطُ صفحة البنك —
 * **والتعريف يُكتب مرّةً ويُستدعى**، وإلّا عاد الاختلاف من حيث أُغلق.
 */
export function pendingDecision(): SQL {
  return sql`${bankTransactions.matchedPaymentId} is null
    and ${bankTransactions.matchStatus} <> 'IGNORED'
    and ${bankTransactions.lifecycle} not in ('CONFIRMED','POSTED')
    and ${bankTransactions.classificationSource} is distinct from 'HUMAN'`;
}

export async function countPendingWork(): Promise<number> {
  const [row] = (
    await db.execute<{ n: number }>(sql`
      select count(*)::int as n
      from ${bankTransactions}
      where ${pendingDecision()}
    `)
  ).rows;

  return Number(row?.n ?? 0);
}
