/**
 * جردُ السبت من «TPH Team» — الموظّفُ المأذونُ له (`employees.can_count_inventory`) يُدخل عدَّ
 * الرفّ بنفسه بدل ملفّ إكسل يُرسَل للمالك فيُعاد كتابتُه.
 *
 * **تسجيلٌ لا تعديل** (أحمد، ٨ نوفمبر ٢٠٢٦): أسبوعٌ واحد يُفتح له — الأسبوعُ الذي ينتهي يومَ السبت،
 * يومَ السبت نفسه أو الأحدَ بعده (التقفيلةُ قد تعبر منتصف الليل). لا جردَ قديم، ولا نطاق، ولا
 * افتتاحيّ، ولا إقفال ولا إلغاء — تلك للمالك في `/inventory`. والعدُّ **أعمى**: لا يرى المتوقَّعَ
 * ولا الفرقَ ولا كلفة، فلا يكتب ما يُنتظر منه.
 */
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, inventoryCountLines, inventoryCounts, products } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { teamCountReport, whatsappNumber } from "@/lib/inventory/team-report";
import { addDays } from "@/lib/riyadh-time";
import { dayOfWeek, weekOf, type Week } from "@/lib/inventory/week";
import { formatQuantity } from "@/lib/inventory/units";
import { partFields, partsText, readParts, storagePack, sumParts, unusualCount, type CountPart, type PartField, type PartKey, type StoragePack } from "@/lib/inventory/count-parts";
import type { StoredUnit } from "@/lib/unit-conversion";
import { CATEGORY_LABEL } from "@/lib/products";
import { DomainError } from "@/lib/domain-error";
import { recomputeCount, saveActualCounts, startCount, type ActualInput, type TeamCounter } from "./inventory.service";

/** يومُ السبت ٦، والأحدُ ٠. */
const SATURDAY = 6;

/**
 * أسبوعُ الجرد المفتوح للموظّف اليوم، أو `null` ومعه سبتُه القادم.
 * السبت ← أسبوعُه هو. الأحد ← الأسبوعُ الذي انتهى أمس. وغيرُهما مغلق.
 */
export function teamCountWindow(today: string): { open: true; week: Week } | { open: false; nextSaturday: string; lastWeek: Week } {
  const dow = dayOfWeek(today);
  if (dow === SATURDAY) return { open: true, week: weekOf(today) };
  if (dow === 0) return { open: true, week: weekOf(addDays(today, -1)) };
  const nextSaturday = addDays(today, SATURDAY - dow);
  return { open: false, nextSaturday, lastWeek: weekOf(addDays(today, -dow - 1)) };
}

export class TeamCountRefused extends DomainError {
  constructor(message: string) {
    super(message, 409);
    this.name = "TeamCountRefused";
  }
}

export interface TeamCountLine {
  productId: string;
  name: string;
  categoryLabel: string;
  baseUnit: StoredUnit;
  /** خاناتُ العدّ: وحدةُ التخزين من الكتالوج إن عُرف ما فيها، ثمّ وحدتا العائلة. */
  fields: PartField[];
  /** ما كتبه بخاناته آخرَ مرّة — يُعرض ويُعاد إليه. و`null` لا تفصيل (أو عدّله المالك). */
  parts: CountPart[] | null;
  /** ما سُجّل لهذا الصنف في هذا الجرد نصّاً بوحدته، أو `null` لم يُعَدّ. */
  counted: string | null;
}

export type TeamCountView =
  | { state: "closed"; nextSaturday: string; lastWeek: Week; lastCounted: number | null }
  | { state: "not-started"; week: Week }
  | { state: "locked"; week: Week }
  | {
    state: "open"; week: Week; countId: string; lines: TeamCountLine[];
    /** آخرُ إرسالٍ للإدارة، و`stale` عُدّ شيءٌ بعده فيُرسَل ثانيةً. و`null` لم يُرسَل قطّ. */
    sent: { at: string; stale: boolean } | null;
  };

