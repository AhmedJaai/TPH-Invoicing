/**
 * «أجِّله إلى…» لبندٍ في «يحتاج قرارك»، و«أعِده الآن» (`until: null`).
 *
 * المتصفّحُ يرسل معرّفَ البند واليومَ والسببَ وحدها. والمفتاحُ — وفيه مبلغُ البند
 * وعددُه — يُشتقّ هنا من البند كما يبنيه الخادمُ الآن، فلا يُؤجَّل بندٌ غيرُ قائم
 * ولا يُسكَت مبلغٌ لم يره صاحبُه. لا يمسّ مالاً ولا سجلّاً: صفٌّ في `alert_resolutions`.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, like } from "drizzle-orm";
import { db } from "@/db";
import { alertResolutions } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { readJson } from "@/lib/request-body";
import { recordAudit } from "@/lib/audit";
import { attentionSplit } from "@/lib/work";
import { snoozeKey, snoozePrefix, validSnoozeDay } from "@/lib/attention-snooze";
import { DISMISSED, snoozedUntil } from "@/lib/signal-decisions";
import { formatDay, todayInRiyadh } from "@/lib/riyadh-time";

export const runtime = "nodejs";

const Body = z.object({
  itemId: z.string().regex(/^[a-z][a-z-]{2,48}$/, "بند غير معروف"),
  /** يومُ العودة — `null` يعيده الآن، و«dismiss»: علمت، لا تظهره حتى يتغيّر مبلغه أو عدده. */
  until: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("dismiss")]).nullable(),
  note: z.string().trim().max(300).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await guard("attention-snooze", "bank:edit");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const { itemId, until } = read.body;
    const note = read.body.note || null;

    if (until === null) {
      await db.transaction(async (t) => {
        const removed = await t.delete(alertResolutions)
          .where(like(alertResolutions.key, `${snoozePrefix(itemId)}%`))
          .returning({ key: alertResolutions.key, decision: alertResolutions.decision });
        if (removed.length === 0) return;
        await recordAudit({
          actorId: user.id, action: "ALERT_RESOLVED", entityType: "alert", entityId: removed[0].key,
          before: { القرار: removed[0].decision }, after: { القرار: "أُعيد من التأجيل" },
        }, t);
      });
      return NextResponse.json({ ok: true, message: "عاد البند إلى القائمة" });
    }

    const today = todayInRiyadh();
    const dismiss = until === "dismiss";
    if (!dismiss && !validSnoozeDay(until, today)) {
      return NextResponse.json({ error: "يجب أن يكون يوم العودة بعد اليوم وخلال شهر على الأكثر، فالتأجيل الأبعد يُنسى" }, { status: 400 });
    }
    const split = await attentionSplit();
    const item = [...split.active, ...split.snoozed.map((s) => s.item)].find((i) => i.id === itemId);
    if (!item) {
      return NextResponse.json({ error: "لم يعد هذا البند في القائمة، فربما قُرّر فيه. حدّث الصفحة." }, { status: 409 });
    }
    const key = snoozeKey(item);
    const decision = dismiss ? DISMISSED : snoozedUntil(until);
    await db.transaction(async (t) => {
      const [before] = await t.select().from(alertResolutions).where(eq(alertResolutions.key, key)).for("update");
      await t.insert(alertResolutions)
        .values({ key, decision, note, userId: user.id })
        .onConflictDoUpdate({ target: alertResolutions.key, set: { decision, note, userId: user.id, at: new Date() } });
      await recordAudit({
        actorId: user.id, action: "ALERT_RESOLVED", entityType: "alert", entityId: key,
        before: before ? { القرار: before.decision, الملاحظة: before.note } : null,
        after: { القرار: dismiss ? "علمت به، لا يظهر حتى يتغيّر" : `أجّل إلى ${until}`, البند: item.title, الملاحظة: note, المبلغ_بالهللات: item.amountMinor ?? null },
      }, t);
    });
    return NextResponse.json({
      ok: true,
      message: dismiss
        ? "لن يظهر هذا البند مرة أخرى إلا إن تغيّر مبلغه أو عدده. تجده في «مؤجّل أو علمت به» إن أردت إعادته."
        : `أُجّل إلى ${formatDay(until)}. يعود البند تلقائياً في ذلك اليوم، أو قبله إن تغيّر مبلغه.`,
    });
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
