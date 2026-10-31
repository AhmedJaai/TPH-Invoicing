/**
 * أدواتُ المستشار — ما يفتحه من الدفاتر قبل أن يجيب، كما يفتح موظّفٌ الملفّ.
 *
 * كلُّ أداةٍ قراءةٌ من الخدمات نفسِها التي تعرضها الشاشات (رقمٌ واحد بجوابٍ واحد)،
 * وتُرجع **حقائق** (`Fact`) لا نصّاً حرّاً: النموذجُ يرى أسماءها وقيمها، ثمّ تُطابَق
 * أرقامُ جوابه عليها. ولا أسعارَ مورّدين ولا أسعارَ بنود (أحمد، ٣١ أكتوبر ٢٠٢٦: «لا تُدخل
 * ارتفاع الأسعار — أرقامه مضلّلة») ولا هوامشَ أصنافٍ تقوم عليها. والكتابةُ الوحيدة بندٌ في
 * خطّته — نصٌّ لا مال.
 */
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { advisorPlanItems, suppliers } from "@/db/schema";
import { FactList, type Fact } from "@/lib/finance/reading";
import { BENCHMARKS, verdictOf, type BenchmarkKey } from "@/lib/finance/performance";
import { CATEGORY_LABEL, isTxCategory } from "@/lib/bank/rules";
import { DAY, INVOICE, ORDER, PAYMENT, SUPPLIER, countNoun } from "@/lib/arabic";
import { addDays, currentMonthRiyadh, formatMonth, isoDay, todayInRiyadh } from "@/lib/riyadh-time";
import type { DeepseekTool } from "@/lib/ai/deepseek";
import { loadPnl, visibleOpexRows } from "./profit.service";
import { kpiOf, loadServiceSpeed, loadReturnsWitness } from "./performance.service";
import { loadSalesAnalysis } from "./sales-analysis.service";
import { loadCashOutlook } from "./cash-outlook.service";
import { loadBalanceTotals, loadOverdueBalances } from "./supplier-balance.service";
import { loadPayrollMonth } from "./payroll.service";
import { listCounts } from "./inventory.service";
import { loadWasteBoard } from "./waste-board.service";
import { loadPnlSeries } from "./profit.service";
import type { Role } from "@/lib/permissions";

export interface ToolContext {
  userId: string;
  role: Role;
  canSeePayroll: boolean;
  threadId: string;
}

export interface ToolResult {
  facts: Fact[];
  /** ما يُقال لصاحب المقهى وهو ينتظر: «يراجع ربح سبتمبر». */
  label: string;
}

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

/** نصُّ الحقائق كما يقرؤها النموذج — السطرُ «الاسم: القيمة». */
export function renderFacts(facts: readonly Fact[]): string {
  return facts.map((f) => {
    const v = f.kind === "NOTE" ? f.note ?? "" : f.value === null ? "غير معروف" : f.kind === "SAR" ? `${f.value} ريال` : f.kind === "PCT" ? `${f.value}٪` : String(f.value);
    return `- ${f.label}: ${v}`;
  }).join("\n");
}

