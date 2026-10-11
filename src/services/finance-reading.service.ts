/**
 * القراءةُ الذكيّة لشهر — تجمع الحقائقَ من الخدمات نفسِها التي تعرضها الشاشات، تنادي
 * النموذج مرّةً، تتحقّق من أرقامه، وتحفظ الناتجَ بمدخلاته (`finance_readings`).
 *
 * لا تُولَّد عند فتح الصفحة: تُطلَب بزرّ، وتُقرأ بعدها محفوظةً. وإن تغيّرت الأرقامُ بعدها
 * قيل «الأرقامُ تغيّرت منذ هذه القراءة» — لا تُعرَض قراءةٌ قديمة على أنّها عن أرقام اليوم.
 * وفشلُها لا يمسّ الصفحة: الأرقامُ كاملةٌ دونها.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { financeReadings } from "@/db/schema";
import { callDeepseek, parseJsonLoose } from "@/lib/ai/deepseek";
import { isDeepseekConfigured } from "@/lib/ai/models";
import { CATEGORY_LABEL } from "@/lib/bank/rules";
import { buildReadingMessages, FactList, factsHash, readingIsFull, validateReading, type Fact, type Reading } from "@/lib/finance/reading";
import { daysInMonth, formatMonth } from "@/lib/riyadh-time";
import { loadPnl, loadPnlSeries, loadSpreadCandidates, type PnlView } from "./profit.service";
import { coverageAfterReady, loadStockLinks } from "./stock-link.service";
import { loadSalesAnalysis, type SalesAnalysis } from "./sales-analysis.service";
import { loadMonthStockFlow, type StockFlow } from "./stock-flow.service";

const SCOPE = "pnl";

/** نسبةُ التغيّر بنقاط الأساس — `null` بلا سابق. */
function changeBp(now: number | null, before: number | null): number | null {
  return now === null || before === null || before <= 0 ? null : Math.round(((now - before) * 10_000) / before);
}

/** ما لا يُعرَف من الدفاتر ويُعطى للنموذج «إجراءً متاحاً»: فعلٌ يقدر عليه صاحبُه في التطبيق. */
export interface ReadingActions {
  /** إيجارٌ في الكشف لم يُوزَّع على أشهره. */
  rentLumps: { day: string; amountMinor: number }[];
  /** ربطٌ جاهزٌ بدليل فودكس. */
  readyLinks: { count: number; valueMinor: number; afterBp: number | null };
}