/** جردُ أسبوعٍ بعينه (للمقهى كلّه، بلا فرع) — إن بُدئ. */
async function countFor(week: Week): Promise<{ id: string; status: string; sentAt: Date | null } | null> {
  const branch = await cafeBranch();
  const [row] = await db.select({ id: inventoryCounts.id, status: inventoryCounts.status, sentAt: inventoryCounts.teamSentAt }).from(inventoryCounts)
    .where(and(eq(inventoryCounts.periodStart, week.start), eq(inventoryCounts.periodEnd, week.end), branch === null ? isNull(inventoryCounts.branchId) : eq(inventoryCounts.branchId, branch)))
    .limit(1);
  return row ? { id: row.id, status: String(row.status), sentAt: row.sentAt } : null;
}

/**
 * فرعُ جرود المقهى — فرعُ آخر جردٍ أجراه المالك، وإلّا الفرعُ النشط الوحيد، وإلّا بلا فرع.
 *
 * كان جردُ الفريق يُنشأ بلا فرع وجرودُ أحمد كلُّها على «الفرع الرئيسي» (٨ نوفمبر ٢٠٢٦): فصار سلسلةً
 * وحده — لا جردَ سابق فلا افتتاحيّ ولا متوقَّع، ونطاقُه كلُّ الأصناف لا اختيارُ أحمد. فالجردُ واحد:
 * ما يكتبه الموظّف يدخل جردَ أحمد نفسَه، ويراجعه أحمد ويقفله.
 */
async function cafeBranch(): Promise<string | null> {
  const [last] = (await db.execute<{ branch_id: string }>(sql`
    select branch_id from inventory_counts where branch_id is not null and started_by_employee_id is null
     order by period_end desc limit 1
  `)).rows;
  if (last) return String(last.branch_id);
  const active = (await db.execute<{ id: string }>(sql`select id from branches where is_active limit 2`)).rows;
  return active.length === 1 ? String(active[0].id) : null;
}

async function linesOf(countId: string): Promise<(TeamCountLine & { pack: StoragePack | null; inScope: boolean })[]> {
  const rows = await db.select({
    productId: inventoryCountLines.productId, actual: inventoryCountLines.actualMilli, parts: inventoryCountLines.countParts, inScope: inventoryCountLines.inScope,
    name: products.nameAr, category: products.category, baseUnit: products.baseUnit,
    packUnit: products.catalogPackUnit, packMilli: products.catalogPackMilli,
  }).from(inventoryCountLines)
    .innerJoin(products, eq(products.id, inventoryCountLines.productId))
    /* كلُّ أسطر الجرد لا ما في النطاق وحده — يعدّ الموظّفُ كلَّ شيء، والمقارنةُ لما اختاره المالك */
    .where(eq(inventoryCountLines.countId, countId))
    .orderBy(asc(products.category), asc(products.nameAr));
  return rows.map((r) => {
    const pack = storagePack(r.baseUnit, r.packUnit, r.packMilli);
    return {
      productId: r.productId, name: r.name,
      categoryLabel: CATEGORY_LABEL[r.category] ?? String(r.category),
      baseUnit: r.baseUnit,
      fields: partFields(r.baseUnit, pack),
      parts: r.actual === null ? null : readParts(r.parts),
      counted: r.actual === null ? null : formatQuantity(r.actual, r.baseUnit),
      pack,
      inScope: r.inScope,
    };
  });
}

/** سطرُ التقرير: المجموع وما كُتب بخاناته. */
const reportLine = (l: TeamCountLine & { inScope: boolean }) => ({ name: l.name, categoryLabel: l.categoryLabel, counted: l.counted, entered: l.parts ? partsText(l.parts) : null, inScope: l.inScope });

/** ما يراه الموظّفُ في صفحة الجرد اليوم. */
export async function loadTeamCount(today: string): Promise<TeamCountView> {
  const w = teamCountWindow(today);
  if (!w.open) {
    const last = await countFor(w.lastWeek);
    let lastCounted: number | null = null;
    if (last) {
      const lines = await linesOf(last.id);
      lastCounted = lines.filter((l) => l.counted !== null).length;
    }
    return { state: "closed", nextSaturday: w.nextSaturday, lastWeek: w.lastWeek, lastCounted };
  }
  const count = await countFor(w.week);
  if (!count) return { state: "not-started", week: w.week };
  if (count.status === "FINALISED") return { state: "locked", week: w.week };
  return { state: "open", week: w.week, countId: count.id, lines: await linesOf(count.id), sent: await sentState(count.id, count.sentAt) };
}

