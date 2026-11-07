/**
 * جردُ السبت من «TPH Team» — الموظّفُ المأذونُ له (`employees.can_count_inventory`) يُدخل عدَّ
 * الرفّ بنفسه بدل ملفّ إكسل يُرسَل للمالك فيُعاد كتابتُه.
 *
 * **تسجيلٌ لا تعديل** (أحمد، ٨ نوفمبر ٢٠٢٦): أسبوعٌ واحد يُفتح له — الأسبوعُ الذي ينتهي يومَ السبت،
 * يومَ السبت نفسه أو الأحدَ بعده (التقفيلةُ قد تعبر منتصف الليل). لا جردَ قديم، ولا نطاق، ولا
 * افتتاحيّ، ولا إقفال ولا إلغاء — تلك للمالك في `/inventory`. والعدُّ **أعمى**: لا يرى المتوقَّعَ
 * ولا الفرقَ ولا كلفة، فلا يكتب ما يُنتظر منه.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { inventoryCountLines, inventoryCounts, products } from "@/db/schema";
import { addDays } from "@/lib/riyadh-time";
import { dayOfWeek, weekOf, type Week } from "@/lib/inventory/week";
import { formatQuantity, unitChoices } from "@/lib/inventory/units";
import { storedUnitLabel, type StoredUnit } from "@/lib/unit-conversion";
import { CATEGORY_LABEL, type ProductCategory } from "@/lib/products";
import { DomainError } from "@/lib/domain-error";
import { canonicalCounts, recomputeCount, saveActualCounts, startCount, type TeamCounter } from "./inventory.service";

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
  units: { value: StoredUnit; label: string }[];
  /** ما سُجّل لهذا الصنف في هذا الجرد نصّاً بوحدته، أو `null` لم يُعَدّ. */
  counted: string | null;
}

export type TeamCountView =
  | { state: "closed"; nextSaturday: string; lastWeek: Week; lastCounted: number | null }
  | { state: "not-started"; week: Week }
  | { state: "locked"; week: Week }
  | { state: "open"; week: Week; countId: string; lines: TeamCountLine[] };

/** جردُ أسبوعٍ بعينه (للمقهى كلّه، بلا فرع) — إن بُدئ. */
async function countFor(week: Week): Promise<{ id: string; status: string } | null> {
  const [row] = await db.select({ id: inventoryCounts.id, status: inventoryCounts.status }).from(inventoryCounts)
    .where(and(eq(inventoryCounts.periodStart, week.start), eq(inventoryCounts.periodEnd, week.end), isNull(inventoryCounts.branchId)))
    .limit(1);
  return row ? { id: row.id, status: String(row.status) } : null;
}

async function linesOf(countId: string): Promise<TeamCountLine[]> {
  const rows = await db.select({
    productId: inventoryCountLines.productId, actual: inventoryCountLines.actualMilli,
    name: products.nameAr, category: products.category, baseUnit: products.baseUnit,
  }).from(inventoryCountLines)
    .innerJoin(products, eq(products.id, inventoryCountLines.productId))
    .where(and(eq(inventoryCountLines.countId, countId), eq(inventoryCountLines.inScope, true)))
    .orderBy(asc(products.category), asc(products.nameAr));
  return rows.map((r) => {
    const unit = r.baseUnit as StoredUnit;
    return {
      productId: r.productId, name: r.name,
      categoryLabel: CATEGORY_LABEL[r.category as ProductCategory] ?? String(r.category),
      baseUnit: unit,
      units: unitChoices(unit).map((u) => ({ value: u, label: storedUnitLabel(u) })),
      counted: r.actual === null ? null : formatQuantity(r.actual, unit),
    };
  });
}

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
  return { state: "open", week: w.week, countId: count.id, lines: await linesOf(count.id) };
}

/**
 * يبدأ جردَ السبت إن لم يُبدأ — الأسبوعُ من الخادم لا من المتصفّح. ونطاقُه يُورَث من الجرد
 * السابق كما لو بدأه المالك (`startCount` · `recomputeCount`).
 */
export async function startTeamCount(today: string, by: TeamCounter): Promise<string> {
  const w = teamCountWindow(today);
  if (!w.open) throw new TeamCountRefused("الجرد يُفتح يوم السبت فقط.");
  const { countId, created } = await startCount({ periodStart: w.week.start, periodEnd: w.week.end, branchId: null, actorId: by });
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
  entries: readonly { productId: string; milli: number | null; unit: StoredUnit }[],
  by: TeamCounter,
): Promise<number> {
  const w = teamCountWindow(today);
  if (!w.open) throw new TeamCountRefused("انتهى وقت جرد السبت، فلم يُحفظ شيء. أرسل العدد للإدارة.");
  const count = await countFor(w.week);
  if (!count || count.id !== countId) throw new TeamCountRefused("هذا ليس جرد هذا الأسبوع. حدّث الصفحة.");
  if (count.status === "FINALISED") throw new TeamCountRefused("أُقفل جرد هذا الأسبوع، فلا يُعدَّل من هنا.");
  const inScope = new Set((await linesOf(countId)).map((l) => l.productId));
  const outside = entries.find((e) => !inScope.has(e.productId));
  if (outside) throw new TeamCountRefused("صنفٌ ليس في هذا الجرد. حدّث الصفحة.");
  const canonical = await canonicalCounts(entries);
  await saveActualCounts(countId, canonical, by);
  return canonical.length;
}