/** متوسّطُ قيمٍ معروفة — `null` إن لم يُعرَف منها اثنتان. */
function average(values: readonly (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length < 2 ? null : Math.round(known.reduce((s, v) => s + v, 0) / known.length);
}

/**
 * حقائقُ الشهر للنموذج. تُرتَّب بما يسأل عنه صاحبُ المقهى: أكتمل الشهر؟ كم ربحتُ؟ ما الذي
 * تغيّر ولماذا؟ ماذا أفعل؟ — و**المقارنةُ بمتوسّط ثلاثة أشهرٍ** لا بالسابق وحده: أوّلُ قراءةٍ
 * حقيقيّة قالت «راجِع فاتورةَ الكهرباء، ارتفعت من ٢٦٢ إلى ٢٬٤٣٢» وأغسطس هو الشاذّ لا سبتمبر.
 */
export function buildMonthFacts(view: PnlView, earlier: readonly PnlView[], sales: SalesAnalysis, flow: StockFlow, actions: ReadingActions): Fact[] {
  const f = new FactList();
  const m = formatMonth(view.month).replace(/\s+\d{4}$/, "");
  const previous = earlier[0] ?? null;
  const pm = previous ? formatMonth(previous.month).replace(/\s+\d{4}$/, "") : null;
  const p = view.pnl;
  const open = view.input.open;
  const baseline = "متوسّط الأشهر الثلاثة السابقة";
  /* شهرٌ ناقصُ الأيّام (شهرُ الافتتاح) لا يدخل متوسّطاً ولا يُقارَن به: يونيو «قفز ٩٠٪» عن مايو ذي ٢٢ يوماً */
  const whole = (v: PnlView) => v.revenue !== null && v.revenue.expectedDays >= daysInMonth(v.month);
  const three = earlier.filter(whole).slice(0, 3);
  const previousWhole = previous !== null && whole(previous);

  /* ── اكتمالُ الشهر أوّلاً: النموذجُ يعرف ما ينقص قبل أن يقرأ رقماً ── */
  f.note(`اسمُ رقم الربح في ${m}`, p.profitLabel);
  f.note(`اكتمالُ ${m}`, p.complete ? "مكتمل: لا ينقصه عنصرٌ أساسيّ" : `غير مكتمل — ${p.gaps.map((g) => g.label).join(" · ") || "—"}`);
  f.sar(`${p.profitLabel} في ${m}`, p.profitMinor);
  f.pct(`هامشُ «${p.profitLabel}» من الإيراد`, p.netMarginBp);

  /* ── الإيراد وما حرّكه ── */
  f.sar(`الإيراد بلا ضريبة في ${m}`, p.revenueMinor);
  if (!open) {
    f.sar(`الإيراد — ${baseline}`, average(three.map((v) => v.pnl.revenueMinor)));
    if (previous && pm && previousWhole) f.pct(`تغيّرُ الإيراد عن ${pm}`, changeBp(p.revenueMinor, previous.pnl.revenueMinor));
    if (previous && pm && !previousWhole) f.note(`${pm}`, `شهرٌ ناقصُ الأيّام (${previous.revenue?.expectedDays ?? 0} يوماً — شهرُ الافتتاح): لا يُقارَن به مجموعٌ، ولا يُقال «قفز» أو «هبط» عنه`);
  }
  const rev = view.revenue;
  const prevRev = previous?.revenue ?? null;
  if (rev && rev.orders > 0) {
    f.count(`عددُ الطلبات في ${m}`, rev.orders);
    f.sar(`متوسّطُ الطلب في ${m} (شاملاً الضريبة)`, Math.round(rev.paidMinor / rev.orders));
    if (prevRev && prevRev.orders > 0 && pm && !open && previousWhole) {
      const prevTicket = Math.round(prevRev.paidMinor / prevRev.orders);
      f.count(`عددُ الطلبات في ${pm}`, prevRev.orders);
      f.sar(`متوسّطُ الطلب في ${pm}`, prevTicket);
      /* تفكيكُ تغيّر ما دفعه الزبائن: ما جاء من عدد الطلبات وما جاء من حجم الطلب */
      const fromOrders = (rev.orders - prevRev.orders) * prevTicket;
      const fromTicket = rev.paidMinor - prevRev.paidMinor - fromOrders;
      f.sar(`أثرُ ${rev.orders >= prevRev.orders ? "زيادة" : "نقص"} عدد الطلبات على ما دفعه الزبائن عن ${pm}`, Math.abs(fromOrders));
      f.sar(`أثرُ ${fromTicket >= 0 ? "كِبَر" : "صِغَر"} متوسّط الطلب على ما دفعه الزبائن عن ${pm}`, Math.abs(fromTicket));
    }
  }
  const busiest = [...sales.hours].sort((a, b) => b.paidMinor - a.paidMinor)[0];
  if (busiest) {
    f.count("الساعةُ الأنشط في اليوم (بتوقيت ٢٤ ساعة)", busiest.hour);
    f.sar("مبيعاتُ الساعة الأنشط في الشهر كلِّه", busiest.paidMinor);
  }
  f.sar("مبيعاتٌ نقديّة (لا تدخل البنك ولا يراها الكشف)", rev?.cashMinor ?? null);

  /* ── التكلفة والهامش ── */
  f.note("طريقةُ تكلفة المبيعات", p.cogsMethod === "STOCK" ? "بالجرد: مشتريات + مخزونُ أوّل الشهر − مخزونُ آخره" : p.cogsMethod === "PURCHASES" ? "مشترياتُ الشهر — لا عدَّ يفصل المخزون، فليست تكلفةَ ما بِيع" : "غير معروفة");
  f.sar(`تكلفةُ المبيعات في ${m}`, p.cogsMinor);
  f.pct(`هامشُ مجمل الربح في ${m}`, p.grossMarginBp);
  f.pct(`هامشُ مجمل الربح — ${baseline}`, average(three.map((v) => v.pnl.grossMarginBp)));
  f.sar("الاستهلاكُ النظريّ من الوصفات (ما كان ينبغي أن يُصرَف)", view.input.cogs.theoreticalMinor);
  if (p.unexplainedMinor !== null) {
    f.sar(p.unexplainedMinor >= 0
      ? "فرقٌ غير مفسَّر: خرج من الرفّ أكثر ممّا تفسّره الوصفات (هدرٌ لم يُسجَّل، وصفةٌ أصغر من الواقع، أو تسريب)"
      : "خطأُ بيانات: الوصفاتُ تقول أكثر ممّا خرج من الرفّ (فاتورةُ شراءٍ لم تُقيَّد، أو وصفةٌ أكبر من الواقع، أو عدٌّ خاطئ)", Math.abs(p.unexplainedMinor));
    const before = average(three.map((v) => (v.pnl.unexplainedMinor === null ? null : Math.abs(v.pnl.unexplainedMinor))));
    if (before !== null) f.sar(`حجمُ الفرق بين الجرد والوصفات — ${baseline}`, before);
  }
  f.sar("مشروباتُ الموظّفين بتكلفتها (استهلاكٌ بلا إيراد)", view.input.cogs.staffMinor);
  f.sar("هدرٌ مسجَّل في سجلّ الهدر", view.input.cogs.wasteMinor);

  /* ── المصروفات: كلُّ فئةٍ بجانب عادتها ── */
  for (const o of p.opexByCategory.filter((x) => x.amountMinor >= 100_00).slice(0, 6)) {
    f.sar(`مصروف «${o.label}» في ${m}`, o.amountMinor);
    const usual = average(three.map((v) => v.pnl.opexByCategory.find((x) => x.category === o.category)?.amountMinor ?? null));
    if (usual !== null && !open) f.sar(`مصروف «${o.label}» — ${baseline}`, usual);
  }
  for (const gap of ["RENT", "SALARY"] as const) {
    if (p.gaps.some((g) => g.id === gap)) f.note(`مصروف «${CATEGORY_LABEL[gap]}» في ${m}`, "غير معروف: لا شيءَ مقيَّدٌ في الكشف ولا بإقرار المالك — ليس صفراً");
  }
  f.sar(`مجموعُ المصروفات التشغيليّة المعروفة في ${m}`, p.opexMinor);
  f.sar("تحويلاتٌ شخصيّة للمالك من حساب المقهى (ليست مصروفاً)", view.input.ownerDrawsMinor);

  /* ── ما صعد وما هبط وما هامشُه ضعيف ── */
  if (!open && pm && previousWhole) {
    const movers = sales.items.filter((i) => i.previousSalesMinor !== null).map((i) => ({ ...i, delta: i.salesMinor - (i.previousSalesMinor ?? 0) }));
    for (const i of [...movers].filter((x) => x.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3)) {
      f.sar(`صعدت مبيعاتُ «${i.name}» عن ${pm} بـ`, i.delta);
    }
    for (const i of [...movers].filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 3)) {
      f.sar(`هبطت مبيعاتُ «${i.name}» عن ${pm} بـ`, -i.delta);
    }
  }
  for (const item of sales.items.slice(0, 3)) {
    f.sar(`مبيعاتُ «${item.name}» (من الأعلى مبيعاً)`, item.salesMinor);
    if (item.marginBp !== null) f.pct(`هامشُ «${item.name}»`, item.marginBp);
  }
  const weak = sales.items.filter((i) => i.marginBp !== null && i.salesMinor >= 100_000).sort((a, b) => (a.marginBp ?? 0) - (b.marginBp ?? 0)).slice(0, 3);
  for (const item of weak) {
    f.pct(`هامشُ «${item.name}» (من أضعف الهوامش)`, item.marginBp);
    f.sar(`مبيعاتُ «${item.name}» (ضعيف الهامش)`, item.salesMinor);
    if (item.costMinor !== null) f.sar(`كلفةُ ما بِيع من «${item.name}»`, item.costMinor);
  }
  f.sar("خصوماتُ الطلبات", sales.leaks.discountMinor);
  f.sar("ما رُدّ للزبائن", sales.leaks.refundsMinor);

  /* ── المشترى مقابل المباع ── */
  f.pct("تغطيةُ ربط بنود الفواتير بأصناف المخزون (دونها تبقى مشترياتُ الصنف «غير معروفة»)", flow.coverage.bp);
  const byGap = flow.items
    .map((x) => ({ name: x.name, minor: x.unexplainedMinor ?? x.witnessUnexplainedMinor, witness: x.unexplainedMinor === null }))
    .filter((x): x is { name: string; minor: number; witness: boolean } => x.minor !== null && x.minor > 0)
    .sort((a, b) => b.minor - a.minor).slice(0, 4);
  for (const x of byGap) {
    f.sar(`فرقٌ غير مفسَّر (نقص) في «${x.name}»${x.witness ? " — بمشتريات فودكس لا بفواتيرنا" : ""}`, x.minor);
  }

  /* ── إجراءاتٌ متاحة: ما يقدر عليه صاحبُه في التطبيق الآن ── */
  for (const lump of actions.rentLumps.slice(0, 2)) {
    f.sar(`إجراءٌ متاح — وزِّع على أشهرها دفعةَ إيجارٍ خرجت من الكشف يوم ${lump.day.slice(8, 10)}/${lump.day.slice(5, 7)} ولم يُقَل كم شهراً تغطّي (من «ما لا يراه الكشف»)`, lump.amountMinor);
  }
  if (actions.readyLinks.count > 0) {
    f.count("إجراءٌ متاح — عددُ بنود الفواتير الجاهزة للربط بضغطة (بدليل فودكس)", actions.readyLinks.count);
    f.sar("قيمةُ مشتريات البنود الجاهزة للربط", actions.readyLinks.valueMinor);
    f.pct("نسبةُ المربوط من قيمة المشتريات كلَّ الوقت بعد إقرار الجاهز", actions.readyLinks.afterBp);
  }
  if (view.input.cogs.wasteMinor === 0) f.note("إجراءٌ متاح", "سجلُّ الهدر فارغٌ هذا الشهر: ما يُرمى ولا يُكتب يبقى داخل الفرق غير المفسَّر — يُسجَّل من «الجرد»");
  return f.facts;
}

