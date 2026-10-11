/**
 * ما يضبطه صاحبُ المقهى مرّةً — مفتاحٌ وقيمةٌ نصّيّة تُفحص عند القراءة.
 * وغيابُ الصفّ «لم يُضبط»: لا قيمةَ مفترَضة تُحسب بها.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { parseStoredMinor } from "@/lib/cash-outlook";
import { pgErrorCode } from "./guard";

const CASH_FLOOR_KEY = "cash_floor_minor";

/**
 * حدُّ الرصيد الأدنى — `null` لم يُكتب. وجدولٌ لم تُطبَّق هجرتُه بعد (`42P01`) يُقرأ
 * «لم يُكتب»: الحدُّ اختيارٌ إضافيّ، وغيابُ جدوله لا يُسقط «النقد القادم».
 */
export async function loadCashFloor(): Promise<number | null> {
  try {
    const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, CASH_FLOOR_KEY));
    return parseStoredMinor(row?.value);
  } catch (e) {
    if (pgErrorCode(e) === "42P01") return null;
    throw e;
  }
}

/** `null` يرفع الحدّ. */
export async function saveCashFloor(floorMinor: number | null, actorId: string): Promise<void> {
  await db.transaction(async (t) => {
    const [before] = await t.select().from(appSettings).where(eq(appSettings.key, CASH_FLOOR_KEY)).for("update");
    if (floorMinor === null) {
      await t.delete(appSettings).where(eq(appSettings.key, CASH_FLOOR_KEY));
    } else {
      await t.insert(appSettings)
        .values({ key: CASH_FLOOR_KEY, value: String(floorMinor), updatedById: actorId })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: String(floorMinor), updatedById: actorId, updatedAt: new Date() } });
    }
    await recordAudit({
      actorId,
      action: "PAYMENT_CASH_FLOOR_SET",
      entityType: "setting",
      entityId: CASH_FLOOR_KEY,
      before: { الحدّ_بالهللة: parseStoredMinor(before?.value) },
      after: { الحدّ_بالهللة: floorMinor },
    }, t);
  });
}