/** أُرسل؟ وهل عدّ الفريقُ شيئاً بعد الإرسال؟ — تعديلُ المالك لا يُعيد على الموظّف «أرسله ثانيةً». */
async function sentState(countId: string, sentAt: Date | null): Promise<{ at: string; stale: boolean } | null> {
  if (!sentAt) return null;
  const [r] = (await db.execute<{ stale: boolean }>(sql`
    select exists (select 1 from inventory_count_lines where count_id = ${countId} and counted_by_employee_id is not null and counted_at > ${sentAt.toISOString()}::timestamptz) as stale
  `)).rows;
  return { at: sentAt.toISOString(), stale: Boolean(r?.stale) };
}

/**
 * يبدأ جردَ السبت إن لم يُبدأ — الأسبوعُ من الخادم لا من المتصفّح. ونطاقُه يُورَث من الجرد
 * السابق كما لو بدأه المالك (`startCount` · `recomputeCount`).
 */
export async function startTeamCount(today: string, by: TeamCounter): Promise<string> {
  const w = teamCountWindow(today);
  if (!w.open) throw new TeamCountRefused("الجرد يُفتح يوم السبت فقط.");
  const { countId, created } = await startCount({ periodStart: w.week.start, periodEnd: w.week.end, branchId: await cafeBranch(), actorId: by });
  if (created) await recomputeCount(countId);
  return countId;
}

/**
 * يحفظ ما عدّه الموظّف. يُرفض كلُّ ما ليس جردَ هذا السبت المفتوح، وكلُّ صنفٍ خارج نطاقه —
 * فلا يصل الرابطُ إلى جردٍ قديم ولو عرف معرّفَه.
 */
export async function saveTeamCount(
  today: string,
  countId: string,
  entries: readonly { productId: string; parts: readonly { key: PartKey; quantity: string }[] }[],
  by: TeamCounter,
): Promise<{ saved: number; check: string[] }> {
  const w = teamCountWindow(today);
  if (!w.open) throw new TeamCountRefused("انتهى وقت جرد السبت، فلم يُحفظ شيء. أرسل العدد للإدارة.");
  const count = await countFor(w.week);
  if (!count || count.id !== countId) throw new TeamCountRefused("هذا ليس جرد هذا الأسبوع. حدّث الصفحة.");
  if (count.status === "FINALISED") throw new TeamCountRefused("أُقفل جرد هذا الأسبوع، فلا يُعدَّل من هنا.");
  const lines = new Map((await linesOf(countId)).map((l) => [l.productId, l]));
  /* المجموعُ يُحسب هنا من وحدة الصنف ووحدة تخزينه في القاعدة — لا يُؤخذ من المتصفّح */
  const actuals: ActualInput[] = [];
  for (const e of entries) {
    const line = lines.get(e.productId);
    if (!line) throw new TeamCountRefused("صنفٌ ليس في هذا الجرد. حدّث الصفحة.");
    const sum = sumParts(e.parts, line.baseUnit, line.pack);
    if (!sum.ok) throw new TeamCountRefused(`${line.name}: ${sum.error}`);
    actuals.push({ productId: e.productId, actualMilli: sum.canonical, parts: sum.parts });
  }
  await saveActualCounts(countId, actuals, by);
  /* رقمٌ بعيدٌ جداً عن آخر عدٍّ سابق — يُسمّى الصنفُ وحده ليتأكّد، لا الرقمُ السابق */
  const previous = await previousActuals(w.week.start, actuals.map((a) => a.productId));
  const check = actuals.filter((a) => unusualCount(a.actualMilli, previous.get(a.productId) ?? null)).map((a) => lines.get(a.productId)?.name ?? "");
  return { saved: actuals.length, check };
}

/** آخرُ عدٍّ لكلّ صنفٍ في جردٍ قبل هذا الأسبوع. */
async function previousActuals(before: string, productIds: readonly string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = (await db.execute<{ product_id: string; actual_milli: string | number }>(sql`
    select distinct on (l.product_id) l.product_id, l.actual_milli
      from inventory_count_lines l join inventory_counts c on c.id = l.count_id
     where c.period_end < ${before} and l.actual_milli is not null
       and l.product_id in (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})
     order by l.product_id, c.period_end desc
  `)).rows;
  return new Map(rows.map((r) => [String(r.product_id), Number(r.actual_milli)]));
}