export interface StoredReading {
  reading: Reading;
  facts: Fact[];
  model: string;
  createdAt: Date;
  /** الأرقامُ اليوم غيرُ ما قُرئ — القراءةُ قديمة. */
  stale: boolean;
}

async function gatherFacts(month: string): Promise<Fact[]> {
  const series = await loadPnlSeries();
  const view = series.find((v) => v.month === month) ?? await loadPnl(month);
  /* الأشهرُ السابقة التي فيها مبيعات، الأحدثُ أوّلاً */
  const earlier = series.filter((v) => v.month < month && v.revenue !== null);
  const [sales, flow, links, rent] = await Promise.all([
    loadSalesAnalysis(month),
    loadMonthStockFlow(month),
    loadStockLinks(),
    loadSpreadCandidates("RENT"),
  ]);
  return buildMonthFacts(view, earlier, sales, flow, {
    rentLumps: rent.filter((t) => !t.spread).map((t) => ({ day: t.day, amountMinor: t.amountMinor })),
    readyLinks: { count: links.readyCount, valueMinor: links.readyMinor, afterBp: coverageAfterReady(links).afterBp },
  });
}

/** الحقائقُ كما تُعطى للنموذج — لنصّ التقييم (`scripts/finance-reading-eval.ts`). */
export const gatherFactsForDebug = gatherFacts;

