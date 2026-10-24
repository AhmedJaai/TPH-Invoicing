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
import { partitionSnoozed, type SnoozedItem } from "./attention-snooze";
import { formatMoment, todayInRiyadh } from "./riyadh-time";
import { areaCounts, tabCounts } from "./nav";
import { can, type Capability, type Role } from "./permissions";
import { loadOpenIbanWatch } from "@/services/iban-guard.service";
import { groupIban } from "./bank/iban-guard";
import { loadMissingSettlementFacts } from "@/services/pos-watch.service";
import { loadRecurringAnomalies } from "@/services/recurring-watch.service";
import { loadDueObligations } from "@/services/obligation.service";
import { loadFoodicsAttentionFacts } from "@/services/foodics-attention.service";
import { loadFinanceAttentionFacts } from "@/services/finance-attention.service";
import { loadOrphanProformas } from "@/services/proforma-watch.service";
import { loadRepeatDeliveries } from "@/services/repeat-delivery.service";
import { loadPayrollAttentionFacts } from "@/services/payroll.service";
import { OBLIGATION_KIND_LABEL } from "./obligations";
import { loadSealDrift } from "@/services/month-seal.service";
import { loadLowAiBalance } from "@/services/daily-checks.service";
import { formatAiBalance } from "./ai/balance";

/** كلُّ البنود كما يبنيها `buildAttention` — قبل أن يُفرز المؤجَّل. */
const builtAttention = cache(async (): Promise<AttentionItem[]> => {
  /* حارسُ الآيبان وقائعُه مستقلّة — تُطلَب مع البقيّة لا بعدها */
  /* تُبدأ الآن وتُنتظر مع البقيّة — لا رحلةٌ بعد رحلة */
  const watchPromise = loadOpenIbanWatch();
  const [facts, iban, missingSettlements, recurringAnomalies, dueDocs, foodics, orphanProformas, finance, repeats, payroll, drift, aiLow] = await Promise.all([
    gatherAttentionFacts(), watchPromise.then((w) => w.alerts), loadMissingSettlementFacts(), loadRecurringAnomalies(), loadDueObligations(),
    loadFoodicsAttentionFacts(), loadOrphanProformas(), loadFinanceAttentionFacts(), loadRepeatDeliveries(),
    loadPayrollAttentionFacts(todayInRiyadh()),
    /* فحوصُ الصباح تُقرأ ولا تُعاد: آخرُ ما وجده `/api/cron/daily` */
    loadSealDrift(), loadLowAiBalance(),
  ]);
  const { first } = await watchPromise;
  return buildAttention({
    ...facts,
    missingSettlements,
    orphanProformas,
    repeatDeliveries: repeats.map((r) => ({
      supplierName: r.supplierName, firstNumber: r.first.number, secondNumber: r.second.number, gapDays: r.gapDays,
      atStakeMinor: r.atStakeMinor, bothPaid: r.bothPaid, foodicsReceipts: r.foodicsReceipts,
    })),
    foodicsCardGaps: foodics.cardGaps,
    foodicsPurchaseDiffers: foodics.purchaseDiffers,
    foodicsPurchaseMissing: foodics.purchaseMissing,
    financeRentLumps: finance.rentLumps,
    financeLastMonthMissing: finance.lastMonthMissing,
    payroll,
    stockLinksReady: finance.readyLinks,
    foodicsTillGaps: finance.tillGaps,
    foodicsStaleHours: finance.foodicsStaleHours,
    stockRecurringGaps: finance.recurring.map((g) => ({ productId: g.productId, name: g.name, kind: g.kind, months: g.months.length, totalMinor: g.totalMinor, byWitness: g.byWitness })),
    recurringAnomalies,
    expiringObligations: dueDocs.map((o) => ({ title: o.title, kindLabel: OBLIGATION_KIND_LABEL[o.kind], expiresOn: o.expiresOn, daysLeft: o.daysLeft })),
    ibanAlerts: iban.map((a) => ({
      label: a.supplierName.slice(0, 45),
      sub: `إلى ${groupIban(a.seenIban)}، والمعروف ${a.knownIbans.map(groupIban).join(" أو ")}`,
      amountMinor: a.totalMinor,
      href: `/suppliers/${a.supplierSlug}`,
    })),
    ibanAlertMinor: iban.reduce((s, a) => s + a.totalMinor, 0),
    firstTransfers: first.map((f) => ({
      label: (f.payee ?? "مستفيد غير معروف").slice(0, 45),
      sub: `إلى ${groupIban(f.iban)}`,
      amountMinor: f.totalMinor,
    })),
    firstTransferMinor: first.reduce((s, f) => s + f.totalMinor, 0),
    sealDrift: drift ? { checkedAt: formatMoment(drift.checkedAt), findings: drift.findings } : null,
    aiBalanceLow: aiLow ? {
      display: formatAiBalance({ known: true, cents: aiLow.cents, currency: aiLow.currency, available: aiLow.available }),
      available: aiLow.available,
      checkedAt: formatMoment(aiLow.checkedAt),
    } : null,
  });
});