const WHATSAPP_KEY = "team.count_whatsapp";

/** رقمُ واتساب الإدارة الذي يصله تقريرُ الجرد — `null` لم يُكتب. */
export async function loadCountWhatsapp(): Promise<string | null> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, WHATSAPP_KEY)).limit(1);
  return whatsappNumber(row?.value);
}

/** يكتب الرقمَ أو يمسحه (`null`) — للمالك. والرقمُ الذي لا يُقرأ يُرفض لا يُحفظ. */
export async function saveCountWhatsapp(raw: string | null, actorId: string): Promise<void> {
  const value = raw === null || raw.trim() === "" ? null : whatsappNumber(raw);
  if (raw !== null && raw.trim() !== "" && value === null) throw new TeamCountRefused("رقم الجوال غير مفهوم. اكتبه مثل 0551234567.");
  await db.transaction(async (t) => {
    const [before] = await t.select().from(appSettings).where(eq(appSettings.key, WHATSAPP_KEY)).for("update");
    if (value === null) await t.delete(appSettings).where(eq(appSettings.key, WHATSAPP_KEY));
    else await t.insert(appSettings).values({ key: WHATSAPP_KEY, value, updatedById: actorId })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedById: actorId, updatedAt: new Date() } });
    await recordAudit({ actorId, action: "ATTENDANCE_SETTINGS_SET", entityType: "setting", entityId: WHATSAPP_KEY, before: before?.value ?? null, after: value }, t);
  });
}

/**
 * «أنهِ الجرد وأرسله»: يُكتب وقتُ الإرسال ومَن أرسله، ويُعاد نصُّ التقرير ممّا حُفظ ورقمُ الإدارة
 * لتفتحه الشاشةُ في واتساب. الإرسالُ نفسُه في جوال الموظّف — نسجّل أنّه ضغط، لا أنّه وصل.
 */
export async function sendTeamCount(today: string, countId: string, by: TeamCounter): Promise<{ text: string; phone: string | null }> {
  const w = teamCountWindow(today);
  if (!w.open) throw new TeamCountRefused("انتهى وقت جرد السبت.");
  const count = await countFor(w.week);
  if (!count || count.id !== countId) throw new TeamCountRefused("هذا ليس جرد هذا الأسبوع. حدّث الصفحة.");
  const lines = await linesOf(countId);
  if (!lines.some((l) => l.counted !== null)) throw new TeamCountRefused("لم يُحفظ عدّ أي صنف بعد. اكتب الكميات واحفظها أولاً.");
  await db.transaction(async (t) => {
    await t.update(inventoryCounts).set({ teamSentAt: new Date(), teamSentByEmployeeId: by.employeeId }).where(eq(inventoryCounts.id, countId));
    await recordAudit({ action: "INVENTORY_COUNT_TEAM_SENT", entityType: "inventory_count", entityId: countId, after: { أرسله: by.name, عُدّ: lines.filter((l) => l.counted !== null).length, من: lines.length } }, t);
  });
  return { text: teamCountReport({ week: w.week, by: by.name, lines: lines.map(reportLine) }), phone: await loadCountWhatsapp() };
}

/**
 * تقريرُ جرد هذا السبت ملفَّ PDF — ممّا حُفظ لا ممّا في الشاشة. لجرد هذا الأسبوع وحده، مفتوحاً أو
 * أقفلته الإدارة، وفي وقته (السبت والأحد).
 */
export async function teamCountPdf(today: string, by: TeamCounter): Promise<{ pdf: Buffer; fileName: string }> {
  const w = teamCountWindow(today);
  if (!w.open) throw new TeamCountRefused("تقرير الجرد يُعدّ يوم السبت والأحد بعده.");
  const count = await countFor(w.week);
  if (!count) throw new TeamCountRefused("لم يبدأ جرد هذا الأسبوع بعد.");
  const lines = await linesOf(count.id);
  const preparedAt = new Date().toLocaleString("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", timeZone: "Asia/Riyadh" });
  const { teamCountReportPdf } = await import("@/lib/inventory/team-report-pdf");
  const pdf = await teamCountReportPdf({ week: w.week, by: by.name, lines: lines.map(reportLine), preparedAt });
  return { pdf, fileName: `جرد-السبت-${w.week.end}.pdf` };
}