/**
 * أتغيّرت أرقامُ الشهر منذ كُتبت القراءة؟ — يُقارَن ربحُ اليوم واسمُه وإيرادُه بما في حقائقها.
 * رخيصٌ عمداً: لا تُعاد جمعُ الحقائق كلِّها عند كلّ فتحٍ لتُعرَف القراءةُ القديمة.
 */
export function readingIsStale(facts: readonly Fact[], view: PnlView): boolean {
  const riyals = (minor: number | null) => (minor === null ? null : Math.round(minor / 100));
  const valueOf = (prefix: string) => facts.find((f) => f.kind === "SAR" && f.label.startsWith(prefix))?.value;
  const profit = valueOf(`${view.pnl.profitLabel} في`);
  const revenue = valueOf("الإيراد بلا ضريبة في");
  return profit === undefined || revenue === undefined || profit !== riyals(view.pnl.profitMinor) || revenue !== riyals(view.pnl.revenueMinor);
}

/** آخرُ قراءةٍ محفوظة للشهر — بلا نداء. و`view` قائمةُ دخل اليوم: بها تُعرَف القراءةُ القديمة. */
export async function loadStoredReading(month: string, view: PnlView | null = null): Promise<StoredReading | null> {
  const [row] = await db.select().from(financeReadings)
    .where(and(eq(financeReadings.scope, SCOPE), eq(financeReadings.month, month)))
    .orderBy(desc(financeReadings.createdAt)).limit(1);
  if (!row) return null;
  /* كُتبا من `generateReading` بشكلَيهما هذين */
  const facts = row.facts as Fact[];
  return { reading: row.reading as Reading, facts, model: row.model, createdAt: row.createdAt, stale: view !== null && readingIsStale(facts, view) };
}