/** مؤشّراتُ كلّ شهر — تُعطى في الإحاطة وتُطلب أداةً كذلك. */
export async function monthsOverviewFacts(): Promise<Fact[]> {
  const series = (await loadPnlSeries()).map(kpiOf).sort((a, b) => a.month.localeCompare(b.month));
  const f = new FactList();
  for (const k of series) {
    const m = `${formatMonth(k.month)}${k.open ? " (حتى اليوم)" : ""}`;
    f.sar(`${m} — الإيراد بلا ضريبة`, k.revenueMinor);
    f.count(`${m} — عدد الطلبات`, k.orders);
    f.sar(`${m} — متوسّط الطلب شاملاً الضريبة`, k.ticketMinor);
    f.pct(`${m} — تكلفة المبيعات من الإيراد`, k.cogsBp);
    f.pct(`${m} — الرواتب من الإيراد`, k.labourBp);
    f.pct(`${m} — الإيجار من الإيراد`, k.rentBp);
    f.pct(`${m} — التكلفة الأساسيّة (المبيعات + الرواتب) من الإيراد`, k.primeBp);
    f.pct(`${m} — رسوم الشبكة من مقبوض البطاقة`, k.cardFeeBp);
    f.sar(`${m} — ${k.profitLabel}`, k.profitMinor);
    f.pct(`${m} — هامش الربح`, k.netMarginBp);
    f.note(`${m} — اكتمال الأرقام`, k.complete ? "مكتمل" : `غير مكتمل: ${k.profitLabel}`);
  }
  /* ما بعُد عن المعتاد بكثير في الجهة الحسنة سؤالٌ عن اكتمال الدفاتر — يُقال له صراحةً */
  for (const k of series.filter((x) => !x.open)) {
    const checks: [BenchmarkKey, number | null][] = [["netMargin", k.netMarginBp], ["labour", k.labourBp], ["cogs", k.cogsBp], ["prime", k.primeBp], ["rent", k.rentBp]];
    for (const [key, value] of checks) {
      if (verdictOf(value, BENCHMARKS[key]) === "SUSPECT") {
        f.note(`تنبيه — ${formatMonth(k.month)}: ${BENCHMARKS[key].label}`, "أبعد من المعتاد بكثير في الجهة الحسنة؛ الأرجح أنّ تكاليف غائبة عن الدفاتر لا أداءٌ استثنائيّ — تحقّق قبل أن تبني عليه");
      }
    }
  }
  for (const b of Object.values(BENCHMARKS)) {
    if (b.key === "prepMedian") continue;
    f.pct(`مرجع عامّ لا من الدفاتر — ${b.label}: أدنى المعتاد`, b.low);
    f.pct(`مرجع عامّ لا من الدفاتر — ${b.label}: أعلى المعتاد`, b.high);
  }
  return f.facts;
}

interface ToolSpec<A extends z.ZodType> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  args: A;
  /** لا تُعطى أداةُ الرواتب لمن لا يراها. */
  allowed?: (ctx: ToolContext) => boolean;
  run: (args: z.infer<A>, ctx: ToolContext) => Promise<ToolResult>;
}

const noArgs = z.object({}).passthrough();
const monthArg = z.object({ month: Month });
const monthParam = { type: "object", properties: { month: { type: "string", description: "الشهر بصيغة YYYY-MM" } }, required: ["month"] };

function tool<A extends z.ZodType>(spec: ToolSpec<A>): ToolSpec<A> {
  return spec;
}

