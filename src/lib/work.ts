/**
 * العمل الباقي — تعريفٌ واحد، ومصدرٌ واحد، وعددٌ واحد.
 *
 * كان لسؤال «كم بقي عليّ؟» ثلاثةُ أجوبة في ثلاث شاشات: عدّادُ القشرة
 * يقول **صفراً**، والرئيسية تقول **تسعة**،
 * و«المستندات» تقول **خمسة عشر**. والثلاثة صحيحةٌ كلٌّ في بابه — لكنّ
 * صاحب المقهى لا يقرؤها أبواباً، يقرؤها جواباً واحداً يتناقض.
 *
 * وأخطرُها الصفر: العدّاد الوحيد الدائم في الشاشة كان يقول «لا شيء
 * ينتظرك» بينما تسعةُ بنودٍ حقيقيّة تنتظر، منها مالٌ خرج مرّتين.
 * **والصفرُ يُقرأ جواباً.**
 *
 * فصار العدد الظاهر في الشريط الجانبيّ هو عددَ بنود `/attention` نفسِها
 * — ما تفتحه الصفحة هو ما يقوله العدّاد، حرفاً بحرف. وشرطُ
 * `pendingDecision()` يبقى على حاله **مدخلاً** لبندٍ واحد من سبعةَ
 * عشر (حركاتٌ لم تُصنَّف)، لا عنواناً فوق التطبيق كلّه. وعدّادُه
 * المنفصل حُذف: صادرٌ لا يستدعيه شيء يُظنّ عاملاً فيُبنى عليه.
 *
 * و`cache()` من React تجعل الحقائق تُجلَب مرّةً في الطلب الواحد: تقرؤها
 * القشرةُ لعدّادها، وتقرؤها الرئيسيةُ وصفحةُ «يحتاج قرارك» لمحتواهما،
 * فلا تُستعلَم القاعدةُ ثلاثاً عن الشيء نفسه.
 */
import { cache } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { buildAttention, type AttentionItem } from "./attention";
import { gatherAttentionFacts } from "./attention-facts";

export const attentionItems = cache(
  async (): Promise<AttentionItem[]> => buildAttention(await gatherAttentionFacts()),
);

/** عددُ ما ينتظر قراراً — وهو عددُ بنود `/attention` نفسه. */
export const workCount = cache(async (): Promise<number> => (await attentionItems()).length);

/** مستنداتٌ لم يُبَتّ فيها — العدد الذي تفتحه «المستندات». */
export const inboxCount = cache(async (): Promise<number> => {
  const [row] = (
    await db.execute<{ n: number }>(sql`
      select count(*)::int as n from documents where status in ('PENDING','NEEDS_REVIEW')
    `)
  ).rows;
  return Number(row?.n ?? 0);
});