/**
 * ما عُدّ خارج نطاق الجرد — محفوظٌ في أسطره للمرجع (المحرّكُ يُخفيه من الحساب عمداً فلا يُظنّ معدوداً
 * في المقارنة). بخاناته كما كُتبت ومجموعه.
 */
export async function loadSavedForReference(countId: string): Promise<{ productId: string; name: string; counted: string; entered: string | null }[]> {
  const rows = await db.select({
    productId: inventoryCountLines.productId, actual: inventoryCountLines.actualMilli, parts: inventoryCountLines.countParts,
    name: products.nameAr, baseUnit: products.baseUnit,
  }).from(inventoryCountLines)
    .innerJoin(products, eq(products.id, inventoryCountLines.productId))
    .where(and(eq(inventoryCountLines.countId, countId), eq(inventoryCountLines.inScope, false), isNotNull(inventoryCountLines.actualMilli)))
    .orderBy(asc(products.nameAr));
  return rows.flatMap((r) => r.actual === null ? [] : [{
    productId: r.productId, name: r.name, counted: formatQuantity(r.actual, r.baseUnit),
    entered: (() => { const p = readParts(r.parts); return p ? partsText(p) : null; })(),
  }]);
}

export interface TeamCountWaiting {
  countId: string;
  week: Week;
  /** مَن عدّ من الفريق وكم صنفاً — بالأكثر أوّلاً. */
  counters: { name: string; lines: number }[];
  /** ما عُدّ في النطاق من أيّ أحد، ومجموعُ النطاق. */
  counted: number;
  total: number;
  /** متى أرسله واتساب، و`stale` عُدّ بعده. و`null` لم يُرسَل بعد. */
  sent: { at: string; stale: boolean } | null;
}

/**
 * جرودٌ مفتوحة فيها عدٌّ من «TPH Team» — تنتظر مراجعةَ المالك وإقفالَه. بندٌ في «يحتاج قرارك»،
 * ووصفٌ في رأس الجرد («عدّه أنس من TPH Team»). استعلامٌ واحد.
 */
export async function loadTeamCountsWaiting(countId?: string): Promise<TeamCountWaiting[]> {
  const rows = (await db.execute<{ count_id: string; period_start: string; period_end: string; team_sent_at: string | Date | null; stale: boolean; name: string | null; by_lines: number; counted: number; total: number }>(sql`
    with open as (
      select c.id, c.period_start, c.period_end, c.team_sent_at,
             exists (select 1 from inventory_count_lines s where s.count_id = c.id and c.team_sent_at is not null and s.counted_by_employee_id is not null and s.counted_at > c.team_sent_at) as stale
        from inventory_counts c
       where c.status = 'DRAFT' ${countId ? sql`and c.id = ${countId}` : sql``}
         and exists (select 1 from inventory_count_lines l where l.count_id = c.id and l.counted_by_employee_id is not null)
    ), totals as (
      select l.count_id, count(*)::int as total,
             count(*) filter (where l.actual_milli is not null)::int as counted
        from inventory_count_lines l join open o on o.id = l.count_id group by l.count_id
    )
    select o.id as count_id, o.period_start, o.period_end, o.team_sent_at, o.stale, e.name, count(l.id)::int as by_lines, t.counted, t.total
      from open o
      join totals t on t.count_id = o.id
      join inventory_count_lines l on l.count_id = o.id and l.counted_by_employee_id is not null
      join employees e on e.id = l.counted_by_employee_id
     group by o.id, o.period_start, o.period_end, o.team_sent_at, o.stale, e.name, t.counted, t.total
     order by o.period_end desc, by_lines desc
  `)).rows;
  const by = new Map<string, TeamCountWaiting>();
  for (const r of rows) {
    const id = String(r.count_id);
    const w = by.get(id) ?? { countId: id, week: { start: String(r.period_start), end: String(r.period_end) }, counters: [], counted: Number(r.counted), total: Number(r.total),
      sent: r.team_sent_at ? { at: new Date(r.team_sent_at).toISOString(), stale: Boolean(r.stale) } : null };
    if (r.name) w.counters.push({ name: r.name, lines: Number(r.by_lines) });
    by.set(id, w);
  }
  return [...by.values()];
}