const TOOLS = [
  tool({
    name: "months_overview",
    description: "مؤشّرات كلّ شهر منذ الافتتاح: الإيراد والطلبات ومتوسّط الطلب ونسب التكلفة والرواتب والإيجار ورسوم الشبكة والربح والهامش، ومرجع الصناعة العامّ.",
    parameters: { type: "object", properties: {} },
    args: noArgs,
    run: async () => ({ facts: await monthsOverviewFacts(), label: "يراجع مؤشّرات الأشهر" }),
  }),
  tool({
    name: "month_pnl",
    description: "قائمة دخل شهر بأسطرها: الإيراد، تكلفة المبيعات وطريقتها، المصروفات بأبوابها، الربح واسمه، وما ينقص الشهر.",
    parameters: monthParam,
    args: monthArg,
    run: async ({ month }) => {
      const v = await loadPnl(month);
      const f = new FactList();
      const m = formatMonth(month);
      for (const l of v.pnl.lines) {
        if (l.amountMinor === null) f.note(`${m} — ${l.label}`, l.note ?? "غير معروف");
        else f.sar(`${m} — ${l.label}`, l.amountMinor);
      }
      for (const g of v.pnl.gaps) f.note(`${m} — ينقص الشهر`, `${g.label} (الإجراء في التطبيق: ${g.action})`);
      if (v.pnl.unexplainedMinor !== null) f.sar(`${m} — فرق جرد غير مفسّر (خرج من الرفّ ولا يفسّره بيع ولا هدر مسجّل)`, v.pnl.unexplainedMinor);
      return { facts: f.facts, label: `يراجع ربح ${m}` };
    },
  }),
  tool({
    name: "month_expenses",
    description: "أكبر مصروفات شهر سطراً سطراً (من كشف البنك وما أضافه المالك): الباب والجهة والمبلغ واليوم.",
    parameters: monthParam,
    args: monthArg,
    run: async ({ month }, ctx) => {
      const v = await loadPnl(month);
      const rows = visibleOpexRows(v.opexRows, ctx.role).sort((a, b) => b.amountMinor - a.amountMinor).slice(0, 25);
      const f = new FactList();
      for (const x of v.pnl.opexByCategory) f.sar(`${formatMonth(month)} — مجموع باب «${x.label}»`, x.amountMinor);
      for (const r of rows) {
        const cat = isTxCategory(r.category) ? CATEGORY_LABEL[r.category] : r.category;
        f.sar(`${r.occurredOn ?? formatMonth(month)} — ${cat}: ${r.label}`, r.amountMinor);
      }
      return { facts: f.facts, label: `يراجع مصروفات ${formatMonth(month)}` };
    },
  }),
  tool({
    name: "month_sales",
    description: "مبيعات شهر بتفصيلها: الأيّام الأعلى والأدنى، المبيعات بالساعة، متوسّط كلّ يوم من أيّام الأسبوع، طرق الدفع، نوع الطلب، الأصناف الأكثر بيعاً بالمبلغ والكمّيّة، والخصومات والمرتجع ومشروبات الموظّفين.",
    parameters: monthParam,
    args: monthArg,
    run: async ({ month }) => {
      const a = await loadSalesAnalysis(month);
      const f = new FactList();
      const m = formatMonth(month);
      const days = [...a.days].sort((x, y) => y.paidMinor - x.paidMinor);
      for (const d of days.slice(0, 3)) f.sar(`${m} — من أعلى الأيّام: ${d.day} (${countNoun(d.orders, ORDER)})`, d.paidMinor);
      for (const d of days.slice(-3)) f.sar(`${m} — من أدنى الأيّام: ${d.day} (${countNoun(d.orders, ORDER)})`, d.paidMinor);
      for (const h of a.hours) if (h.orders > 0) f.sar(`${m} — مبيعات الساعة ${String(h.hour).padStart(2, "0")}:00 (${countNoun(h.orders, ORDER)})`, h.paidMinor);
      for (const w of a.weekdays) if (w.days > 0) f.sar(`${m} — متوسّط يوم ${WEEKDAYS[w.weekday] ?? w.weekday}`, Math.round(w.paidMinor / w.days));
      for (const p of a.methods) f.sar(`${m} — الدفع بـ${p.name} (${countNoun(p.payments, PAYMENT)})`, p.amountMinor);
      for (const t of a.types) f.sar(`${m} — طلبات «${t.label}» (${countNoun(t.orders, ORDER)})`, t.paidMinor);
      const items = [...a.items].sort((x, y) => y.salesMinor - x.salesMinor);
      for (const i of items.slice(0, 15)) f.sar(`${m} — مبيعات صنف «${i.name}» (الكمّيّة ${Math.round(i.quantityMilli / 1000)})`, i.salesMinor);
      for (const i of [...a.items].filter((x) => x.salesMinor > 0).sort((x, y) => x.salesMinor - y.salesMinor).slice(0, 5)) f.sar(`${m} — من أقلّ الأصناف مبيعاً «${i.name}»`, i.salesMinor);
      f.sar(`${m} — الخصومات (${countNoun(a.leaks.discountedOrders, ORDER)})`, a.leaks.discountMinor);
      f.sar(`${m} — المرتجع للزبائن (${countNoun(a.leaks.refundOrders, ORDER)})`, a.leaks.refundsMinor);
      f.count(`${m} — طلبات ملغاة`, a.leaks.voidOrders);
      f.sar(`${m} — مشروبات الموظّفين بسعر القائمة (${countNoun(a.leaks.staffOrders, ORDER)}، ليست إيراداً)`, a.leaks.staffListMinor);
      f.sar(`${m} — مشروبات الموظّفين بتكلفتها`, a.leaks.staffCostMinor);
      return { facts: f.facts, label: `يراجع مبيعات ${m}` };
    },
  }),
  tool({
    name: "service_speed",
    description: "سرعة التحضير من شاشة المطبخ في فودكس: الوسيط والعُشر الأبطأ ونسبة ما تجاوز عشر دقائق، وبحسب ساعة اليوم، لعدد أيّام تختاره.",
    parameters: { type: "object", properties: { days: { type: "integer", description: "عدد الأيّام الأخيرة، من 7 إلى 120" } }, required: ["days"] },
    args: z.object({ days: z.coerce.number().int().min(7).max(120) }),
    run: async ({ days }) => {
      const today = todayInRiyadh();
      const w = await loadServiceSpeed(addDays(today, -days), addDays(today, -1));
      const s = w.speed;
      const f = new FactList();
      f.count(`طلبات قيس زمن تحضيرها في آخر ${days} يوماً`, s.measured);
      /* عيّنةٌ صغيرة لا يُحكم منها — حكم المستشارُ مرّةً على طلبين أنّ الشاشة «لا تعمل» */
      if (s.measured < 100) f.note("حجم العيّنة", "صغيرة: لا يُحكم منها على سرعة الخدمة ولا على استعمال الشاشة، وقد تكون أوقات الأيّام الأخيرة لم تُقرأ بعد");
      f.count(`زمن التحضير بالثواني — الوسيط`, s.medianSec);
      f.count(`زمن التحضير بالثواني — العُشر الأبطأ يتجاوز`, s.p90Sec);
      f.pct(`نسبة الطلبات التي تجاوزت عشر دقائق`, s.slowBp);
      f.count(`طلبات بقيت على الشاشة أكثر من ساعة (منسيّة، خارج الحساب)`, s.forgotten);
      for (const h of s.byHour) f.count(`الساعة ${String(h.hour).padStart(2, "0")}:00 — الوسيط بالثواني (${countNoun(h.orders, ORDER)})`, h.medianSec);
      f.count(`مرجع عامّ لا من الدفاتر — الوسيط المستهدف في القهوة المختصّة بالثواني، أدناه`, BENCHMARKS.prepMedian.low);
      f.count(`مرجع عامّ لا من الدفاتر — الوسيط المستهدف في القهوة المختصّة بالثواني، أعلاه`, BENCHMARKS.prepMedian.high);
      return { facts: f.facts, label: "يراجع سرعة التحضير" };
    },
  }),
  tool({
    name: "cash_and_obligations",
    description: "النقد الآن وما عليه: رصيد البنك وتاريخه، ما يُدفع حتى آخر الشهر القادم بأقسامه، الضريبة المستحقّة، المستحقّ للمورّدين والمتأخّر منه.",
    parameters: { type: "object", properties: {} },
    args: noArgs,
    run: async (_a, ctx) => {
      const [o, b, overdue] = await Promise.all([loadCashOutlook({ withVat: true, canSeePayroll: ctx.canSeePayroll }), loadBalanceTotals(), loadOverdueBalances()]);
      const f = new FactList();
      f.sar(`رصيد البنك${o.balanceAsOf ? ` حسب كشف ${o.balanceAsOf}` : ""}`, o.balanceMinor);
      for (const k of o.buckets) f.sar(`يُدفع — ${k.title} (${k.when})`, k.totalMinor);
      f.sar("مجموع ما يُدفع حتى آخر الشهر القادم", o.totalMinor);
      if (o.shortfallAt) f.note("يقصر الرصيد عن الجدول", `في ${o.shortfallAt}`);
      for (const v of [...o.vatIncluded, ...o.vatAhead]) f.sar(`ضريبة القيمة المضافة — ${v.label}`, v.amountMinor);
      f.sar(`المستحقّ للمورّدين (${countNoun(b.totals.owedSuppliers, SUPPLIER)})`, b.totals.owedMinor);
      for (const x of overdue.slice(0, 8)) f.sar(`متأخّر أكثر من ستين يوماً — ${x.nameAr} (أقدم فاتورة عمرها ${countNoun(x.oldestDays, DAY)})`, x.owedMinor);
      return { facts: f.facts, label: "يراجع النقد والالتزامات" };
    },
  }),
  tool({
    name: "suppliers_owed",
    description: "المورّدون الذين عليك لهم أكبر مبالغ، بعدد فواتيرهم المفتوحة وما سدّدته لهم.",
    parameters: { type: "object", properties: {} },
    args: noArgs,
    run: async () => {
      const { rows } = await loadBalanceTotals();
      const top = [...rows].filter((r) => r.owedMinor > 0).sort((a, b) => b.owedMinor - a.owedMinor).slice(0, 15);
      const names = top.length ? await db.select({ id: suppliers.id, name: suppliers.nameAr }).from(suppliers).where(inArray(suppliers.id, top.map((t) => t.supplierId))) : [];
      const nameOf = new Map(names.map((n) => [n.id, n.name]));
      const f = new FactList();
      for (const r of top) {
        f.sar(`عليك لـ${nameOf.get(r.supplierId) ?? "مورّد"} (${countNoun(r.openCount, INVOICE)} مفتوحة)`, r.owedMinor);
        f.sar(`ما سدّدته لـ${nameOf.get(r.supplierId) ?? "مورّد"} منذ البداية`, r.paidNetMinor);
      }
      return { facts: f.facts, label: "يراجع حسابات المورّدين" };
    },
  }),
  tool({
    name: "payroll_month",
    description: "مسيّر رواتب شهر: كلّ موظّف براتبه المستحقّ وما حُوّل له والباقي، والمجموع.",
    parameters: monthParam,
    args: monthArg,
    allowed: (ctx) => ctx.canSeePayroll,
    run: async ({ month }) => {
      const p = await loadPayrollMonth(month);
      const f = new FactList();
      const m = formatMonth(month);
      f.count(`${m} — عدد الموظّفين في المسيّر`, p.rows.length);
      f.sar(`${m} — مجموع المستحقّ للموظّفين`, p.rows.every((r) => r.slip.dueMinor !== null) ? p.rows.reduce((s, r) => s + (r.slip.dueMinor ?? 0), 0) : null);
      for (const r of p.rows) {
        f.sar(`${m} — مستحقّ ${r.employee.name} (${r.employee.kind === "PART_TIME" ? "جزئيّ" : "شهريّ"})`, r.slip.dueMinor);
        f.sar(`${m} — حُوّل لـ${r.employee.name}`, r.slip.paidMinor);
      }
      return { facts: f.facts, label: `يراجع رواتب ${m}` };
    },
  }),
  tool({
    name: "inventory_status",
    description: "الجرد: آخر الجرود المعتمدة بنقصها وزيادتها، والهدر المسجّل والمرتجع، وجواب الكاشير في فودكس عن هدر مكوّنات المرتجع.",
    parameters: { type: "object", properties: {} },
    args: noArgs,
    run: async () => {
      const today = todayInRiyadh();
      const [counts, waste, returns] = await Promise.all([listCounts(6), loadWasteBoard(), loadReturnsWitness(addDays(today, -90), addDays(today, -1))]);
      const f = new FactList();
      for (const c of counts.filter((x) => x.status === "FINALISED").slice(0, 4)) {
        f.sar(`جرد ${c.periodStart}–${c.periodEnd} — النقص بالتكلفة`, c.summary.shortageCostMinor);
        f.sar(`جرد ${c.periodStart}–${c.periodEnd} — الزيادة بالتكلفة`, c.summary.overageCostMinor);
        f.sar(`جرد ${c.periodStart}–${c.periodEnd} — مبيعات الفترة`, c.salesMinor);
      }
      f.sar(`الهدر المسجّل بتكلفته منذ ${waste.since}`, waste.knownCostMinor);
      f.count("سجلّات هدر يدويّة في الجرد", waste.recordCount);
      f.count("مشروبات مرتجعة بعد التحضير (من أسطر البيع)", Math.round(waste.returnedAfterPrep.unitsMilli / 1000));
      f.count("طلبات مرتجع في آخر تسعين يوماً (فودكس)", returns.returnOrders);
      f.count("منها ما قال الكاشير إنّ مكوّناتها هُدرت", returns.answered > 0 ? returns.wastedOrders : null);
      return { facts: f.facts, label: "يراجع الجرد والهدر" };
    },
  }),
  tool({
    name: "plan_items",
    description: "بنود خطّتك مع صاحب المقهى: المفتوحة والمنجزة والمتروكة، بأفقها ومؤشّرها — لتتابعها.",
    parameters: { type: "object", properties: {} },
    args: noArgs,
    run: async () => {
      const items = await db.select().from(advisorPlanItems).orderBy(desc(advisorPlanItems.createdAt)).limit(40);
      const f = new FactList();
      if (items.length === 0) f.note("الخطّة", "لا بنود بعد");
      for (const i of items) f.note(`بند ${i.id} (${i.horizonDays} يوماً، ${i.status === "OPEN" ? "مفتوح" : i.status === "DONE" ? "أُنجز" : "تُرك"}، كُتب ${isoDay(i.createdAt)})`, `${i.title}${i.metric ? ` — يُقاس بـ: ${i.metric}` : ""}`);
      return { facts: f.facts, label: "يراجع الخطّة" };
    },
  }),
  tool({
    name: "save_plan_item",
    description: "اكتب بنداً في خطّة صاحب المقهى بعد أن يتّفق معك عليه أو يطلب خطّة: عنوانٌ فعليّ قصير، وتفصيل، وأفق 30 أو 60 أو 90 يوماً، والمؤشّر الذي يُقاس به.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "فعل محدّد قصير" },
        detail: { type: "string", description: "كيف يُنفَّذ، في سطرين أو ثلاثة" },
        horizon_days: { type: "integer", enum: [30, 60, 90] },
        metric: { type: "string", description: "ما يُقاس به التقدّم، مثل «متوسّط الطلب»" },
      },
      required: ["title", "horizon_days"],
    },
    args: z.object({
      title: z.string().trim().min(3).max(300),
      detail: z.string().trim().max(2000).optional(),
      horizon_days: z.coerce.number().refine((n) => n === 30 || n === 60 || n === 90),
      metric: z.string().trim().max(200).optional(),
    }),
    run: async (a, ctx) => {
      const [row] = await db.insert(advisorPlanItems).values({
        title: a.title, detail: a.detail ?? null, horizonDays: a.horizon_days, metric: a.metric ?? null,
        threadId: ctx.threadId, createdById: ctx.userId,
      }).returning({ id: advisorPlanItems.id });
      const f = new FactList();
      f.note("كُتب في الخطّة", `${a.title} (${a.horizon_days} يوماً) — ${row.id}`);
      return { facts: f.facts, label: "يكتب بنداً في الخطّة" };
    },
  }),
  tool({
    name: "update_plan_item",
    description: "غيّر حال بند في الخطّة حين يقول صاحب المقهى إنّه أنجزه أو تركه.",
    parameters: { type: "object", properties: { id: { type: "string" }, status: { type: "string", enum: ["OPEN", "DONE", "DROPPED"] } }, required: ["id", "status"] },
    args: z.object({ id: z.string().min(1).max(64), status: z.enum(["OPEN", "DONE", "DROPPED"]) }),
    run: async ({ id, status }) => {
      const rows = await db.update(advisorPlanItems).set({ status, updatedAt: new Date() }).where(eq(advisorPlanItems.id, id)).returning({ title: advisorPlanItems.title });
      const f = new FactList();
      f.note("حال البند", rows[0] ? `${rows[0].title}: ${status}` : "لا بند بهذا المعرّف");
      return { facts: f.facts, label: "يحدّث الخطّة" };
    },
  }),
];