/**
 * المفتوحُ والمؤجَّل («أجِّله إلى…»، `attention-snooze.ts`). المؤجَّلُ يخرج من العدّ
 * ولا يُخفى: تعرضه `/attention` في سطرٍ يُفتح، ويعود في يومه أو إن تغيّر مبلغُه.
 */
export const attentionSplit = cache(async (): Promise<{ active: AttentionItem[]; snoozed: SnoozedItem[] }> => {
  const [items, rows] = await Promise.all([
    builtAttention(),
    db.execute<{ key: string; decision: string; note: string | null }>(sql`
      select key, decision, note from alert_resolutions where key like 'attn:%'
    `),
  ]);
  return partitionSnoozed(items, rows.rows, todayInRiyadh());
});

/**
 * بندٌ يحتاج صلاحيةً (الرواتب للمالك وحده) لا يُعرض لمن لا يملكها — رابطٌ يفتح «لا صلاحية»
 * طريقٌ مسدود. والدورُ نفسُه يمرّ بالعدّاد والصفحة، فيبقى العددُ عددَ ما يُفتح.
 */
const visibleTo = (role: Role | undefined) => (i: { needs?: Capability }) => !i.needs || !role || can(role, i.needs);

export const attentionItems = cache(async (role?: Role): Promise<AttentionItem[]> => (await attentionSplit()).active.filter(visibleTo(role)));

/** ما أُجِّل من البنود — بيوم عودته وسببه. */
export const snoozedAttention = cache(async (role?: Role): Promise<SnoozedItem[]> => (await attentionSplit()).snoozed.filter((s) => visibleTo(role)(s.item)));

/** عددُ ما ينتظر قراراً — وهو عددُ بنود `/attention` نفسه. */
export const workCount = cache(async (role?: Role): Promise<number> => (await attentionItems(role)).length);

/** أين تقع البنودُ المفتوحة — نقطةٌ بجانب المساحة في الشريط (`areaCounts`). */
export const workByArea = cache(async (role?: Role): Promise<Record<string, number>> =>
  areaCounts((await attentionItems(role)).map((i) => i.href)));

/** وكم منها في كلّ لسانٍ داخل المساحة — عددٌ بجانب اسم اللسان (`tabCounts`). */
export const workByTab = cache(async (role?: Role): Promise<Record<string, number>> =>
  tabCounts((await attentionItems(role)).map((i) => i.href)));

/** مستنداتٌ لم يُبَتّ فيها — العدد الذي تفتحه «المستندات». */
export const inboxCount = cache(async (): Promise<number> => {
  const [row] = (
    await db.execute<{ n: number }>(sql`
      select count(*)::int as n from documents where status in ('PENDING','NEEDS_REVIEW')
    `)
  ).rows;
  return Number(row?.n ?? 0);
});