export type ReadingOutcome =
  | { ok: true; stored: StoredReading }
  | { ok: false; status: number; reason: string };

export async function generateReading(month: string, actorId: string | null, deadlineMs = 45_000): Promise<ReadingOutcome> {
  if (!isDeepseekConfigured()) return { ok: false, status: 503, reason: "مفتاحُ الذكاء غير مضبوط — الأرقامُ كاملةٌ دونه." };
  const facts = await gatherFacts(month);
  if (!facts.some((x) => x.kind === "SAR" && x.value !== null)) return { ok: false, status: 409, reason: "لا أرقامَ معروفةً لهذا الشهر تُقرأ." };

  const { system, user } = buildReadingMessages(formatMonth(month).replace(/\s+\d{4}$/, ""), facts);
  /* محاولتان على الأكثر: جوابُ النموذج يتفاوت — مرّةً ثلاثُ جُمل ومرّةً عشر — فيُؤخَذ الأوفى */
  let best: { reading: Reading; model: string } | null = null;
  let failure: ReadingOutcome | null = null;
  const perAttempt = Math.floor(deadlineMs / 2);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await callDeepseek({
      task: "REASONING",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      json: true, maxTokens: 2500, thinking: false, timeoutMs: perAttempt,
    });
    if (!result.ok) {
      failure = {
        ok: false, status: result.kind === "NO_BALANCE" ? 402 : 502,
        reason: result.kind === "NO_BALANCE" ? "رصيدُ حساب الذكاء نفد — يُشحَن ثمّ تُعاد القراءة." : result.truncated ? "انقطع جوابُ الذكاء قبل أن يكتمل — أعِد المحاولة." : `تعذّرت القراءة: ${result.reason}`,
      };
      /* رصيدٌ نافد أو مفتاحٌ غائب لا تصلحه محاولةٌ ثانية */
      if (result.kind === "NO_BALANCE" || result.kind === "NOT_CONFIGURED") break;
      continue;
    }
    const json = parseJsonLoose(result.text);
    if (!json.ok) { failure = { ok: false, status: 502, reason: "جوابُ الذكاء ليس JSON يُقرأ — أعِد المحاولة." }; continue; }
    const reading = validateReading(json.value, facts);
    if (best === null || reading.sentences.length > best.reading.sentences.length) best = { reading, model: result.model };
    if (readingIsFull(reading)) break;
  }
  if (best === null) return failure ?? { ok: false, status: 502, reason: "تعذّرت القراءة." };
  const { reading, model } = best;
  if (reading.sentences.length === 0) {
    return { ok: false, status: 502, reason: "لم تبقَ جملةٌ واحدة بعد التحقّق من أرقامها — لم تُحفَظ القراءة." };
  }
  const hash = factsHash(facts);
  const [row] = await db.insert(financeReadings)
    .values({ scope: SCOPE, month, factsHash: hash, facts, reading, model, createdById: actorId })
    .returning({ createdAt: financeReadings.createdAt });
  return { ok: true, stored: { reading, facts, model, createdAt: row.createdAt, stale: false } };
}