/** الأدواتُ كما يراها النموذج لهذا الدور. */
export function advisorToolsFor(ctx: ToolContext): DeepseekTool[] {
  return TOOLS.filter((t) => !t.allowed || t.allowed(ctx)).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

/** ينفّذ أداةً طلبها النموذج — والمعاملاتُ تُفحَص هنا؛ ما لا يُفهم يُقال له لا يُرمى. */
export async function runAdvisorTool(name: string, rawArgs: string, ctx: ToolContext): Promise<ToolResult> {
  const spec = TOOLS.find((t) => t.name === name);
  const f = new FactList();
  if (!spec || (spec.allowed && !spec.allowed(ctx))) {
    f.note("خطأ", `لا أداة باسم ${name} متاحة`);
    return { facts: f.facts, label: "يبحث" };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(rawArgs || "{}"); } catch { parsed = null; }
  const args = spec.args.safeParse(parsed);
  if (!args.success) {
    f.note("خطأ في المعاملات", args.error.issues.map((i) => i.message).join("، "));
    return { facts: f.facts, label: "يعيد السؤال" };
  }
  try {
    return await (spec.run as (a: unknown, c: ToolContext) => Promise<ToolResult>)(args.data, ctx);
  } catch (e) {
    console.error(`[advisor] ${name}:`, (e as Error).message);
    f.note("تعذّرت القراءة", "لم تُقرأ هذه البيانات الآن — قل ذلك ولا تخمّن رقمها");
    return { facts: f.facts, label: spec.name };
  }
}

/** شهرٌ افتراضيّ تُطلب أدواتُه حين لا يسمّي صاحبُ المقهى شهراً: آخرُ شهرٍ انتهى. */
export function lastFinishedMonth(): string {
  const now = currentMonthRiyadh();
  const [y, m] = now.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
