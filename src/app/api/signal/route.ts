/**
 * قرارُ صاحب المقهى في ملاحظةٍ محسوبة: أسكِتها · ذكّرني بعد أيّام · أعِدها.
 *
 * لا مالَ يُكتب هنا ولا حالةَ تتغيّر: صفٌّ في `alert_resolutions` بمفتاحٍ
 * يُشتقّ من الحدث، يقرؤه حسابُ الملاحظات فيصمت عنها. والمفتاحُ يُفحص شكلُه
 * وبادئتُه (`signal-decisions.ts`) — مفتاحٌ من غير هذه الملاحظات لا يُمسّ من
 * هنا، فلا يُغلَق تنبيهُ «سُدّد مرّتين» ولا حارسُ الآيبان من بابٍ جانبيّ.
 * والقرارُ في سجلّ التدقيق بسببه.
 */
import { z } from "zod";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { alertResolutions } from "@/db/schema";
import { readJson } from "@/lib/request-body";
import { guard, respondTo } from "@/services/guard";
import { recordAudit } from "@/lib/audit";
import { todayInRiyadh } from "@/lib/riyadh-time";
import { DISMISSED, SIGNAL_LABEL, addDays, signalPrefix, snoozedUntil } from "@/lib/signal-decisions";

export const runtime = "nodejs";

const Body = z.object({
  key: z.string().min(5).max(200),
  action: z.enum(["dismiss", "snooze", "reopen"]),
  /** أيّامُ التأجيل — من يومٍ إلى تسعين */
  days: z.number().int().min(1).max(90).optional(),
  note: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("signal", "bank:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  const { key, action } = read.body;
  const prefix = signalPrefix(key);
  if (!prefix) {
    return NextResponse.json({ error: "هذه الملاحظة لا تُحسم من هنا." }, { status: 400 });
  }
  const note = read.body.note?.trim().slice(0, 500) || null;
  const until = action === "snooze" ? addDays(todayInRiyadh(), read.body.days ?? 7) : null;
  const decision = action === "dismiss" ? DISMISSED : until ? snoozedUntil(until) : null;

  await db.transaction(async (t) => {
    const [before] = await t.select().from(alertResolutions).where(eq(alertResolutions.key, key)).for("update");
    if (decision === null) {
      await t.delete(alertResolutions).where(eq(alertResolutions.key, key));
    } else {
      await t.insert(alertResolutions)
        .values({ key, decision, note, userId: user.id })
        .onConflictDoUpdate({ target: alertResolutions.key, set: { decision, note, userId: user.id, at: new Date() } });
    }
    await recordAudit({
      actorId: user.id,
      action: "ALERT_RESOLVED",
      entityType: "alert",
      entityId: key,
      before: before ? { القرار: before.decision, الملاحظة: before.note } : null,
      after: {
        الملاحظة_المحسوبة: SIGNAL_LABEL[prefix],
        القرار: action === "dismiss" ? "أُسكتت" : until ? `أُجّلت حتى ${until}` : "أُعيدت",
        السبب: note,
      },
    }, t);
  });

  return NextResponse.json({
    ok: true,
    message:
      action === "dismiss" ? "أُسكتت — لن تظهر ثانيةً إلّا إن تغيّر ما بُنيت عليه"
      : until ? `أُجّلت — تعود بعد ${until}`
      : "أُعيدت الملاحظة",
  });
}
