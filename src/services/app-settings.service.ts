/**
 * ما يضبطه صاحبُ المقهى مرّةً — مفتاحٌ وقيمةٌ نصّيّة تُفحص عند القراءة.
 * وغيابُ الصفّ «لم يُضبط»: لا قيمةَ مفترَضة تُحسب بها.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { parseStoredMinor } from "@/lib/cash-outlook";
import { pgErrorCode } from "@/lib/pg-error";

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

/* ──────────────── أين نقدُ الصندوق؟ ──────────────── */

const CASH_CUSTODY_KEY = "cash_custody";

/**
 * نقدُ فودكس الذي لا يدخل البنك: أين هو؟ — `OWNER_HOLDS` عند المالك نقداً لم يُصرف (أحمد،
 * ٣١ أكتوبر ٢٠٢٦: «النقد موجود عندي ككاش ولم يودع في البنك»)، و`SPENT` يُصرف منه على المقهى
 * (فما صُرف يُدخَل في «ما لا يظهر في الكشف»). وغيابُه «لم يُقَل» — فلا يُفترض أحدُهما.
 * والجوابُ يغيّر التفسير: محفوظٌ ليس تكلفةً غائبة، وضريبتُه مستحقّةٌ في الحالين.
 */
export type CashCustody = "OWNER_HOLDS" | "SPENT";

export interface CashCustodyView {
  value: CashCustody | null;
  setOn: Date | null;
}

export async function loadCashCustody(): Promise<CashCustodyView> {
  try {
    const [row] = await db.select({ value: appSettings.value, at: appSettings.updatedAt }).from(appSettings).where(eq(appSettings.key, CASH_CUSTODY_KEY));
    const value = row?.value === "OWNER_HOLDS" || row?.value === "SPENT" ? row.value : null;
    return { value, setOn: value ? row!.at : null };
  } catch (e) {
    if (pgErrorCode(e) === "42P01") return { value: null, setOn: null };
    throw e;
  }
}

export async function saveCashCustody(value: CashCustody | null, actorId: string): Promise<void> {
  await db.transaction(async (t) => {
    const [before] = await t.select().from(appSettings).where(eq(appSettings.key, CASH_CUSTODY_KEY)).for("update");
    if (value === null) await t.delete(appSettings).where(eq(appSettings.key, CASH_CUSTODY_KEY));
    else {
      await t.insert(appSettings).values({ key: CASH_CUSTODY_KEY, value, updatedById: actorId })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedById: actorId, updatedAt: new Date() } });
    }
    await recordAudit({
      actorId, action: "CASH_CUSTODY_SET", entityType: "setting", entityId: CASH_CUSTODY_KEY,
      before: { النقد: before?.value ?? "لم يُقَل" }, after: { النقد: value ?? "لم يُقَل" },
    }, t);
  });
}
